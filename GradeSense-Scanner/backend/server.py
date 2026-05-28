from fastapi import FastAPI, APIRouter, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime, timezone, timedelta
import httpx
from pymongo.errors import PyMongoError
import cv2
import numpy as np
import base64
from io import BytesIO
from fastapi import File, UploadFile, Form
from fastapi.responses import FileResponse
import shutil
from storage_service import StorageService, get_storage_service
import jwt as pyjwt
import asyncpg

# Configure logging early so startup failures are visible.
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ==================== MONGODB CONNECTION ====================

mongo_url = os.environ.get('MONGO_URL')
db_name = os.environ.get('DB_NAME')

if not mongo_url:
    raise RuntimeError("Missing required environment variable: MONGO_URL")

if mongo_url.strip().upper() == "MOCK":
    raise RuntimeError("Invalid MONGO_URL value 'MOCK'. A real MongoDB Atlas URI is required.")

if not db_name:
    raise RuntimeError("Missing required environment variable: DB_NAME")

client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
db = client[db_name]

# ==================== FILE STORAGE ====================
UPLOADS_DIR = ROOT_DIR / "uploads"
storage = get_storage_service(UPLOADS_DIR)

# Create the main app
app = FastAPI(title="GradeSense Scanner API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: Optional[str] = "teacher"
    org_id: Optional[str] = None
    org_name: Optional[str] = "Default Organization"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserSession(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_token: str
    expires_at: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Batch(BaseModel):
    batch_id: str
    name: str
    student_count: int
    org_id: Optional[str] = None


class Student(BaseModel):
    student_id: str
    roll_number: str
    name: str
    batch_id: str


class PageMetadata(BaseModel):
    page_number: int
    file_path: str
    file_size: int
    is_blurry: bool
    sharpness_score: float
    captured_at: str
    file_url: Optional[str] = None

class QuestionPaperInfo(BaseModel):
    page_count: int = 0
    pages: list[PageMetadata] = Field(default_factory=list)

class ModelAnswerInfo(BaseModel):
    page_count: int = 0
    pages: list[PageMetadata] = Field(default_factory=list)

class ScannedStudentInfo(BaseModel):
    student_index: int
    label: str
    barcode_data: Optional[dict] = None
    page_count: int = 0
    has_blurry_pages: bool = False
    pages: list[PageMetadata] = Field(default_factory=list)

class ScanSession(BaseModel):
    session_id: str
    session_name: str
    batch_id: str
    batch_name: str
    subject_id: Optional[str] = None
    total_marks: Optional[float] = None
    exam_date: Optional[str] = None
    user_id: str
    org_id: Optional[str] = None
    status: str = "scanning"
    upload_progress: float = 0
    settings: dict = Field(default_factory=dict)
    question_paper: QuestionPaperInfo = Field(default_factory=QuestionPaperInfo)
    model_answer: ModelAnswerInfo = Field(default_factory=ModelAnswerInfo)
    students: list[ScannedStudentInfo] = Field(default_factory=list)
    stats: dict = Field(default_factory=lambda: {
        "total_students": 0, "total_pages": 0, "total_size_bytes": 0, 
        "blurry_pages": 0, "scanning_duration_seconds": 0, "avg_time_per_student_seconds": 0
    })
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScanSessionCreate(BaseModel):
    session_name: str
    batch_id: str
    settings: dict
    subject_id: Optional[str] = None
    total_marks: Optional[float] = None
    exam_date: Optional[str] = None


class UploadQpRequest(BaseModel):
    pages: list[PageMetadata]

class UploadModelRequest(BaseModel):
    pages: list[PageMetadata]

class UploadStudentRequest(BaseModel):
    student: ScannedStudentInfo

class UploadResponse(BaseModel):
    status: str
    pages_received: int


# ==================== AUTH HELPERS ====================

async def validate_token_with_webapp(token: str) -> Optional[dict]:
    """Validate token with the main webapp auth endpoint"""
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        logger.error("WEBAPP_URL environment variable is not set")
        return None
    
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.get(
                f"{webapp_url.rstrip('/')}/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0
            )
            if response.status_code == 200:
                res_json = response.json()
                return res_json.get("data", {}).get("user")
            else:
                logger.warning(f"Webapp token validation failed: {response.status_code} - {response.text}")
                return None
    except Exception as e:
        logger.error(f"Error communicating with webapp for token validation: {e}")
        return None


async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    """Get current user from session token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    
    # 1. Check guest/mock token bypass
    if token == "sess_mock_token_12345":
        user_doc = await db.users.find_one({"user_id": "user_mock_001"}, {"_id": 0})
        if not user_doc:
            user_doc = {
                "user_id": "user_mock_001",
                "email": "guest@gradesense.in",
                "name": "Guest Teacher",
                "role": "teacher",
                "org_name": "GradeSense Mock Academy"
            }
            await db.users.insert_one(user_doc)
        return User(**user_doc)
    
    # 2. Check local db cache first (avoids hitting webapp on every request)
    session_doc = await db.user_sessions.find_one(
        {"session_token": token},
        {"_id": 0}
    )
    
    if session_doc:
        expires_at = session_doc.get("expires_at")
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        
        if expires_at > datetime.now(timezone.utc):
            user_doc = await db.users.find_one(
                {"user_id": session_doc["user_id"]},
                {"_id": 0}
            )
            if user_doc:
                return User(**user_doc)
    
    # 3. Try local JWT decode (works without WEBAPP_URL being configured)
    jwt_secret = os.environ.get("WEBAPP_JWT_SECRET")
    if jwt_secret:
        try:
            payload = pyjwt.decode(token, jwt_secret, algorithms=["HS256"])
            # Scanner-issued JWTs use "sub" for user_id (see google auth endpoint)
            webapp_user_id = str(payload.get("sub") or payload.get("userId") or payload.get("id") or "")
            
            if webapp_user_id:
                # User was cached in MongoDB at login time — look them up
                user_doc = await db.users.find_one({"user_id": webapp_user_id}, {"_id": 0})
                if user_doc:
                    # Refresh session cache
                    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
                    await db.user_sessions.update_one(
                        {"session_token": token},
                        {"$set": {"user_id": webapp_user_id, "expires_at": expires_at}},
                        upsert=True
                    )
                    logger.info(f"Auth via local JWT for user {user_doc.get('email')}")
                    return User(**user_doc)
        except pyjwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except pyjwt.InvalidTokenError as e:
            logger.debug(f"Local JWT decode failed (will try webapp): {e}")
    
    # 4. Fallback: validate with webapp
    user_info = await validate_token_with_webapp(token)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")
    
    # 5. Sync user and session
    webapp_user_id = user_info.get("id")
    email = user_info.get("email")
    name = user_info.get("name", "User")
    role = user_info.get("role", "teacher")
    org_id = user_info.get("orgId")
    
    user_doc = {
        "user_id": webapp_user_id,
        "email": email,
        "name": name,
        "role": role,
        "org_id": org_id,
        "org_name": "GradeSense Academy"
    }
    
    await db.users.update_one(
        {"user_id": webapp_user_id},
        {"$set": user_doc},
        upsert=True
    )
    
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": token},
        {"$set": {
            "user_id": webapp_user_id,
            "expires_at": expires_at
        }},
        upsert=True
    )
    
    return User(**user_doc)



# ==================== AUTH ROUTES ====================

class LoginRequest(BaseModel):
    email: str
    password: str

@api_router.post("/auth/login")
async def login_endpoint(data: LoginRequest):
    """
    Proxy login to the main webapp auth endpoint.
    Upon success, creates a session locally and returns user + token.
    """
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        logger.error("WEBAPP_URL environment variable is not set")
        raise HTTPException(status_code=500, detail="Authentication service configuration error")
    
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.post(
                f"{webapp_url.rstrip('/')}/api/v1/auth/login",
                json={"email": data.email, "password": data.password},
                timeout=15.0
            )
            
            if response.status_code != 200:
                logger.warning(f"Webapp authentication failed for {data.email}: {response.status_code} - {response.text}")
                error_detail = "Invalid email or password"
                try:
                    res_json = response.json()
                    if "error" in res_json and "message" in res_json["error"]:
                        error_detail = res_json["error"]["message"]
                    elif "message" in res_json:
                        error_detail = res_json["message"]
                except Exception:
                    pass
                raise HTTPException(status_code=response.status_code, detail=error_detail)
            
            auth_data = response.json()
            data_payload = auth_data.get("data", {})
            token = data_payload.get("token")
            user_info = data_payload.get("user", {})
            
            if not token or not user_info:
                logger.error("Authentication response is missing token or user data")
                raise HTTPException(status_code=500, detail="Invalid response from authentication service")
                
    except httpx.RequestError as e:
        logger.error(f"HTTP connection to webapp failed during login: {e}")
        raise HTTPException(status_code=500, detail="Authentication service unavailable")
    
    # Extract user info
    webapp_user_id = user_info.get("id")
    email = user_info.get("email")
    name = user_info.get("name", "User")
    role = user_info.get("role", "teacher")
    org_id = user_info.get("orgId")
    
    # Upsert user locally in scanner MongoDB
    user_doc = {
        "user_id": webapp_user_id,
        "email": email,
        "name": name,
        "role": role,
        "org_id": org_id,
        "org_name": "GradeSense Academy"
    }
    await db.users.update_one(
        {"user_id": webapp_user_id},
        {"$set": user_doc},
        upsert=True
    )
    
    # Create persistent session locally
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session = UserSession(
        user_id=webapp_user_id,
        session_token=token,
        expires_at=expires_at
    )
    
    # Delete old sessions for this user
    await db.user_sessions.delete_many({"user_id": webapp_user_id})
    await db.user_sessions.insert_one(session.model_dump())
    
    return {
        "user": user_doc,
        "session_token": token
    }


@api_router.get("/auth/session")
async def process_session(x_session_id: str = Header(..., alias="X-Session-ID")):
    """
    Process session ID from Emergent OAuth callback.
    Exchange session_id for user data and create persistent session.
    """
    try:
        # Call Emergent Auth to get user data
        async with httpx.AsyncClient() as client_http:
            response = await client_http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": x_session_id},
                timeout=30.0
            )
            
            if response.status_code != 200:
                logger.error(f"Emergent Auth error: {response.status_code} - {response.text}")
                raise HTTPException(status_code=401, detail="Invalid session ID")
            
            auth_data = response.json()
            logger.info(f"Auth data received: {auth_data.get('email')}")
    
    except httpx.RequestError as e:
        logger.error(f"Request error: {e}")
        raise HTTPException(status_code=500, detail="Authentication service unavailable")
    
    # Check if user exists
    existing_user = await db.users.find_one(
        {"email": auth_data["email"]},
        {"_id": 0}
    )
    
    if existing_user:
        user_id = existing_user["user_id"]
        # Update user info
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "name": auth_data.get("name", existing_user.get("name")),
                "picture": auth_data.get("picture", existing_user.get("picture")),
            }}
        )
    else:
        # Create new user
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        new_user = User(
            user_id=user_id,
            email=auth_data["email"],
            name=auth_data.get("name", "User"),
            picture=auth_data.get("picture"),
            org_name="GradeSense Academy"
        )
        await db.users.insert_one(new_user.model_dump())

    # Create session token and return (legacy Emergent Auth - kept for compatibility)
    session_token = f"sess_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session = UserSession(
        user_id=user_id,
        session_token=session_token,
        expires_at=expires_at
    )
    await db.user_sessions.delete_many({"user_id": user_id})
    await db.user_sessions.insert_one(session.model_dump())
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {
        "user": user_doc,
        "session_token": session_token
    }


@api_router.post("/auth/google-idtoken")
async def google_idtoken_auth(data: dict):
    """
    Authenticate using a Google ID token obtained from native mobile OAuth.
    Supports two modes:
    - id_token: Verifies a Google ID token (preferred)
    - access_token + token_info: Uses pre-fetched tokeninfo (fallback when id_token unavailable)
    Looks up the user in the webapp's PostgreSQL DB and returns a webapp-compatible JWT token.
    """
    id_token = data.get("id_token")
    access_token = data.get("access_token")
    prefetched_token_info = data.get("token_info")

    if not id_token and not access_token:
        raise HTTPException(status_code=400, detail="Either id_token or access_token is required")

    google_client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    webapp_jwt_secret = os.environ.get("WEBAPP_JWT_SECRET", "development-jwt-secret-change-me-now")
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if not google_client_id:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")

    token_info = None

    # 1. Verify the ID token or access token with Google
    try:
        async with httpx.AsyncClient() as http:
            if id_token:
                # Primary path: verify ID token
                resp = await http.get(
                    "https://oauth2.googleapis.com/tokeninfo",
                    params={"id_token": id_token},
                    timeout=10.0
                )
                if resp.status_code != 200:
                    logger.warning(f"Google tokeninfo rejected ID token: {resp.text}")
                    raise HTTPException(status_code=401, detail="Invalid Google ID token")
                token_info = resp.json()
            else:
                # Fallback path: verify access token
                if prefetched_token_info and prefetched_token_info.get("email"):
                    # Use pre-fetched token_info from client (already validated by Google)
                    token_info = prefetched_token_info
                else:
                    resp = await http.get(
                        "https://oauth2.googleapis.com/oauth2/v3/tokeninfo",
                        params={"access_token": access_token},
                        timeout=10.0
                    )
                    if resp.status_code != 200:
                        raise HTTPException(status_code=401, detail="Invalid Google access token")
                    token_info = resp.json()
    except httpx.RequestError as e:
        logger.error(f"Error contacting Google tokeninfo: {e}")
        raise HTTPException(status_code=503, detail="Could not verify Google token")

    # 2. Validate audience (only for id_token - access_token tokeninfo has different aud format)
    if id_token:
        aud = token_info.get("aud", "")
        android_client_id = os.environ.get("GOOGLE_OAUTH_ANDROID_CLIENT_ID", "")
        allowed_clients = {google_client_id, android_client_id} - {""}
        if not any(client in aud for client in allowed_clients):
            logger.warning(f"Google token audience mismatch: {aud}, allowed: {allowed_clients}")
            raise HTTPException(status_code=401, detail="Google token audience mismatch")

    # 3. Extract user info from token
    google_email = token_info.get("email", "").strip().lower()
    google_sub = token_info.get("sub", "") or token_info.get("user_id", "")
    google_name = token_info.get("name", "") or google_email.split("@")[0]
    google_picture = token_info.get("picture", "")
    email_verified = token_info.get("email_verified", "false") == "true" or token_info.get("verified_email", False)

    if not google_email:
        raise HTTPException(status_code=401, detail="Google token missing email")
    if not email_verified:
        raise HTTPException(status_code=403, detail="Google email is not verified")


    # 4. Look up user in the webapp's PostgreSQL DB
    webapp_user_id = None
    user_role = "teacher"
    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                'SELECT id, role, account_status FROM users WHERE email = $1 LIMIT 1',
                google_email
            )
            await conn.close()
            if row:
                if row["account_status"] != "active":
                    raise HTTPException(status_code=403, detail="Account is not active")
                webapp_user_id = row["id"]
                user_role = row["role"]
            else:
                logger.warning(f"Google auth: user {google_email} not found in webapp DB")
                raise HTTPException(
                    status_code=403,
                    detail="This email is not registered in GradeSense. Please contact your administrator."
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error querying webapp DB: {e}")
            # Fall through - we'll try webapp token validation instead
            webapp_user_id = None

    # 5. If we couldn't get the user ID from DB, try via webapp API
    if not webapp_user_id:
        # As a fallback, try calling the webapp's login via the proxy
        raise HTTPException(
            status_code=503,
            detail="User database unavailable. Please try again or use email/password login."
        )

    # 6. Create a webapp-compatible JWT token
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=30)
    payload = {
        "sub": webapp_user_id,
        "role": user_role,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    webapp_token = pyjwt.encode(payload, webapp_jwt_secret, algorithm="HS256")

    # 7. Sync user to local MongoDB cache
    user_doc = {
        "user_id": webapp_user_id,
        "email": google_email,
        "name": google_name,
        "picture": google_picture,
        "role": user_role,
        "org_name": "GradeSense Academy"
    }
    await db.users.update_one(
        {"user_id": webapp_user_id},
        {"$set": user_doc},
        upsert=True
    )

    # 8. Store session in local MongoDB
    expire_dt = now + timedelta(days=30)
    await db.user_sessions.delete_many({"user_id": webapp_user_id})
    session = UserSession(
        user_id=webapp_user_id,
        session_token=webapp_token,
        expires_at=expire_dt
    )
    await db.user_sessions.insert_one(session.model_dump())

    logger.info(f"Google auth success for {google_email} (role: {user_role})")
    return {
        "user": user_doc,
        "session_token": webapp_token
    }


@api_router.get("/auth/me")
async def get_me(authorization: Optional[str] = Header(None)):
    """Get current authenticated user"""
    user = await get_current_user(authorization)
    return user.model_dump()


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout and invalidate session"""
    if authorization:
        token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        await db.user_sessions.delete_many({"session_token": token})
    return {"message": "Logged out successfully"}


# ==================== BATCHES ROUTES ====================

@api_router.get("/batches")
async def get_batches(authorization: Optional[str] = Header(None)):
    """Get all batches for the organization (proxied to webapp)"""
    user = await get_current_user(authorization)
    
    # 1. Fetch batches from webapp
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        batches = await db.batches.find({"org_id": user.org_id}, {"_id": 0}).to_list(100)
        return {"batches": batches}
    
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    if token == "sess_mock_token_12345":
        batches = await db.batches.find({"org_id": user.org_id}, {"_id": 0}).to_list(100)
        if not batches:
            batches = [
                {"batch_id": "batch_001", "name": "Grade 10 - Science", "student_count": 24, "org_id": user.org_id},
                {"batch_id": "batch_002", "name": "Grade 11 - Physics", "student_count": 18, "org_id": user.org_id}
            ]
        return {"batches": batches}
        
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.get(
                f"{webapp_url.rstrip('/')}/api/v1/batches",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0
            )
            if response.status_code == 200:
                res_data = response.json()
                webapp_batches = res_data.get("data", [])
                
                mapped_batches = []
                for b in webapp_batches:
                    class_std = b.get("classStandard") or ""
                    section = b.get("section") or ""
                    full_name = b.get("name")
                    if class_std or section:
                        suffix = f" ({class_std} {section})".strip()
                        if not full_name.endswith(suffix):
                            full_name = f"{full_name}{suffix}"
                            
                    mapped_batches.append({
                        "batch_id": b.get("id"),
                        "name": full_name,
                        "student_count": 0,
                        "org_id": user.org_id
                    })
                
                for mb in mapped_batches:
                    await db.batches.update_one(
                        {"batch_id": mb["batch_id"]},
                        {"$set": mb},
                        upsert=True
                    )
                    
                return {"batches": mapped_batches}
            else:
                logger.warning(f"Failed to fetch batches from webapp: {response.status_code} - {response.text}")
    except Exception as e:
        logger.error(f"Error fetching batches from webapp: {e}")
        
    batches = await db.batches.find({"user_id": user.user_id}, {"_id": 0}).to_list(100)
    if not batches:
        batches = await db.batches.find({"org_id": user.org_id}, {"_id": 0}).to_list(100)
    return {"batches": batches}


@api_router.get("/batches/{batch_id}/students")
async def get_batch_students(batch_id: str, authorization: Optional[str] = Header(None)):
    """Get students in a batch (proxied to webapp)"""
    user = await get_current_user(authorization)
    
    # 1. Fetch students from webapp
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        students = await db.students.find({"batch_id": batch_id}, {"_id": 0}).to_list(1000)
        return {"students": students}
        
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    if token == "sess_mock_token_12345":
        students = await db.students.find({"batch_id": batch_id}, {"_id": 0}).to_list(1000)
        if not students:
            students = [
                {"student_id": "std_001", "roll_number": "10", "name": "Aarav Sharma", "batch_id": batch_id},
                {"student_id": "std_002", "roll_number": "11", "name": "Aditi Patel", "batch_id": batch_id},
                {"student_id": "std_003", "roll_number": "12", "name": "Amit Kumar", "batch_id": batch_id}
            ]
        return {"students": students}
        
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.get(
                f"{webapp_url.rstrip('/')}/api/v1/students",
                params={"batchId": batch_id},
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0
            )
            if response.status_code == 200:
                res_data = response.json()
                webapp_students = res_data.get("data", [])
                
                mapped_students = []
                for s in webapp_students:
                    mapped_students.append({
                        "student_id": s.get("id"),
                        "roll_number": s.get("rollNumber") or "",
                        "name": s.get("name") or "Unnamed Student",
                        "batch_id": batch_id
                    })
                    
                for ms in mapped_students:
                    await db.students.update_one(
                        {"student_id": ms["student_id"]},
                        {"$set": ms},
                        upsert=True
                    )
                    
                await db.batches.update_one(
                    {"batch_id": batch_id},
                    {"$set": {"student_count": len(mapped_students)}}
                )
                    
                return {"students": mapped_students}
            else:
                logger.warning(f"Failed to fetch students from webapp: {response.status_code} - {response.text}")
    except Exception as e:
        logger.error(f"Error fetching students from webapp: {e}")
        
    students = await db.students.find({"batch_id": batch_id}, {"_id": 0}).to_list(1000)
    return {"students": students}


@api_router.get("/subjects")
async def get_subjects(authorization: Optional[str] = Header(None)):
    """Get all subjects for the teacher (proxied to webapp)"""
    user = await get_current_user(authorization)
    
    # 1. Fetch subjects from webapp
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        subjects = await db.subjects.find({"teacher_id": user.user_id}, {"_id": 0}).to_list(100)
        return {"subjects": subjects}
    
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    if token == "sess_mock_token_12345":
        subjects = await db.subjects.find({"teacher_id": user.user_id}, {"_id": 0}).to_list(100)
        if not subjects:
            subjects = [
                {"id": "subj_001", "name": "Science", "teacher_id": user.user_id},
                {"id": "subj_002", "name": "Physics", "teacher_id": user.user_id}
            ]
        return {"subjects": subjects}
        
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.get(
                f"{webapp_url.rstrip('/')}/api/v1/subjects",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0
            )
            if response.status_code == 200:
                res_data = response.json()
                webapp_subjects = res_data.get("data", [])
                
                mapped_subjects = []
                for s in webapp_subjects:
                    mapped_subjects.append({
                        "id": s.get("id"),
                        "name": s.get("name"),
                        "class_standard": s.get("classStandard"),
                        "teacher_id": user.user_id
                    })
                
                for ms in mapped_subjects:
                    await db.subjects.update_one(
                        {"id": ms["id"]},
                        {"$set": ms},
                        upsert=True
                    )
                    
                return {"subjects": mapped_subjects}
            else:
                logger.warning(f"Failed to fetch subjects from webapp: {response.status_code} - {response.text}")
    except Exception as e:
        logger.error(f"Error fetching subjects from webapp: {e}")
        
    subjects = await db.subjects.find({"teacher_id": user.user_id}, {"_id": 0}).to_list(100)
    return {"subjects": subjects}


# ==================== SCAN SESSIONS ROUTES ====================

@api_router.post("/scan-sessions/create")
async def create_scan_session(data: ScanSessionCreate, authorization: Optional[str] = Header(None)):
    """Create a new scan session"""
    user = await get_current_user(authorization)
    session_id = f"scan_{uuid.uuid4().hex[:12]}"
    
    # Find batch info from db
    batch = await db.batches.find_one({"batch_id": data.batch_id}, {"_id": 0})
    batch_name = batch["name"] if batch else "Unknown Batch"
    
    session = ScanSession(
        session_id=session_id,
        session_name=data.session_name,
        batch_id=data.batch_id,
        batch_name=batch_name,
        subject_id=data.subject_id,
        total_marks=data.total_marks,
        exam_date=data.exam_date,
        user_id=user.user_id,
        org_id=user.org_id,
        settings=data.settings
    )
    
    await db.scan_sessions.insert_one(session.model_dump())
    
    return {"session_id": session_id}

@api_router.post("/scan-sessions/{session_id}/upload-qp")
async def upload_question_paper(session_id: str, data: UploadQpRequest, authorization: Optional[str] = Header(None)):
    """Upload question paper metadata"""
    user = await get_current_user(authorization)
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$set": {"question_paper.pages": [p.model_dump() for p in data.pages], "question_paper.page_count": len(data.pages)}}
    )
    return {"status": "success", "pages_received": len(data.pages)}


@api_router.post("/scan-sessions/{session_id}/upload-file")
async def upload_file(
    session_id: str,
    page_number: int = Form(...),
    phase: str = Form(...),
    student_index: Optional[int] = Form(None),
    mode: str = Form("enhanced"), # original, enhanced, bw, high_contrast
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None)
):
    """
    Memory-safe multipart upload with production-hardened storage.
    Supports on-the-fly quality mode processing.
    """
    logger.info(f"Upload: session={session_id}, phase={phase}, page={page_number}, mode={mode}")
    user = await get_current_user(authorization)
    
    # Generate deterministic filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = f"s{student_index}_" if student_index is not None else ""
    # Safe filename without special characters
    filename = f"{phase}_{suffix}p{page_number}_{timestamp}_{uuid.uuid4().hex[:6]}.jpg"
    
    # Save to storage abstraction
    file_url = storage.save_file(session_id, filename, file.file)
    
    # Update stats if needed (placeholder for future metrics)
    return {
        "status": "success",
        "file_url": file_url,
        "filename": filename
    }


