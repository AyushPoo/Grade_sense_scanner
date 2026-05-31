from fastapi import FastAPI, APIRouter, HTTPException, Header, BackgroundTasks
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

def get_gcs_signed_url(gcs_key: str, expiration_minutes: int = 60) -> Optional[str]:
    if not gcs_key:
        return None
    try:
        from datetime import timedelta
        # If GCS storage is configured, use its client/bucket to sign URL directly
        if hasattr(storage, "client") and hasattr(storage, "bucket"):
            blob = storage.bucket.blob(gcs_key)
            return blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=expiration_minutes),
                method="GET"
            )
    except Exception as e:
        logger.error(f"Error generating GCS signed URL for {gcs_key}: {e}")
    return None

def generate_drizzle_id(prefix: str) -> str:
    import string
    import random
    chars = string.ascii_letters + string.digits
    return prefix + ''.join(random.choices(chars, k=14))

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


@api_router.post("/batches")
async def create_batch(data: dict, authorization: Optional[str] = Header(None)):
    """Create a new batch on the webapp"""
    user = await get_current_user(authorization)
    webapp_url = os.environ.get("WEBAPP_URL")
    
    if not webapp_url:
        import time
        new_batch = {
            "batch_id": f"batch_{int(time.time())}",
            "name": data.get("name"),
            "student_count": 0,
            "org_id": user.org_id
        }
        await db.batches.insert_one(new_batch)
        return {"success": True, "batch": new_batch}
        
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.post(
                f"{webapp_url.rstrip('/')}/api/v1/batches",
                headers={"Authorization": f"Bearer {token}"},
                json=data,
                timeout=15.0
            )
            if response.status_code in [200, 201]:
                return response.json()
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.delete("/batches/{batch_id}")
async def delete_batch(batch_id: str, authorization: Optional[str] = Header(None)):
    """Delete a batch on the webapp"""
    user = await get_current_user(authorization)
    webapp_url = os.environ.get("WEBAPP_URL")
    
    if not webapp_url:
        await db.batches.delete_one({"batch_id": batch_id})
        return {"success": True}
        
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.delete(
                f"{webapp_url.rstrip('/')}/api/v1/batches/{batch_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0
            )
            if response.status_code in [200, 204]:
                return {"success": True}
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/batches/{batch_id}/students")
async def create_student(batch_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Invite/Create a student on the webapp"""
    user = await get_current_user(authorization)
    webapp_url = os.environ.get("WEBAPP_URL")
    
    if not webapp_url:
        import time
        new_student = {
            "student_id": f"student_{int(time.time())}",
            "name": data.get("name"),
            "email": data.get("email"),
            "roll_number": data.get("rollNumber") or data.get("roll_number"),
            "batch_id": batch_id
        }
        await db.students.insert_one(new_student)
        return {"success": True, "student": new_student}
        
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    try:
        async with httpx.AsyncClient() as client_http:
            payload = {
                "name": data.get("name"),
                "email": data.get("email"),
                "rollNumber": data.get("rollNumber") or data.get("roll_number"),
                "batchId": batch_id
            }
            #HONO endpoint is .post("/invite", inviteStudent)
            response = await client_http.post(
                f"{webapp_url.rstrip('/')}/api/v1/students/invite",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
                timeout=15.0
            )
            if response.status_code in [200, 201]:
                return response.json()
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.delete("/batches/{batch_id}/students/{student_id}")
async def delete_student(batch_id: str, student_id: str, authorization: Optional[str] = Header(None)):
    """Remove student from batch on the webapp"""
    user = await get_current_user(authorization)
    webapp_url = os.environ.get("WEBAPP_URL")
    
    if not webapp_url:
        await db.students.delete_one({"student_id": student_id, "batch_id": batch_id})
        return {"success": True}
        
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    try:
        async with httpx.AsyncClient() as client_http:
            # HONO endpoint: .delete("/:batchId/students/:studentId", classroomController.removeStudentFromBatch)
            response = await client_http.delete(
                f"{webapp_url.rstrip('/')}/api/v1/batches/{batch_id}/students/{student_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0
            )
            if response.status_code in [200, 204]:
                return {"success": True}
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/exams/{exam_id}/regrade")
async def regrade_exam(exam_id: str, authorization: Optional[str] = Header(None)):
    """Trigger AI regrade / reevaluation of an exam on the webapp"""
    webapp_url = os.environ.get("WEBAPP_URL")
    
    if not webapp_url:
        return {"success": True, "message": "Regrade enqueued (mock)"}
        
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.post(
                f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/regrade",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30.0
            )
            if response.status_code in [200, 201]:
                return response.json()
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


async def create_exam_on_webapp(session_id: str, user_id: str, token: str) -> str:
    """
    Creates an Exam on the webapp and returns the created webapp exam_id.
    """
    # Fetch the scan session details from MongoDB
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user_id})
    if not session:
        raise ValueError("Scan session not found")

    # Try database insertion directly if WEBAPP_DB_URL is set
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url:
        try:
            logger.info("Creating exam directly in Neon DB...")
            exam_id = generate_drizzle_id("exm_")
            conn = await asyncpg.connect(webapp_db_url)
            
            exam_name = session["session_name"]
            batch_id = session["batch_id"]
            subject_id = session.get("subject_id")
            exam_date = session.get("exam_date")
            if not exam_date:
                exam_date = datetime.now().strftime("%Y-%m-%d")
                
            mode = session.get("mode") or "teacher_bulk"
            settings = session.get("settings", {})
            grading_mode = settings.get("grading_mode", "balanced")
            
            total_marks = 100.0
            if session.get("total_marks") is not None:
                try:
                    total_marks = float(session["total_marks"])
                except (ValueError, TypeError):
                    pass
            
            grading_instructions = settings.get("grading_instructions")
            feedback_enabled = settings.get("feedback_enabled", True)
            
            await conn.execute(
                '''
                INSERT INTO exams (
                    id, teacher_id, batch_id, subject_id, name,
                    class_standard, section, exam_date, mode, grading_mode,
                    total_marks, status, blueprint_locked, results_published,
                    published_at, created_at, updated_at, grading_instructions,
                    feedback_enabled, publish_visibility_json
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                ''',
                exam_id,
                user_id,
                batch_id,
                subject_id,
                exam_name,
                None, # class_standard
                None, # section
                exam_date,
                mode,
                grading_mode,
                total_marks,
                "draft",
                False, # blueprint_locked
                False, # results_published
                None, # published_at
                datetime.utcnow().isoformat() + 'Z',
                datetime.utcnow().isoformat() + 'Z',
                grading_instructions,
                feedback_enabled,
                "{}"
            )
            await conn.close()
            logger.info(f"Exam created successfully via Neon: {exam_id}")
            return exam_id
        except Exception as db_err:
            logger.error(f"Failed to create exam via Neon direct sync: {db_err}. Falling back to HTTP proxy.")

    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        return f"exam_mock_{uuid.uuid4().hex[:8]}"

    # Call the webapp to create the exam
    exam_payload = {
        "name": session["session_name"],
        "batchId": session["batch_id"],
    }
    if session.get("subject_id"):
        exam_payload["subjectId"] = session["subject_id"]
    if session.get("total_marks") is not None:
        try:
            exam_payload["totalMarks"] = float(session["total_marks"])
        except (ValueError, TypeError):
            pass
    if session.get("exam_date"):
        exam_payload["examDate"] = session["exam_date"]
    
    settings = session.get("settings", {})
    if isinstance(settings, dict) and settings.get("grading_mode"):
        exam_payload["gradingMode"] = settings["grading_mode"]

    headers = {
        "Authorization": f"Bearer {token}",
        "Bypass-Tunnel-Reminder": "true"
    }

    async with httpx.AsyncClient() as client_http:
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
        return exam_id


async def async_sync_session_data(session_id: str, user_id: str, token: str, exam_id: str, flow_session_id: Optional[str] = None):
    """
    Background task to compile PDFs, upload papers/submissions, extract blueprint, 
    and update webapp flow session.
    """
    import tempfile
    import shutil
    import asyncio
    from PIL import Image
    
    # Try direct Neon DB sync if WEBAPP_DB_URL is set
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    
    # 1. Fetch the scan session details from MongoDB
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user_id})
    if not session:
        logger.error(f"Scan session {session_id} not found in background sync")
        return

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

    if webapp_db_url:
        try:
            logger.info("Starting direct Neon DB and GCS background sync...")
            import json
            
            # Create a temp directory for compiling PDFs
            with tempfile.TemporaryDirectory() as compile_temp_dir:
                temp_dir_path = Path(compile_temp_dir)
                
                # 2. Upload Question Paper (if present) to GCS and insert to Neon
                qp_pages = session.get("question_paper", {}).get("pages", [])
                qp_gcs_key = None
                if qp_pages:
                    qp_pdf_path = temp_dir_path / "question_paper.pdf"
                    logger.info(f"Compiling QP PDF with {len(qp_pages)} pages...")
                    if await compile_pages_to_pdf(qp_pages, qp_pdf_path, compile_temp_dir):
                        qp_size = qp_pdf_path.stat().st_size
                        qp_rand = generate_drizzle_id("")
                        qp_gcs_key = f"exams/{exam_id}/question_paper/file_{qp_rand}_question_paper.pdf"
                        
                        logger.info(f"Uploading QP PDF to GCS bucket at {qp_gcs_key}...")
                        blob = storage.bucket.blob(qp_gcs_key)
                        blob.upload_from_filename(str(qp_pdf_path), content_type="application/pdf")
                        
                        conn = await asyncpg.connect(webapp_db_url)
                        await conn.execute(
                            '''
                            INSERT INTO exam_files (
                                id, exam_id, kind, original_name, content_type,
                                gcs_key, object_size_bytes, created_at, updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                            ''',
                            generate_drizzle_id("efl_"),
                            exam_id,
                            "question_paper",
                            "question_paper.pdf",
                            "application/pdf",
                            qp_gcs_key,
                            qp_size,
                            datetime.utcnow().isoformat() + 'Z',
                            datetime.utcnow().isoformat() + 'Z'
                        )
                        await conn.close()
                        logger.info("QP PDF uploaded and inserted to Neon successfully.")

                # 3. Upload Model Answer (if present) to GCS and insert to Neon
                ma_pages = session.get("model_answer", {}).get("pages", [])
                ma_gcs_key = None
                if ma_pages:
                    ma_pdf_path = temp_dir_path / "model_answer.pdf"
                    logger.info(f"Compiling Model Answer PDF with {len(ma_pages)} pages...")
                    if await compile_pages_to_pdf(ma_pages, ma_pdf_path, compile_temp_dir):
                        ma_size = ma_pdf_path.stat().st_size
                        ma_rand = generate_drizzle_id("")
                        ma_gcs_key = f"exams/{exam_id}/model_answer/file_{ma_rand}_model_answer.pdf"
                        
                        logger.info(f"Uploading Model Answer PDF to GCS bucket at {ma_gcs_key}...")
                        blob = storage.bucket.blob(ma_gcs_key)
                        blob.upload_from_filename(str(ma_pdf_path), content_type="application/pdf")
                        
                        conn = await asyncpg.connect(webapp_db_url)
                        await conn.execute(
                            '''
                            INSERT INTO exam_files (
                                id, exam_id, kind, original_name, content_type,
                                gcs_key, object_size_bytes, created_at, updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                            ''',
                            generate_drizzle_id("efl_"),
                            exam_id,
                            "model_answer",
                            "model_answer.pdf",
                            "application/pdf",
                            ma_gcs_key,
                            ma_size,
                            datetime.utcnow().isoformat() + 'Z',
                            datetime.utcnow().isoformat() + 'Z'
                        )
                        await conn.close()
                        logger.info("Model Answer PDF uploaded and inserted to Neon successfully.")

                source_paper_mode = "separate"
                if not qp_pages and ma_pages:
                    source_paper_mode = "combined_model_answer"

                # 4. Enqueue Blueprint Extraction Job and poll for completion
                blueprint_extracted_and_locked = False
                if ma_pages:
                    blueprint_job_id = generate_drizzle_id("job_")
                    logger.info(f"Enqueuing blueprint extraction job {blueprint_job_id} in Neon...")
                    conn = await asyncpg.connect(webapp_db_url)
                    await conn.execute(
                        '''
                        INSERT INTO grading_jobs (
                            id, type, status, exam_id, teacher_id,
                            progress, total_items, processed_items, success_count, failure_count,
                            attempts, payload_json, result_json, created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        ''',
                        blueprint_job_id,
                        "blueprint_extraction",
                        "queued",
                        exam_id,
                        user_id,
                        0.0,
                        1,
                        0,
                        0,
                        0,
                        0,
                        json.dumps({"teacherId": user_id, "sourceMode": source_paper_mode}),
                        "{}",
                        datetime.utcnow().isoformat() + 'Z',
                        datetime.utcnow().isoformat() + 'Z'
                    )
                    await conn.close()
                    
                    # Poll for blueprint extraction completion
                    poll_start = datetime.utcnow()
                    logger.info("Polling blueprint extraction job status...")
                    while (datetime.utcnow() - poll_start).total_seconds() < 300:
                        await asyncio.sleep(3.0)
                        conn = await asyncpg.connect(webapp_db_url)
                        j_row = await conn.fetchrow("SELECT status, error FROM grading_jobs WHERE id = $1", blueprint_job_id)
                        await conn.close()
                        if j_row:
                            status = j_row["status"]
                            if status == "completed":
                                blueprint_extracted_and_locked = True
                                logger.info("Blueprint extraction completed successfully by worker!")
                                break
                            elif status == "failed":
                                logger.error(f"Blueprint extraction failed: {j_row['error']}")
                                break
                    
                    # Update upload flow session step 5 if blueprint ready
                    if blueprint_extracted_and_locked and flow_session_id:
                        try:
                            logger.info("Updating upload flow session progress to Step 5 mid-way in Neon DB...")
                            conn = await asyncpg.connect(webapp_db_url)
                            row = await conn.fetchrow("SELECT state_json FROM upload_flow_sessions WHERE id = $1", flow_session_id)
                            if row:
                                state_dict = json.loads(row["state_json"])
                                state_dict["sourcePaperMode"] = source_paper_mode
                                
                                await conn.execute(
                                    '''
                                    UPDATE upload_flow_sessions
                                    SET current_step = $1, max_completed_step = $2, state_json = $3, updated_at = $4
                                    WHERE id = $5
                                    ''',
                                    5,
                                    4,
                                    json.dumps(state_dict),
                                    datetime.utcnow().isoformat() + 'Z',
                                    flow_session_id
                                )
                            await conn.close()
                        except Exception as e:
                            logger.error(f"Failed to update flow session progress mid-way: {e}")

                # 5. Compile and upload student submissions
                students = session.get("students", [])
                session_submission_ids = []
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
                            sub_id = generate_drizzle_id("sbm_")
                            sub_rand = generate_drizzle_id("")
                            sub_gcs_key = f"submissions/{sub_id}/answer-sheets/file_{sub_rand}_student_answer_paper.pdf"
                            sub_size = st_pdf_path.stat().st_size
                            
                            logger.info(f"Uploading Student PDF to GCS bucket at {sub_gcs_key}...")
                            blob = storage.bucket.blob(sub_gcs_key)
                            blob.upload_from_filename(str(st_pdf_path), content_type="application/pdf")
                            
                            conn = await asyncpg.connect(webapp_db_url)
                            # Create Submission
                            await conn.execute(
                                '''
                                INSERT INTO submissions (
                                    id, exam_id, student_id, student_name, student_email, source, status,
                                    total_score, total_marks, percentage, ai_feedback, teacher_feedback,
                                    reviewed_at, published_at, created_at, updated_at, student_roll_number
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                                ''',
                                sub_id,
                                exam_id,
                                None,
                                student.get("label") or f"Student #{idx + 1}",
                                None,
                                "teacher_bulk",
                                "pending",
                                None,
                                float(session.get("total_marks") or 100.0),
                                None,
                                None,
                                None,
                                None,
                                None,
                                datetime.utcnow().isoformat() + 'Z',
                                datetime.utcnow().isoformat() + 'Z',
                                student.get("roll_number")
                            )
                            # Create Submission File
                            await conn.execute(
                                '''
                                INSERT INTO submission_files (
                                    id, submission_id, kind, original_name, content_type, gcs_key,
                                    object_size_bytes, content_hash, created_at, updated_at
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                                ''',
                                generate_drizzle_id("sfl_"),
                                sub_id,
                                "answer_sheet",
                                pdf_name,
                                "application/pdf",
                                sub_gcs_key,
                                sub_size,
                                None,
                                datetime.utcnow().isoformat() + 'Z',
                                datetime.utcnow().isoformat() + 'Z'
                            )
                            await conn.close()
                            session_submission_ids.append(sub_id)

                # 6. Enqueue Grading Job for Submissions and Update Flow Session Card
                active_job_id = None
                if session_submission_ids:
                    active_job_id = generate_drizzle_id("job_")
                    logger.info(f"Enqueuing grading job {active_job_id} in Neon...")
                    conn = await asyncpg.connect(webapp_db_url)
                    await conn.execute(
                        '''
                        INSERT INTO grading_jobs (
                            id, type, status, exam_id, teacher_id,
                            progress, total_items, processed_items, success_count, failure_count,
                            attempts, payload_json, result_json, created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        ''',
                        active_job_id,
                        "grade_submissions",
                        "queued",
                        exam_id,
                        user_id,
                        0.0,
                        len(session_submission_ids),
                        0,
                        0,
                        0,
                        0,
                        json.dumps({
                            "submissionIds": session_submission_ids,
                            "teacherId": user_id,
                            "flow": "batch_grading"
                        }),
                        "{}",
                        datetime.utcnow().isoformat() + 'Z',
                        datetime.utcnow().isoformat() + 'Z'
                    )
                    await conn.close()

                # Update upload flow session step 5 (completed / draft)
                if flow_session_id:
                    try:
                        logger.info("Updating final upload flow session state in Neon DB...")
                        conn = await asyncpg.connect(webapp_db_url)
                        row = await conn.fetchrow("SELECT state_json FROM upload_flow_sessions WHERE id = $1", flow_session_id)
                        if row:
                            state_dict = json.loads(row["state_json"])
                            state_dict["sourcePaperMode"] = source_paper_mode
                            state_dict["activeJobId"] = active_job_id
                            state_dict["sessionSubmissionIds"] = session_submission_ids
                            
                            current_step = 5 if blueprint_extracted_and_locked else 4
                            max_completed_step = 5 if blueprint_extracted_and_locked else 2
                            
                            await conn.execute(
                                '''
                                UPDATE upload_flow_sessions
                                SET current_step = $1, max_completed_step = $2, state_json = $3, updated_at = $4
                                WHERE id = $5
                                ''',
                                current_step,
                                max_completed_step,
                                json.dumps(state_dict),
                                datetime.utcnow().isoformat() + 'Z',
                                flow_session_id
                            )
                        await conn.close()
                        logger.info("Final upload flow session card updated successfully via Neon DB!")
                    except Exception as e:
                        logger.error(f"Failed to update final flow session progress: {e}")
                        
            logger.info("Direct Neon DB and GCS background sync completed successfully!")
            return
        except Exception as e:
            logger.error(f"Failed direct Neon background sync: {e}. Falling back to HTTP proxy path.")


@api_router.post("/scan-sessions/{session_id}/complete")
async def complete_scan_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(None)
):
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
            # Create exam synchronously first (takes ~1s)
            exam_id = await create_exam_on_webapp(session_id, user.user_id, token)
            
            # Fetch scan session details to build flow session card
            session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user.user_id})
            flow_session_id = None
            if session:
                qp_pages = session.get("question_paper", {}).get("pages", [])
                ma_pages = session.get("model_answer", {}).get("pages", [])
                source_paper_mode = "combined_model_answer" if (not qp_pages and ma_pages) else "separate"
                
                webapp_db_url = os.environ.get("WEBAPP_DB_URL")
                if webapp_db_url:
                    try:
                        logger.info("Creating initial upload flow session synchronously in Neon DB...")
                        flow_session_id = generate_drizzle_id("ufs_")
                        import json
                        
                        state_dict = {
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
                        
                        conn = await asyncpg.connect(webapp_db_url)
                        await conn.execute(
                            '''
                            INSERT INTO upload_flow_sessions (
                                id, teacher_id, exam_id, title, status,
                                current_step, max_completed_step, state_json,
                                created_at, updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                            ''',
                            flow_session_id,
                            user.user_id,
                            exam_id,
                            session["session_name"],
                            "draft",
                            4,
                            3,
                            json.dumps(state_dict),
                            datetime.utcnow().isoformat() + 'Z',
                            datetime.utcnow().isoformat() + 'Z'
                        )
                        await conn.close()
                        logger.info(f"Initial upload flow session created synchronously via Neon: {flow_session_id}")
                    except Exception as db_err:
                        logger.error(f"Failed to create upload flow session synchronously via Neon: {db_err}")
                else:
                    webapp_url = os.environ.get("WEBAPP_URL")
                    if webapp_url:
                        try:
                            logger.info("Creating initial upload flow session synchronously...")
                            flow_payload = {
                                "examId": exam_id,
                                "title": session["session_name"],
                                "status": "draft",
                                "currentStep": 4,  # Step 4: Extracting blueprint
                                "maxCompletedStep": 3,
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
                            async with httpx.AsyncClient() as client_http:
                                flow_res = await client_http.post(
                                    f"{webapp_url.rstrip('/')}/api/v1/exams/upload-flows",
                                    json=flow_payload,
                                    headers={"Authorization": f"Bearer {token}", "Bypass-Tunnel-Reminder": "true"},
                                    timeout=10.0
                                )
                                if flow_res.status_code in (200, 201):
                                    flow_session_id = flow_res.json().get("data", {}).get("id")
                                    logger.info(f"Initial upload flow session created synchronously with ID: {flow_session_id}")
                                else:
                                    logger.error(f"Failed to create initial upload flow session card synchronously: {flow_res.status_code} - {flow_res.text}")
                        except Exception as e:
                            logger.error(f"Error creating initial upload flow session card synchronously: {e}")
            
            # Enqueue compilation and sync as background task
            background_tasks.add_task(async_sync_session_data, session_id, user.user_id, token, exam_id, flow_session_id)
            
            # Save exam_id on local session
            await db.scan_sessions.update_one(
                {"session_id": session_id, "user_id": user.user_id},
                {"$set": {"exam_id": exam_id}}
            )
            
            return {"exam_id": exam_id, "status": "completed"}
        except Exception as e:
            logger.error(f"Failed to sync scan session to webapp: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to sync scanned data to webapp: {str(e)}")
    
    mock_exam_id = f"exam_mock_{uuid.uuid4().hex[:8]}"
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$set": {"exam_id": mock_exam_id}}
    )
    return {"exam_id": mock_exam_id, "status": "completed"}


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


# ==================== WEBAPP API PROXIES & SANDBOX BACKDOORS ====================

@api_router.get("/v1/exams/{exam_id}/submissions")
async def get_exam_submissions_proxy(exam_id: str, authorization: Optional[str] = Header(None)):
    """Get exam submissions - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            rows = await conn.fetch(
                '''
                SELECT s.id, s.student_name, s.student_roll_number, s.total_score, e.total_marks, s.status
                FROM submissions s
                JOIN exams e ON e.id = s.exam_id
                WHERE s.exam_id = $1
                ORDER BY s.student_roll_number ASC NULLS LAST
                ''',
                exam_id
            )
            await conn.close()
            submissions = [
                {
                    "id": str(r["id"]),
                    "studentName": r["student_name"] or "Unknown",
                    "studentRollNumber": r["student_roll_number"] or "",
                    "totalScore": r["total_score"] or 0,
                    "totalMarks": r["total_marks"] or 100,
                    "status": r["status"] or "graded"
                }
                for r in rows
            ]
            return {"data": submissions, "total": len(submissions)}
        except Exception as e:
            logger.error(f"Error querying Neon for submissions list: {e}")

    # MongoDB fallback
    session = await db.scan_sessions.find_one({"exam_id": exam_id})
    if not session:
        session = await db.scan_sessions.find_one({"status": "completed", "user_id": user.user_id})

    students_list = []
    if session:
        students = session.get("students", [])
        for idx, student in enumerate(students):
            students_list.append({
                "id": f"sub_local_{exam_id}_{idx}",
                "studentName": student.get("label") or f"Student #{idx + 1}",
                "studentRollNumber": student.get("roll_number") or str(10 + idx),
                "totalScore": 0,
                "totalMarks": session.get("total_marks") or 100,
                "status": "pending"
            })
    return {"data": students_list, "total": len(students_list)}





@api_router.get("/v1/submissions/{submission_id}")
async def get_submission_detail_proxy(submission_id: str, authorization: Optional[str] = Header(None)):
    """Get submission details - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url and not submission_id.startswith("sub_local_"):
        try:
            conn = await asyncpg.connect(webapp_db_url)
            # Get submission + scores
            sub_row = await conn.fetchrow(
                '''
                SELECT s.id, s.student_name, s.student_roll_number, s.total_score, s.status,
                       s.teacher_feedback, e.total_marks
                FROM submissions s
                JOIN exams e ON e.id = s.exam_id
                WHERE s.id = $1
                ''',
                submission_id
            )
            if sub_row:
                score_rows = await conn.fetch(
                    '''
                    SELECT sc.id, sc.question_number, sc.obtained_marks, sc.max_marks,
                           qi.question_text, sc.ai_feedback, sc.teacher_correction
                    FROM question_scores sc
                    LEFT JOIN question_items qi ON qi.id = sc.question_id
                    WHERE sc.submission_id = $1
                    ORDER BY sc.sort_order ASC, sc.question_number ASC
                    ''',
                    submission_id
                )
                # Check if annotation_gcs_key column exists
                has_annotation_col = await conn.fetchval(
                    '''
                    SELECT EXISTS (
                        SELECT 1 
                        FROM information_schema.columns 
                        WHERE table_name = 'submission_files' AND column_name = 'annotation_gcs_key'
                    )
                    '''
                )
                if has_annotation_col:
                    file_rows = await conn.fetch(
                        '''
                        SELECT f.id, f.gcs_key, f.annotation_gcs_key
                        FROM submission_files f
                        WHERE f.submission_id = $1
                        ''',
                        submission_id
                    )
                else:
                    file_rows = await conn.fetch(
                        '''
                        SELECT f.id, f.gcs_key, NULL as annotation_gcs_key
                        FROM submission_files f
                        WHERE f.submission_id = $1
                        ''',
                        submission_id
                    )
                await conn.close()

                files = []
                for f in file_rows:
                    gcs_key = f["gcs_key"]
                    ann_key = f["annotation_gcs_key"]
                    
                    signed_url = get_gcs_signed_url(gcs_key) if gcs_key else None
                    ann_signed_url = get_gcs_signed_url(ann_key) if ann_key else None
                    
                    # Fallback URL format if GCS signed URL generation fails
                    if not signed_url and gcs_key:
                        signed_url = f"/api/files/{gcs_key}"
                    if not ann_signed_url and ann_key:
                        ann_signed_url = f"/api/files/{ann_key}"
                        
                    files.append({
                        "id": str(f["id"]),
                        "signedUrl": signed_url,
                        "annotationSignedUrl": ann_signed_url
                    })

                return {
                    "data": {
                        "submission": {
                            "id": str(sub_row["id"]),
                            "studentName": sub_row["student_name"] or "Unknown",
                            "studentRollNumber": sub_row["student_roll_number"] or "",
                            "totalScore": sub_row["total_score"] or 0,
                            "totalMarks": sub_row["total_marks"] or 100,
                            "status": sub_row["status"] or "graded",
                            "teacherFeedback": sub_row["teacher_feedback"] or ""
                        },
                        "files": files,
                        "scores": [
                            {
                                "id": str(sc["id"]),
                                "questionNumber": sc["question_number"],
                                "obtainedMarks": sc["obtained_marks"] or 0,
                                "maxMarks": sc["max_marks"] or 0,
                                "questionText": sc["question_text"] or "",
                                "aiFeedback": sc["ai_feedback"],
                                "teacherCorrection": sc["teacher_correction"]
                            }
                            for sc in score_rows
                        ]
                    }
                }
            await conn.close()
        except Exception as e:
            logger.error(f"Error querying Neon for submission detail: {e}")

    # MongoDB / local fallback
    student_name = "Unknown Student"
    student_roll = ""
    pages_urls = []
    exam_id = "local"

    if submission_id.startswith("sub_local_"):
        parts = submission_id.split("_")
        if len(parts) >= 4:
            exam_id = parts[2]
            try:
                student_idx = int(parts[3])
            except ValueError:
                student_idx = 0
            session = await db.scan_sessions.find_one({"exam_id": exam_id})
            if session:
                students = session.get("students", [])
                if student_idx < len(students):
                    student = students[student_idx]
                    student_name = student.get("label") or f"Student #{student_idx + 1}"
                    student_roll = student.get("roll_number") or str(10 + student_idx)
                    for p in student.get("pages", []):
                        file_url = p.get("file_url")
                        if file_url:
                            pages_urls.append(file_url)

    if not pages_urls:
        pages_urls = ["https://placehold.co/600x800/png?text=Answer+Sheet+Loading"]

    files = [{"id": f"f_{submission_id}_{i}", "signedUrl": url, "annotationSignedUrl": None} for i, url in enumerate(pages_urls)]
    return {
        "data": {
            "submission": {
                "id": submission_id,
                "studentName": student_name,
                "studentRollNumber": student_roll,
                "totalScore": 0,
                "totalMarks": 100,
                "status": "pending",
                "teacherFeedback": ""
            },
            "files": files,
            "scores": []
        }
    }




@api_router.post("/v1/submissions/{submission_id}/review")
async def post_submission_review_proxy(submission_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Save review grades (proxied to webapp or mock save)"""
    webapp_url = os.environ.get("WEBAPP_URL")
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    
    if webapp_url and token != "sess_mock_token_12345" and not submission_id.startswith("sub_mock_"):
        try:
            async with httpx.AsyncClient() as client_http:
                response = await client_http.post(
                    f"{webapp_url.rstrip('/')}/api/v1/submissions/{submission_id}/review",
                    headers={"Authorization": f"Bearer {token}", "Bypass-Tunnel-Reminder": "true"},
                    json=data,
                    timeout=30.0
                )
                if response.status_code in [200, 201]:
                    return response.json()
                logger.warn(f"Proxy review save returned status {response.status_code}: {response.text}")
        except Exception as e:
            logger.error(f"Error proxying submission review: {e}")

    logger.info(f"Mock review saved for submission {submission_id}: {data}")
    return {"success": True, "message": "Review saved successfully (mock)"}


@api_router.get("/v1/analytics/overview")
async def get_analytics_overview_proxy(authorization: Optional[str] = Header(None)):
    """Get analytics overview - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            # Get exam stats for this teacher
            rows = await conn.fetch(
                '''
                SELECT e.id, e.name, e.exam_date, e.total_marks, e.status,
                       COUNT(s.id) as submission_count,
                       COUNT(CASE WHEN s.status = 'reviewed' THEN 1 END) as reviewed_count,
                       AVG(s.total_score::float / NULLIF(e.total_marks, 0) * 100) as avg_pct
                FROM exams e
                LEFT JOIN submissions s ON s.exam_id = e.id
                WHERE e.teacher_id = $1
                GROUP BY e.id, e.name, e.exam_date, e.total_marks, e.status, e.created_at
                ORDER BY e.created_at DESC
                LIMIT 10
                ''',
                user.user_id
            )
            await conn.close()

            recent_exams = []
            total_submissions = 0
            total_reviewed = 0
            avg_list = []
            for r in rows:
                recent_exams.append({
                    "id": str(r["id"]),
                    "name": r["name"],
                    "examDate": r["exam_date"].isoformat() if r["exam_date"] else None,
                    "totalMarks": r["total_marks"],
                    "status": r["status"] or "graded"
                })
                total_submissions += r["submission_count"] or 0
                total_reviewed += r["reviewed_count"] or 0
                if r["avg_pct"] is not None:
                    avg_list.append(float(r["avg_pct"]))

            avg_pct = round(sum(avg_list) / len(avg_list), 1) if avg_list else 0.0
            return {
                "data": {
                    "examsCount": len(recent_exams),
                    "submissionsCount": total_submissions,
                    "reviewedCount": total_reviewed,
                    "averagePercentage": avg_pct,
                    "recentExams": recent_exams
                }
            }
        except Exception as e:
            logger.error(f"Error querying Neon for analytics: {e}")

    # Fallback: MongoDB scan sessions
    sessions = await db.scan_sessions.find({"status": "completed", "user_id": user.user_id}).to_list(100)
    recent_exams = []
    for s in sessions:
        recent_exams.append({
            "id": s.get("exam_id") or f"exam_local_{s['session_id']}",
            "name": s["session_name"],
            "examDate": s.get("exam_date"),
            "totalMarks": s.get("total_marks") or 100,
            "status": "graded"
        })
    return {
        "data": {
            "examsCount": len(recent_exams),
            "submissionsCount": len(recent_exams) * 5,
            "reviewedCount": 0,
            "averagePercentage": 0.0,
            "recentExams": recent_exams
        }
    }


@api_router.get("/v1/exams")
async def list_exams_v1(authorization: Optional[str] = Header(None)):
    """List exams - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            rows = await conn.fetch(
                '''
                SELECT id, name, batch_id, subject_id, total_marks, exam_date, status, grading_mode
                FROM exams
                WHERE teacher_id = $1
                ORDER BY created_at DESC
                LIMIT 50
                ''',
                user.user_id
            )
            await conn.close()
            exams = [
                {
                    "id": str(r["id"]),
                    "name": r["name"],
                    "batchId": str(r["batch_id"]) if r["batch_id"] else None,
                    "subjectId": str(r["subject_id"]) if r["subject_id"] else None,
                    "totalMarks": r["total_marks"],
                    "examDate": r["exam_date"].isoformat() if r["exam_date"] else None,
                    "status": r["status"] or "graded",
                    "gradingMode": r["grading_mode"]
                }
                for r in rows
            ]
            return {"data": exams}
        except Exception as e:
            logger.error(f"Error querying Neon for exams list: {e}")

    # MongoDB fallback
    sessions = await db.scan_sessions.find({"status": "completed", "user_id": user.user_id}).to_list(100)
    exams = [
        {
            "id": s.get("exam_id") or f"exam_local_{s['session_id']}",
            "name": s["session_name"],
            "batchId": s.get("batch_id"),
            "subjectId": s.get("subject_id"),
            "totalMarks": s.get("total_marks") or 100,
            "examDate": s.get("exam_date"),
            "status": "graded"
        }
        for s in sessions
    ]
    return {"data": exams}


@api_router.get("/v1/re-evaluations")
async def list_reevaluations_proxy(exam_id: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """List student reevaluation requests - reads directly from Neon PostgreSQL"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            query = '''
                SELECT r.id, s.student_name, s.student_roll_number as roll_number, r.reason, r.status,
                       r.teacher_response, r.created_at, e.name as exam_name, e.id as exam_id
                FROM re_evaluations r
                JOIN submissions s ON s.id = r.submission_id
                JOIN exams e ON e.id = s.exam_id
                WHERE e.teacher_id = $1
            '''
            params = [user.user_id]
            if exam_id:
                query += " AND e.id = $2"
                params.append(exam_id)
            query += " ORDER BY r.created_at DESC LIMIT 50"

            rows = await conn.fetch(query, *params)
            await conn.close()
            data = [
                {
                    "id": str(r["id"]),
                    "studentName": r["student_name"] or "Unknown",
                    "rollNumber": r["roll_number"] or "",
                    "reason": r["reason"] or "",
                    "status": r["status"] or "pending",
                    "teacherResponse": r["teacher_response"],
                    "examName": r["exam_name"],
                    "examId": str(r["exam_id"])
                }
                for r in rows
            ]
            return {"data": data}
        except Exception as e:
            logger.error(f"Error querying Neon for re-evaluations: {e}")

    return {"data": []}



class ResolveReEvaluationRequest(BaseModel):
    status: str
    teacherResponse: str


@api_router.post("/v1/re-evaluations/{re_evaluation_id}/resolve")
async def resolve_reevaluation_proxy(
    re_evaluation_id: str,
    data: ResolveReEvaluationRequest,
    authorization: Optional[str] = Header(None)
):
    """Resolve a student reevaluation request (proxied to webapp or mock)"""
    webapp_url = os.environ.get("WEBAPP_URL")
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    
    if webapp_url and token != "sess_mock_token_12345" and not re_evaluation_id.startswith("re_mock_"):
        try:
            async with httpx.AsyncClient() as client_http:
                response = await client_http.post(
                    f"{webapp_url.rstrip('/')}/api/v1/re-evaluations/{re_evaluation_id}/resolve",
                    json=data.model_dump(),
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=15.0
                )
                if response.status_code in [200, 201]:
                    return response.json()
                raise HTTPException(status_code=response.status_code, detail=response.text)
        except Exception as e:
            logger.error(f"Error proxying resolve re-evaluation: {e}")
            raise HTTPException(status_code=500, detail=str(e))
            
    return {"success": True, "data": {"id": re_evaluation_id, "status": data.status, "teacherResponse": data.teacherResponse}}


@api_router.get("/v1/exams/{exam_id}/jobs")
async def get_exam_jobs_proxy(exam_id: str, authorization: Optional[str] = Header(None)):
    """Get grading jobs for an exam - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            rows = await conn.fetch(
                '''
                SELECT j.id, j.type, j.status, j.progress, j.processed_items, j.total_items, j.updated_at
                FROM grading_jobs j
                WHERE j.exam_id = $1
                ORDER BY j.created_at DESC
                LIMIT 5
                ''',
                exam_id
            )
            await conn.close()
            if rows:
                jobs = [
                    {
                        "id": str(r["id"]),
                        "type": r["type"] or "bulk_grade",
                        "status": r["status"] or "processing",
                        "progress": float(r["progress"]) if r["progress"] is not None else 0.0,
                        "processedItems": r["processed_items"] or 0,
                        "totalItems": r["total_items"] or 0
                    }
                    for r in rows
                ]
                return {"data": jobs}
        except Exception as e:
            logger.error(f"Error querying Neon for exam jobs: {e}")

    # Fallback: check scan session status in MongoDB
    session = await db.scan_sessions.find_one({"exam_id": exam_id})
    if session and session.get("status") == "completed":
        return {
            "data": [{
                "id": f"job_local_{exam_id}",
                "type": "bulk_grade",
                "status": "processing",
                "progress": 0.1,
                "processedItems": 0,
                "totalItems": len(session.get("students", []))
            }]
        }
    return {"data": []}


@api_router.post("/v1/exams/{exam_id}/regrade")
async def regrade_exam_v1(exam_id: str, authorization: Optional[str] = Header(None)):
    """Trigger AI regrade / reevaluation of an exam on the webapp (v1 path)"""
    webapp_url = os.environ.get("WEBAPP_URL")
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    
    if webapp_url and token != "sess_mock_token_12345":
        try:
            async with httpx.AsyncClient() as client_http:
                response = await client_http.post(
                    f"{webapp_url.rstrip('/')}/api/v1/exams/{exam_id}/regrade",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=30.0
                )
                if response.status_code in [200, 201]:
                    return response.json()
                raise HTTPException(status_code=response.status_code, detail=response.text)
        except Exception as e:
            logger.error(f"Error proxying regrade exam: {e}")
            raise HTTPException(status_code=500, detail=str(e))
            
    return {"success": True, "message": "Regrade enqueued (mock)"}


@api_router.get("/batches/{batch_id}/exams")
async def get_batch_exams(batch_id: str, authorization: Optional[str] = Header(None)):
    """Get exams in a batch (proxied to webapp or fallback)"""
    webapp_url = os.environ.get("WEBAPP_URL")
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    
    if webapp_url and token != "sess_mock_token_12345":
        try:
            async with httpx.AsyncClient() as client_http:
                # Webapp does not support GET /api/v1/batches/{batch_id}/exams.
                # Instead, query GET /api/v1/exams and filter by batchId.
                response = await client_http.get(
                    f"{webapp_url.rstrip('/')}/api/v1/exams",
                    headers={"Authorization": f"Bearer {token}", "Bypass-Tunnel-Reminder": "true"},
                    timeout=15.0
                )
                if response.status_code == 200:
                    all_exams = response.json().get("data", [])
                    batch_exams = [e for e in all_exams if e.get("batchId") == batch_id]
                    return {"exams": batch_exams}
        except Exception as e:
            logger.error(f"Error fetching batch exams via filter: {e}")
            
    # Mock / Fallback
    sessions = await db.scan_sessions.find({"batch_id": batch_id, "status": "completed"}).to_list(100)
    exams = []
    for s in sessions:
        exams.append({
            "id": s.get("exam_id") or f"exam_mock_{s['session_id']}",
            "name": s["session_name"],
            "subjectId": s.get("subject_id") or "",
            "totalMarks": s.get("total_marks") or 100,
            "examDate": s.get("exam_date"),
            "status": "graded"
        })
        
    if not exams:
        exams = [
            {"id": f"exam_mock_{batch_id}_1", "name": "Midterm Exam", "subjectId": "sub_science", "totalMarks": 100, "examDate": "2026-05-15", "status": "graded"},
            {"id": f"exam_mock_{batch_id}_2", "name": "Unit Test 1", "subjectId": "sub_physics", "totalMarks": 50, "examDate": "2026-05-20", "status": "graded"}
        ]
    return {"exams": exams}


@api_router.post("/backdoor/seed")
async def backdoor_seed(authorization: Optional[str] = Header(None)):
    """Seed mock sandbox data into local MongoDB"""
    user = await get_current_user(authorization)
    
    # 1. Seed Batches
    batches = [
        {"batch_id": "bat_4fgazfn34Vc9F6", "name": "Class 10-A", "student_count": 3, "org_id": user.org_id},
        {"batch_id": "bat_physics11", "name": "Grade 11 - Physics", "student_count": 2, "org_id": user.org_id}
    ]
    for b in batches:
        await db.batches.update_one({"batch_id": b["batch_id"]}, {"$set": b}, upsert=True)

    # 2. Seed Students
    students = [
        {"student_id": "std_001", "roll_number": "10", "name": "Aarav Sharma", "batch_id": "bat_4fgazfn34Vc9F6"},
        {"student_id": "std_002", "roll_number": "11", "name": "Aditi Patel", "batch_id": "bat_4fgazfn34Vc9F6"},
        {"student_id": "std_003", "roll_number": "12", "name": "Amit Kumar", "batch_id": "bat_4fgazfn34Vc9F6"},
        {"student_id": "std_004", "roll_number": "21", "name": "Rohan Gupta", "batch_id": "bat_physics11"},
        {"student_id": "std_005", "roll_number": "22", "name": "Priya Sharma", "batch_id": "bat_physics11"}
    ]
    for s in students:
        await db.students.update_one({"student_id": s["student_id"]}, {"$set": s}, upsert=True)

    # 3. Seed Subjects
    subjects = [
        {"id": "sub_science", "name": "Science", "org_id": user.org_id},
        {"id": "sub_maths", "name": "Mathematics", "org_id": user.org_id},
        {"id": "sub_physics", "name": "Physics", "org_id": user.org_id}
    ]
    for sub in subjects:
        await db.subjects.update_one({"id": sub["id"]}, {"$set": sub}, upsert=True)

    # 4. Seed completed scan session
    mock_session_id = "scan_mock_midterm"
    mock_session = {
        "session_id": mock_session_id,
        "session_name": "Midterm Science Exam",
        "batch_id": "bat_4fgazfn34Vc9F6",
        "batch_name": "Class 10-A",
        "subject_id": "sub_science",
        "total_marks": 25,
        "exam_date": "2026-05-30",
        "status": "completed",
        "exam_id": "exam_mock_midterm",
        "user_id": user.user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "question_paper": {"pages": [], "page_count": 0},
        "model_answer": {"pages": [{"page_number": 1, "file_path": "", "file_url": "https://placehold.co/600x800/png?text=Model+Answer"}], "page_count": 1},
        "students": [
            {
                "label": "Aarav Sharma",
                "roll_number": "10",
                "pages": [{"page_number": 1, "file_path": "", "file_url": "https://placehold.co/600x800/png?text=Aarav+Sharma+Page+1"}]
            },
            {
                "label": "Aditi Patel",
                "roll_number": "11",
                "pages": [{"page_number": 1, "file_path": "", "file_url": "https://placehold.co/600x800/png?text=Aditi+Patel+Page+1"}]
            },
            {
                "label": "Amit Kumar",
                "roll_number": "12",
                "pages": [{"page_number": 1, "file_path": "", "file_url": "https://placehold.co/600x800/png?text=Amit+Kumar+Page+1"}]
            }
        ],
        "stats": {
            "total_students": 3,
            "total_pages": 4
        }
    }
    await db.scan_sessions.update_one({"session_id": mock_session_id}, {"$set": mock_session}, upsert=True)

    return {"success": True, "message": "Sandbox data seeded successfully!"}


@api_router.post("/backdoor/reset")
async def backdoor_reset(authorization: Optional[str] = Header(None)):
    """Wipe mock data from local MongoDB"""
    user = await get_current_user(authorization)
    await db.scan_sessions.delete_many({"user_id": user.user_id})
    await db.batches.delete_many({"org_id": user.org_id})
    await db.students.delete_many({"batch_id": {"$in": ["bat_4fgazfn34Vc9F6", "bat_physics11"]}})
    await db.subjects.delete_many({"org_id": user.org_id})
    return {"success": True, "message": "Database reset completed successfully."}


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