@api_router.get("/files/{session_id}/{filename}")
async def get_file(session_id: str, filename: str):
    """Production-hardened file serving (supports Local and GCS)"""
    provider = os.environ.get("STORAGE_PROVIDER", "local").lower()
    if provider == "gcs":
        if hasattr(storage, "get_signed_url"):
            signed_url = storage.get_signed_url(session_id, filename)
            if signed_url:
                from fastapi.responses import RedirectResponse
                return RedirectResponse(url=signed_url, status_code=307)
        
        logger.error(f"File not found on GCS: {session_id}/{filename}")
        raise HTTPException(status_code=404, detail="File not found")
    else:
        file_path = storage.get_file_path(session_id, filename)
        if not file_path or not file_path.exists():
            logger.error(f"File not found: {session_id}/{filename}")
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(
            file_path, 
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"}
        )


@api_router.post("/scan-sessions/{session_id}/upload-model")
async def upload_model_answer(session_id: str, data: UploadModelRequest, authorization: Optional[str] = Header(None)):
    """Upload model answer metadata"""
    user = await get_current_user(authorization)
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$set": {"model_answer.pages": [p.model_dump() for p in data.pages], "model_answer.page_count": len(data.pages)}}
    )
    return {"status": "success", "pages_received": len(data.pages)}


@api_router.post("/scan-sessions/{session_id}/upload-student")
async def upload_student_papers(session_id: str, data: UploadStudentRequest, authorization: Optional[str] = Header(None)):
    """Upload student papers metadata"""
    user = await get_current_user(authorization)
    # Check if student exists
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user.user_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    # We can just push to students array. If we want to replace, we can remove existing student index first
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$pull": {"students": {"student_index": data.student.student_index}}}
    )
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$push": {"students": data.student.model_dump()}}
    )
    return {"status": "success", "pages_received": len(data.student.pages)}


async def compile_pdf_and_upload_to_webapp(session_id: str, user_id: str, token: str) -> str:
    """
    Compiles JPEG scans from a scan session into PDFs and uploads them to the webapp.
    Creates an Exam on the webapp first, uploads QP/Model PDFs, and then bulk uploads student PDFs.
    Returns the created webapp exam_id.
    """
    import tempfile
    import shutil
    import asyncio
    from PIL import Image
    
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        logger.warning("WEBAPP_URL not set, skipping webapp sync")
        return f"exam_mock_{uuid.uuid4().hex[:8]}"

    # 1. Fetch the scan session details from MongoDB
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user_id})
    if not session:
        raise ValueError("Scan session not found")

    # 2. Call the webapp to create the exam
    exam_payload = {
        "name": session["session_name"],
        "batchId": session["batch_id"],
        "subjectId": session.get("subject_id") or None,
        "totalMarks": session.get("total_marks") or None,
        "examDate": session.get("exam_date") or None
    }
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Bypass-Tunnel-Reminder": "true"
    }

    async with httpx.AsyncClient() as client_http:
        try:
            logger.info(f"Creating exam on webapp for batch {session['batch_id']}...")
            res = await client_http.post(
                f"{webapp_url.rstrip('/')}/api/v1/exams",
                json=exam_payload,
                headers=headers,
                timeout=30.0
            )
            if res.status_code != 201:
                logger.error(f"Failed to create exam on webapp: {res.status_code} - {res.text}")
                raise ValueError(f"Failed to create exam on webapp: {res.text}")
            
            exam_data = res.json().get("data", {})
            exam_id = exam_data.get("id")
            if not exam_id:
                raise ValueError("Exam creation response missing ID")
            logger.info(f"Exam created successfully on webapp: {exam_id}")
        except Exception as e:
            logger.error(f"Error creating exam: {e}")
            raise

        # Helper to download a page file from storage (Local or GCS)
        async def download_file_locally(p_metadata: dict, temp_dir: str) -> Optional[Path]:
            file_url = p_metadata.get("file_url") or p_metadata.get("file_path")
            if not file_url:
                return None
            
            filename = file_url.split("/")[-1]
            local_temp_path = Path(temp_dir) / filename
            
            provider = os.environ.get("STORAGE_PROVIDER", "local").lower()
            if provider == "gcs":
                try:
                    blob_path = f"{session_id}/{filename}"
                    blob = storage.bucket.blob(blob_path)
                    
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, blob.download_to_filename, str(local_temp_path))
                    return local_temp_path
                except Exception as ex:
                    logger.error(f"Failed to download from GCS: {blob_path} - {ex}")
                    return None
            else:
                local_src_path = storage.get_file_path(session_id, filename)
                if local_src_path and local_src_path.exists():
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, shutil.copy, local_src_path, local_temp_path)
                    return local_temp_path
                return None

        # Helper to compile page metadata into a single PDF
        async def compile_pages_to_pdf(pages_metadata: list, output_path: Path, compile_temp_dir: str) -> bool:
            images = []
            sorted_pages = sorted(pages_metadata, key=lambda x: x.get("page_number", 0))
            
            for p_meta in sorted_pages:
                local_img_path = await download_file_locally(p_meta, compile_temp_dir)
                if local_img_path and local_img_path.exists():
                    try:
                        img = Image.open(local_img_path)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        img.load()
                        images.append(img)
                    except Exception as ex:
                        logger.error(f"Error opening image {local_img_path}: {ex}")
                        
            if images:
                loop = asyncio.get_event_loop()
                def save_pdf():
                    images[0].save(
                        output_path,
                        save_all=True,
                        append_images=images[1:]
                    )
                await loop.run_in_executor(None, save_pdf)
                
                for img in images:
                    try:
                        img.close()
                    except Exception:
                        pass
                return True
            return False

        # Create a temp directory for compiling PDFs
        with tempfile.TemporaryDirectory() as compile_temp_dir:
            temp_dir_path = Path(compile_temp_dir)

            # 3. Upload Question Paper (if present)
            qp_pages = session.get("question_paper", {}).get("pages", [])
            if qp_pages:
                qp_pdf_path = temp_dir_path / "question_paper.pdf"
                logger.info(f"Compiling QP PDF with {len(qp_pages)} pages...")
                if await compile_pages_to_pdf(qp_pages, qp_pdf_path, compile_temp_dir):
                    logger.info("Uploading QP PDF to webapp...")
                    with open(qp_pdf_path, "rb") as f:
                        upload_res = await client_http.post(
                            f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/files/question_paper",
                            files={"file": ("question_paper.pdf", f, "application/pdf")},
                            headers={"Authorization": f"Bearer {token}"},
                            timeout=60.0
                        )
                        if upload_res.status_code != 201:
                            logger.error(f"Failed to upload QP PDF: {upload_res.status_code} - {upload_res.text}")

            # 4. Upload Model Answer (if present)
            ma_pages = session.get("model_answer", {}).get("pages", [])
            if ma_pages:
                ma_pdf_path = temp_dir_path / "model_answer.pdf"
                logger.info(f"Compiling Model Answer PDF with {len(ma_pages)} pages...")
                if await compile_pages_to_pdf(ma_pages, ma_pdf_path, compile_temp_dir):
                    logger.info("Uploading Model Answer PDF to webapp...")
                    with open(ma_pdf_path, "rb") as f:
                        upload_res = await client_http.post(
                            f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/files/model_answer",
                            files={"file": ("model_answer.pdf", f, "application/pdf")},
                            headers={"Authorization": f"Bearer {token}"},
                            timeout=60.0
                        )
                        if upload_res.status_code != 201:
                            logger.error(f"Failed to upload Model Answer PDF: {upload_res.status_code} - {upload_res.text}")

            # Determine source paper mode dynamically
            source_paper_mode = "separate"
            if not qp_pages and ma_pages:
                source_paper_mode = "combined_model_answer"

            # Create the upload flow state payload template
            flow_payload = {
                "examId": exam_id,
                "title": session["session_name"],
                "status": "draft",
                "currentStep": 3,
                "maxCompletedStep": 2,
                "state": {
                    "form": {
                        "name": session["session_name"],
                        "batchId": session["batch_id"],
                        "subjectId": session.get("subject_id") or "",
                        "totalMarks": str(session.get("total_marks") or 100),
                        "examDate": session.get("exam_date") or "",
                        "gradingMode": "balanced",
                        "gradingInstructions": "",
                        "feedbackEnabled": True
                    },
                    "sourcePaperMode": source_paper_mode,
                    "pilotReviewFirst": False,
                    "activeJobId": None,
                    "sessionSubmissionIds": []
                }
            }

            # 5. Auto-extract and Lock blueprint first so bulk upload grading jobs don't fail with 'blueprint not found'
            blueprint_extracted_and_locked = False
            if ma_pages:
                try:
                    logger.info(f"Triggering auto-extraction of blueprint on webapp for mode: {source_paper_mode}...")
                    extract_res = await client_http.post(
                        f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/blueprint/extract",
                        json={"sourceMode": source_paper_mode},
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=90.0
                    )
                    if extract_res.status_code not in (200, 201):
                        logger.error(f"Failed to auto-extract blueprint: {extract_res.status_code} - {extract_res.text}")
                    else:
                        logger.info("Blueprint auto-extracted successfully! Locking it...")
                        lock_res = await client_http.post(
                            f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/blueprint/lock",
                            json={"locked": True},
                            headers={"Authorization": f"Bearer {token}"},
                            timeout=30.0
                        )
                        if lock_res.status_code not in (200, 201):
                            logger.error(f"Failed to lock blueprint: {lock_res.status_code} - {lock_res.text}")
                        else:
                            logger.info("Blueprint locked successfully!")
                            blueprint_extracted_and_locked = True
                except Exception as ex:
                    logger.error(f"Error during blueprint extraction/locking: {ex}")

            # 6. Upload Students Submissions (if present)
            students = session.get("students", [])
            submission_files = []
            file_handles = []

            try:
                for idx, student in enumerate(students):
                    st_pages = student.get("pages", [])
                    if st_pages:
                        st_label = student.get("label") or f"student_{idx}"
                        clean_label = "".join(c for c in st_label if c.isalnum() or c in (" ", "_", "-")).strip()
                        clean_label = clean_label.replace(" ", "_")
                        
                        pdf_name = f"{clean_label}.pdf"
                        st_pdf_path = temp_dir_path / pdf_name
                        
                        logger.info(f"Compiling Student {clean_label} PDF with {len(st_pages)} pages...")
                        if await compile_pages_to_pdf(st_pages, st_pdf_path, compile_temp_dir):
                            f_handle = open(st_pdf_path, "rb")
                            file_handles.append(f_handle)
                            submission_files.append(("files", (pdf_name, f_handle, "application/pdf")))

                if submission_files:
                    logger.info(f"Bulk uploading {len(submission_files)} student submissions to webapp...")
                    upload_res = await client_http.post(
                        f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/submissions/bulk",
                        files=submission_files,
                        data={"autoQueue": "true"},
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=120.0
                    )
                    if upload_res.status_code not in (200, 201):
                        logger.error(f"Failed to bulk upload student papers: {upload_res.status_code} - {upload_res.text}")
                    else:
                        logger.info("Bulk upload completed successfully!")
                        try:
                            bulk_data = upload_res.json().get("data", {})
                            created_ids = bulk_data.get("createdSubmissionIds", [])
                            dup_ids = bulk_data.get("duplicateSubmissionIds", [])
                            submissions_list = bulk_data.get("submissions", [])
                            
                            sub_ids = []
                            for sub_detail in submissions_list:
                                sub = sub_detail.get("submission") if isinstance(sub_detail, dict) else None
                                if sub and "id" in sub:
                                    sub_ids.append(sub["id"])
                                elif isinstance(sub_detail, dict) and "id" in sub_detail:
                                    sub_ids.append(sub_detail["id"])
                                    
                            all_sub_ids = list(set(created_ids + dup_ids + sub_ids))
                            
                            job = bulk_data.get("job")
                            active_job_id = job.get("id") if (job and isinstance(job, dict)) else None
                            
                            if blueprint_extracted_and_locked:
                                flow_payload["currentStep"] = 5
                                flow_payload["maxCompletedStep"] = 5
                                flow_payload["status"] = "draft"
                            else:
                                flow_payload["currentStep"] = 4
                                flow_payload["maxCompletedStep"] = 2
                                flow_payload["status"] = "draft"
                                
                            flow_payload["state"]["activeJobId"] = active_job_id
                            flow_payload["state"]["sessionSubmissionIds"] = all_sub_ids
                        except Exception as ex:
                            logger.error(f"Error parsing bulk upload response for flow state: {ex}")
                else:
                    if blueprint_extracted_and_locked:
                        flow_payload["currentStep"] = 5
                        flow_payload["maxCompletedStep"] = 4
                        flow_payload["status"] = "draft"
                    else:
                        flow_payload["currentStep"] = 4
                        flow_payload["maxCompletedStep"] = 2
                        flow_payload["status"] = "draft"
            finally:
                for fh in file_handles:
                    try:
                        fh.close()
                    except Exception:
                        pass

            # 7. Create Upload Flow Session card on webapp
            try:
                logger.info("Creating upload flow session card on webapp...")
                flow_res = await client_http.post(
                    f"{webapp_url.rstrip('/')}/api/v1/exams/upload-flows",
                    json=flow_payload,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=30.0
                )
                if flow_res.status_code not in (200, 201):
                    logger.error(f"Failed to create upload flow session: {flow_res.status_code} - {flow_res.text}")
                else:
                    logger.info("Upload flow session card created successfully!")
            except Exception as e:
                logger.error(f"Error creating upload flow session card: {e}")

        return exam_id


@api_router.post("/scan-sessions/{session_id}/complete")
async def complete_scan_session(session_id: str, authorization: Optional[str] = Header(None)):
    """Mark scan session as complete and sync to webapp"""
    user = await get_current_user(authorization)
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    
    # 1. Update session status locally to completed
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$set": {"status": "completed"}}
    )
    
    # 2. Compile scanned JPEGs to PDFs and sync to main webapp (if not guest mode)
    if token != "sess_mock_token_12345":
        try:
            # We run the PDF compilation and sync
            exam_id = await compile_pdf_and_upload_to_webapp(session_id, user.user_id, token)
            return {"exam_id": exam_id, "status": "completed"}
        except Exception as e:
            logger.error(f"Failed to sync scan session to webapp: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to sync scanned data to webapp: {str(e)}")
    
    return {"exam_id": f"exam_{uuid.uuid4().hex[:8]}", "status": "completed"}


@api_router.get("/scan-sessions/{session_id}/status")
async def get_session_status(session_id: str, authorization: Optional[str] = Header(None)):
    """Get scan session status"""
    user = await get_current_user(authorization)
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user.user_id}, {"_id": 0})
    if not session:
        return {"status": "not_found"}
    return {"status": session.get("status", "unknown"), "progress": session.get("upload_progress", 0)}


@api_router.delete("/scan-sessions/{session_id}")
async def delete_scan_session(session_id: str, authorization: Optional[str] = Header(None)):
    """Delete a scan session"""
    user = await get_current_user(authorization)
    result = await db.scan_sessions.delete_many({"session_id": session_id, "user_id": user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found or already deleted")
    return {"status": "success", "deleted": True}


@api_router.get("/scan-sessions")
async def get_user_sessions(authorization: Optional[str] = Header(None)):
    """Get all scan sessions for the user"""
    user = await get_current_user(authorization)
    sessions = await db.scan_sessions.find({"user_id": user.user_id}, {"_id": 0}).to_list(100)
    return {"sessions": sessions}


# ==================== IMAGE ENHANCEMENT ====================

def order_points(pts):
    """Sorts 4 points in order: top-left, top-right, bottom-right, bottom-left"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def four_point_transform(image, pts):
    """Applies perspective transform to get a top-down view"""
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    return warped

def process_enhance(base64_str: str, mode: str = "enhanced", points: Optional[list] = None) -> str:
    """
    Production-quality image enhancement.
    Optimized for handwriting preservation and document readability.
    """
    try:
        # Remove prefix if present
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
            
        # Decode
        nparr = np.frombuffer(base64.b64decode(base64_str), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise ValueError("Could not decode image")

        # --- STEP 0: PERSPECTIVE CORRECTION ---
        if points and len(points) == 4:
            try:
                pts = np.array(points, dtype="float32")
                img = four_point_transform(img, pts)
                logger.info("Applied manual perspective correction")
            except Exception as e:
                logger.error(f"Perspective transform failed: {e}")

        if mode == "original":
            _, buffer = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            return base64.b64encode(buffer).decode('utf-8')

        # --- STEP 2: ENHANCEMENT PIPELINE ---
        # 1. Grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        if mode == "bw":
            # Pure B&W Adaptive Thresholding
            final = cv2.adaptiveThreshold(
                cv2.GaussianBlur(gray, (3, 3), 0), 
                255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                cv2.THRESH_BINARY, 21, 10
            )
        elif mode == "high_contrast":
            # Aggressive contrast
            alpha = 1.6 # Contrast control
            beta = -40  # Brightness control
            final = cv2.convertScaleAbs(gray, alpha=alpha, beta=beta)
        else: # DEFAULT: "enhanced" - HANDWRITING PRESERVING
            # Lighting Normalization (CLAHE) - Softer settings
            clahe = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(12, 12))
            normalized = clahe.apply(gray)
            
            # Bilateral Filter - Preserves edges (handwriting) while removing noise
            denoised = cv2.bilateralFilter(normalized, 7, 50, 50)
            
            # Subtle Sharpening
            sharpen_kernel = np.array([[-0.5,-0.5,-0.5], [-0.5,5,-0.5], [-0.5,-0.5,-0.5]])
            final = cv2.filter2D(denoised, -1, sharpen_kernel)
            
        # Encode back to JPEG
        _, buffer = cv2.imencode('.jpg', final, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        return base64.b64encode(buffer).decode('utf-8')
    except Exception as e:
        logger.error(f"Image enhancement error: {e}")
        return base64_str # Fallback to original

class EnhanceRequest(BaseModel):
    image: str
    mode: Optional[str] = "enhanced"
    points: Optional[list[list[float]]] = None

@api_router.post("/scan-sessions/enhance")
async def enhance_image_endpoint(data: EnhanceRequest, authorization: Optional[str] = Header(None)):
    """Apply real OpenCV enhancement to a captured image with mode support (Legacy Base64)"""
    enhanced_base64 = process_enhance(data.image, data.mode, data.points)
    return {"enhanced_image": enhanced_base64}

@api_router.post("/scan-sessions/enhance-file")
async def enhance_image_file_endpoint(
    mode: str = Form("enhanced"),
    points: Optional[str] = Form(None), # JSON string of points
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None)
):
    """
    Apply real OpenCV enhancement via multipart upload (Binary-safe).
    Eliminates Base64 overhead on mobile clients.
    """
    try:
        # Read file into memory
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

        # Parse points if provided
        parsed_points = None
        if points:
            import json
            parsed_points = json.loads(points)

        # Apply perspective transform if points provided
        if parsed_points and len(parsed_points) == 4:
            pts = np.array(parsed_points, dtype="float32")
            img = four_point_transform(img, pts)

        # Grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Enhancement logic (re-using logic from process_enhance but on raw mat)
        if mode == "bw":
            final = cv2.adaptiveThreshold(
                cv2.GaussianBlur(gray, (3, 3), 0), 
                255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                cv2.THRESH_BINARY, 21, 10
            )
        elif mode == "high_contrast":
            final = cv2.convertScaleAbs(gray, alpha=1.6, beta=-40)
        else: # enhanced
            clahe = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(12, 12))
            normalized = clahe.apply(gray)
            denoised = cv2.bilateralFilter(normalized, 7, 50, 50)
            sharpen_kernel = np.array([[-0.5,-0.5,-0.5], [-0.5,5,-0.5], [-0.5,-0.5,-0.5]])
            final = cv2.filter2D(denoised, -1, sharpen_kernel)

        # Encode to JPEG
        _, buffer = cv2.imencode('.jpg', final, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        
        # Return as Base64 for now to maintain frontend compatibility with the return path,
        # but the UPLOAD path is now binary-safe. 
        # (Future optimization: return binary and save to local FS directly)
        return {"enhanced_image": base64.b64encode(buffer).decode('utf-8')}
    except Exception as e:
        logger.error(f"Multipart enhancement error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== HEALTH CHECK ====================

@api_router.get("/")
async def root():
    return {"message": "GradeSense Scanner API", "status": "healthy"}


@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "webapp_url": os.environ.get("WEBAPP_URL")
    }


# Include the router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_db_client():
    try:
        await client.admin.command("ping")
        logger.info("Connected to MongoDB successfully")
    except PyMongoError as exc:
        logger.exception("MongoDB ping failed during startup")
        raise RuntimeError("Failed to connect to MongoDB during startup") from exc
    except Exception as exc:
        logger.exception("Unexpected MongoDB startup failure")
        raise RuntimeError("Unexpected MongoDB startup failure") from exc


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    logger.info("MongoDB client closed")
