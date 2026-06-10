from fastapi import FastAPI, APIRouter, HTTPException, Header, BackgroundTasks, Request
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
import json
from io import BytesIO
from fastapi import File, UploadFile, Form
from fastapi.responses import FileResponse, RedirectResponse, Response, JSONResponse
import shutil
from storage_service import StorageService, get_storage_service
from sync_preflight_service import SyncPreflightError, assert_webapp_sync_ready
from review_settings_service import (
    build_grading_flag_payload,
    difficulty_from_state_json,
    merge_difficulty_into_state_json,
    normalize_review_settings,
    utc_now_text,
)
from improve_ai_service import ImproveAIServiceError, save_question_improvement
from review_save_service import ReviewSaveServiceError, save_submission_review_edits
from student_roster_service import StudentRosterServiceError, update_batch_student_profile
from grading_lifecycle_service import (
    build_grading_jobs,
    build_grading_submission_queue,
    deleted_or_missing_webapp_exam_ids,
    derive_scan_session_reconciliation,
    find_pilot_review_continuation,
    is_successful_blueprint_job,
    pilot_review_first_enabled,
    student_answer_text_select_expression,
    validate_scan_session_ready_for_sync,
)
from grading_retry_service import (
    exam_has_blueprint,
    fetch_exam_submission_ids,
    insert_blueprint_extraction_job,
    insert_grade_submissions_job,
    resolve_source_paper_mode,
    retry_grading_after_blueprint,
    update_scan_grading_state,
)
from manage_analytics_service import (
    build_managed_exams,
    build_question_stats,
    build_student_ranking,
    build_subject_performance,
    build_weak_student_ranking,
    normalize_exam_update_payload,
)
from batch_sync_service import fetch_active_batches, fetch_batch_exams, fetch_batch_roster, split_students_by_strength
from gcs_file_response_service import (
    InvalidGCSKeyError,
    InvalidRangeHeaderError,
    build_file_headers,
    infer_content_type,
    parse_range_header,
    sanitize_gcs_key,
)
from review_file_url_service import build_gcs_proxy_url
from review_identity_service import normalize_review_student_identity
from runtime_readiness_service import build_readiness_report
from upload_flow_service import merge_upload_flow_state
from sync_cleanup_service import delete_stale_upload_flows_for_teacher, delete_upload_flows_for_exams
from webapp_proxy_service import WebappProxyConfigError, build_proxy_headers, build_webapp_url
from google_invite_auth_service import (
    AccessRequest,
    GoogleInviteAuthError,
    GoogleProfile,
    resolve_or_claim_teacher_invite,
    upsert_access_request,
)
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


def public_request_base_url(request: Request) -> str:
    configured_url = (
        os.environ.get("BACKEND_PUBLIC_URL")
        or os.environ.get("PUBLIC_BACKEND_URL")
        or os.environ.get("APP_BASE_URL")
        or ""
    ).strip()
    if configured_url and "localhost" not in configured_url and "127.0.0.1" not in configured_url:
        return configured_url
    return str(request.base_url)


def sanitize_uploaded_filename(name: Optional[str], fallback: str) -> str:
    source = name or fallback
    safe = "".join(c for c in source if c.isalnum() or c in (" ", "_", "-", ".")).strip()
    return safe.replace(" ", "_") or fallback


def infer_upload_content_type(upload_file: UploadFile) -> str:
    content_type = (upload_file.content_type or "").lower()
    filename = (upload_file.filename or "").lower()
    if content_type == "application/pdf" or filename.endswith(".pdf"):
        return "application/pdf"
    return "image/jpeg"


def content_type_extension(content_type: str) -> str:
    return ".pdf" if content_type == "application/pdf" else ".jpg"

def generate_drizzle_id(prefix: str) -> str:
    import string
    import random
    chars = string.ascii_letters + string.digits
    return prefix + ''.join(random.choices(chars, k=14))


def build_upload_flow_state(session: dict, source_paper_mode: str) -> dict:
    settings = session.get("settings") if isinstance(session.get("settings"), dict) else {}
    return {
        "form": {
            "name": session["session_name"],
            "batchId": session["batch_id"],
            "subjectId": session.get("subject_id") or "",
            "totalMarks": str(session.get("total_marks") or 100),
            "examDate": session.get("exam_date") or "",
            "gradingMode": settings.get("grading_mode") or settings.get("gradingMode") or "balanced",
            "gradingInstructions": settings.get("grading_instructions") or settings.get("gradingInstructions") or "",
            "feedbackEnabled": settings.get("feedback_enabled", settings.get("feedbackEnabled", True)),
        },
        "sourcePaperMode": source_paper_mode,
        "pilotReviewFirst": bool(settings.get("pilot_review_first", settings.get("pilotReviewFirst", False))),
        "activeJobId": None,
        "sessionSubmissionIds": [],
    }

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
    source_type: Optional[str] = None
    content_type: Optional[str] = None
    original_name: Optional[str] = None

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
    batch_name: Optional[str] = None
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


class SubjectCreateRequest(BaseModel):
    name: str
    classStandard: Optional[str] = None


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


async def proxy_webapp_json(
    webapp_path: str,
    authorization: Optional[str],
    method: str = "GET",
    request: Optional[Request] = None,
    json_body: Optional[dict] = None,
) -> dict:
    """Forward a validated mobile request to the role-aware webapp API."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    await get_current_user(authorization)

    try:
        url = build_webapp_url(os.environ.get("WEBAPP_URL"), webapp_path)
    except WebappProxyConfigError as exc:
        logger.error(f"Webapp proxy is not configured: {exc}")
        raise HTTPException(status_code=500, detail="Webapp proxy is not configured") from exc
    except ValueError as exc:
        logger.error(f"Unsafe webapp proxy path rejected: {webapp_path}")
        raise HTTPException(status_code=500, detail="Invalid webapp proxy path") from exc

    params = dict(request.query_params) if request else None
    headers = build_proxy_headers(authorization)

    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=30.0,
            )
    except httpx.RequestError as exc:
        logger.error(f"Webapp proxy request failed for {method} {webapp_path}: {exc}")
        raise HTTPException(status_code=502, detail="Webapp service unavailable") from exc

    if response.status_code >= 400:
        detail = response.text or f"Webapp returned status {response.status_code}"
        try:
            body = response.json()
            detail = body.get("message") or body.get("error", {}).get("message") or detail
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)

    if not response.content:
        return {"success": True}

    try:
        return response.json()
    except ValueError:
        return {"data": response.text}


PORTAL_PROXY_ROUTES = (
    ("GET", "/api/v1/student/dashboard"),
    ("GET", "/api/v1/student/exams"),
    ("GET", "/api/v1/student/submissions"),
    ("GET", "/api/v1/student/submissions/{submission_id}"),
    ("GET", "/api/v1/student/exams/{exam_id}/files"),
    ("GET", "/api/v1/student/re-evaluations"),
    ("POST", "/api/v1/student/re-evaluations"),
    ("GET", "/api/v1/admin/teachers"),
    ("PATCH", "/api/v1/admin/teachers/{user_id}"),
    ("GET", "/api/v1/admin/teacher-invites"),
    ("POST", "/api/v1/admin/teacher-invites"),
    ("DELETE", "/api/v1/admin/teacher-invites/{invite_id}"),
    ("GET", "/api/v1/admin/feedback"),
    ("PATCH", "/api/v1/admin/feedback/{feedback_id}/resolve"),
    ("GET", "/api/v1/admin/audit-logs"),
)


def get_missing_portal_proxy_routes() -> list[str]:
    """Return required mobile portal proxy routes not registered on the API router."""
    registered = {
        (method, route.path)
        for route in api_router.routes
        for method in getattr(route, "methods", set())
    }
    return [
        f"{path} [{method}]"
        for method, path in PORTAL_PROXY_ROUTES
        if (method, path) not in registered
    ]


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


def _string_from_context(context: dict, *keys: str) -> str:
    for key in keys:
        value = context.get(key)
        if value is not None:
            return str(value).strip()
    return ""


async def _notify_access_request(access_request: dict) -> None:
    webhook_url = (os.environ.get("ACCESS_REQUEST_WEBHOOK_URL") or "").strip()
    if not webhook_url:
        return
    try:
        async with httpx.AsyncClient() as client_http:
            await client_http.post(webhook_url, json=access_request, timeout=10.0)
    except Exception as e:
        logger.warning(f"Failed to notify access request webhook: {e}")


async def _record_google_access_request(
    *,
    conn,
    email: str,
    name: str,
    picture_url: str,
    google_subject: str,
    client_context: dict,
) -> dict:
    app_version = _string_from_context(client_context, "appVersion", "app_version")
    build_version = _string_from_context(client_context, "buildVersion", "build_version")
    source = _string_from_context(client_context, "source") or "mobile"

    try:
        stored = await upsert_access_request(
            conn,
            AccessRequest(
                email=email,
                name=name,
                picture_url=picture_url,
                subject=google_subject,
                source=source,
                app_version=app_version,
                build_version=build_version,
                device_info=client_context,
            ),
            id_factory=lambda: generate_drizzle_id("arq_"),
        )
    except Exception as e:
        logger.warning(f"Could not store access request in webapp DB, falling back to MongoDB: {e}")
        now_text = datetime.now(timezone.utc).isoformat()
        stored = {
            "id": f"arq_{uuid.uuid4().hex[:12]}",
            "email": email,
            "created": True,
            "attempt_count": 1,
        }
        existing = await db.access_requests.find_one(
            {
                "$or": [
                    {"email": email},
                    {"google_subject": google_subject} if google_subject else {"_id": "__never__"},
                ]
            },
            {"_id": 0, "attempt_count": 1, "request_id": 1},
        )
        if existing:
            stored["id"] = existing.get("request_id") or stored["id"]
            stored["created"] = False
            stored["attempt_count"] = int(existing.get("attempt_count") or 0) + 1
            await db.access_requests.update_one(
                {"request_id": stored["id"]},
                {
                    "$set": {
                        "email": email,
                        "name": name,
                        "picture_url": picture_url,
                        "google_subject": google_subject,
                        "source": source,
                        "app_version": app_version,
                        "build_version": build_version,
                        "device_info": client_context,
                        "last_attempted_at": now_text,
                        "updated_at": now_text,
                    },
                    "$inc": {"attempt_count": 1},
                },
            )
        else:
            await db.access_requests.insert_one(
                {
                    "request_id": stored["id"],
                    "email": email,
                    "name": name,
                    "picture_url": picture_url,
                    "google_subject": google_subject,
                    "source": source,
                    "app_version": app_version,
                    "build_version": build_version,
                    "device_info": client_context,
                    "status": "new",
                    "attempt_count": 1,
                    "last_attempted_at": now_text,
                    "created_at": now_text,
                    "updated_at": now_text,
                }
            )

    payload = {
        "id": stored.get("id"),
        "email": email,
        "name": name,
        "googleSubject": google_subject,
        "pictureUrl": picture_url,
        "source": source,
        "appVersion": app_version,
        "buildVersion": build_version,
        "created": bool(stored.get("created")),
        "attemptCount": stored.get("attempt_count"),
    }
    await _notify_access_request(payload)
    return stored


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
    client_context = data.get("client_context") if isinstance(data.get("client_context"), dict) else {}

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


    # 4. Resolve an existing active user, or claim a pending teacher invite.
    # This makes admin invites work for mobile-first sign-ins too; users no
    # longer need to open the webapp once before the native app can authenticate.
    webapp_user = None
    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            webapp_user = await resolve_or_claim_teacher_invite(
                conn,
                GoogleProfile(
                    email=google_email,
                    name=google_name,
                    picture_url=google_picture,
                    subject=google_sub,
                ),
                id_factory=lambda: generate_drizzle_id("usr_"),
            )
        except GoogleInviteAuthError as e:
            logger.warning(f"Google auth rejected for {google_email}: {e.detail}")
            if e.code == "INVITE_REQUIRED":
                stored = await _record_google_access_request(
                    conn=conn,
                    email=google_email,
                    name=google_name,
                    picture_url=google_picture,
                    google_subject=google_sub,
                    client_context=client_context,
                )
                return JSONResponse(
                    status_code=403,
                    content={
                        "code": "INVITE_REQUIRED",
                        "message": "GradeSense is invite-only right now.",
                        "accessRequestCreated": True,
                        "accessRequestId": stored.get("id"),
                        "email": google_email,
                    },
                )
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error querying webapp DB: {e}")
            webapp_user = None
        finally:
            if conn:
                await conn.close()

    # 5. If we couldn't get the user ID from DB, try via webapp API
    if not webapp_user:
        raise HTTPException(
            status_code=503,
            detail="User database unavailable. Please try again or use email/password login."
        )

    webapp_user_id = webapp_user["id"]
    user_role = webapp_user.get("role") or "teacher"

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
        "name": webapp_user.get("name") or google_name,
        "picture": webapp_user.get("picture_url") or google_picture,
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
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization

    if token != "sess_mock_token_12345":
        webapp_db_url = os.environ.get("WEBAPP_DB_URL")
        if webapp_db_url:
            conn = None
            try:
                conn = await asyncpg.connect(webapp_db_url)
                batches = await fetch_active_batches(conn, user.user_id)
                active_ids = [batch["batch_id"] for batch in batches]
                await db.batches.delete_many({
                    "$or": [{"org_id": user.org_id}, {"user_id": user.user_id}],
                    "batch_id": {"$nin": active_ids},
                })
                for batch in batches:
                    await db.batches.update_one(
                        {"batch_id": batch["batch_id"]},
                        {"$set": {**batch, "org_id": user.org_id, "user_id": user.user_id}},
                        upsert=True,
                    )
                return {"batches": batches}
            except Exception as e:
                logger.error(f"Error querying Neon for batches: {e}")
                raise HTTPException(status_code=503, detail="Batch sync is unavailable. Please retry.")
            finally:
                if conn:
                    await conn.close()
    
    # 1. Fetch batches from webapp
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        batches = await db.batches.find({"org_id": user.org_id}, {"_id": 0}).to_list(100)
        return {"batches": batches}
    
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
    """Create a new batch on the webapp and cache it for mobile setup."""
    user = await get_current_user(authorization)
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    batch_name = str(data.get("name") or "").strip()
    if not batch_name:
        raise HTTPException(status_code=400, detail="Batch name is required")

    class_standard = data.get("classStandard", data.get("class_standard"))
    section = data.get("section")
    academic_year = data.get("academicYear", data.get("academic_year"))
    now = utc_now_text()

    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url and token != "sess_mock_token_12345":
        batch_id = generate_drizzle_id("bat_")
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                '''
                INSERT INTO batches (
                    id, teacher_id, name, class_standard, section,
                    academic_year, status, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7)
                RETURNING id, name, class_standard, section, academic_year, status
                ''',
                batch_id,
                user.user_id,
                batch_name,
                class_standard,
                section,
                academic_year,
                now,
            )
            new_batch = {
                "batch_id": str(row["id"]),
                "id": str(row["id"]),
                "name": row["name"],
                "student_count": 0,
                "class_standard": row["class_standard"],
                "classStandard": row["class_standard"],
                "section": row["section"],
                "academic_year": row["academic_year"],
                "academicYear": row["academic_year"],
                "status": row["status"],
                "org_id": user.org_id,
                "user_id": user.user_id,
            }
            await db.batches.update_one(
                {"batch_id": new_batch["batch_id"]},
                {"$set": new_batch},
                upsert=True,
            )
            return {"success": True, "batch": new_batch}
        except Exception as e:
            logger.error(f"Error creating batch in Neon: {e}")
            raise HTTPException(status_code=500, detail="Failed to create batch")
        finally:
            if conn:
                await conn.close()

    webapp_url = os.environ.get("WEBAPP_URL")
    
    if not webapp_url:
        import time
        new_batch = {
            "batch_id": f"batch_{int(time.time())}",
            "name": batch_name,
            "student_count": 0,
            "org_id": user.org_id,
            "user_id": user.user_id,
        }
        await db.batches.insert_one(new_batch)
        return {"success": True, "batch": new_batch}
        
    try:
        async with httpx.AsyncClient() as client_http:
            response = await client_http.post(
                f"{webapp_url.rstrip('/')}/api/v1/batches",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": batch_name,
                    "classStandard": class_standard,
                    "section": section,
                    "academicYear": academic_year,
                },
                timeout=15.0
            )
            if response.status_code in [200, 201]:
                body = response.json()
                created = body.get("data") or body.get("batch") or body
                batch_id = created.get("id") or created.get("batch_id")
                if not batch_id:
                    raise HTTPException(status_code=500, detail="Batch creation response missing id")
                new_batch = {
                    "batch_id": batch_id,
                    "id": batch_id,
                    "name": created.get("name") or batch_name,
                    "student_count": int(created.get("studentCount") or created.get("student_count") or 0),
                    "org_id": user.org_id,
                    "user_id": user.user_id,
                }
                await db.batches.update_one(
                    {"batch_id": new_batch["batch_id"]},
                    {"$set": new_batch},
                    upsert=True,
                )
                return {"success": True, "batch": new_batch}
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.delete("/batches/{batch_id}")
async def delete_batch(batch_id: str, authorization: Optional[str] = Header(None)):
    """Delete a batch on the webapp"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                '''
                UPDATE batches
                SET status = 'deleted', updated_at = $3
                WHERE id = $1
                  AND teacher_id = $2
                  AND COALESCE(status, '') <> 'deleted'
                RETURNING id
                ''',
                batch_id,
                user.user_id,
                utc_now_text(),
            )
            if not row:
                raise HTTPException(status_code=404, detail="Batch not found")
            await db.batches.delete_many({"batch_id": batch_id})
            await db.students.delete_many({"batch_id": batch_id})
            return {"success": True, "id": batch_id}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting batch in Neon: {e}")
            raise HTTPException(status_code=500, detail="Failed to delete batch")
        finally:
            if conn:
                await conn.close()

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
                await db.batches.delete_many({"batch_id": batch_id})
                await db.students.delete_many({"batch_id": batch_id})
                return {"success": True}
            raise HTTPException(status_code=response.status_code, detail=response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.patch("/batches/{batch_id}")
async def update_batch(batch_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Update batch settings from mobile and keep the webapp/local cache in sync."""
    user = await get_current_user(authorization)
    clean_name = (data.get("name") or "").strip() if isinstance(data.get("name"), str) else None
    if not clean_name:
        raise HTTPException(status_code=400, detail="Batch name is required")

    now = utc_now_text()
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                '''
                UPDATE batches
                SET name = $3, updated_at = $4
                WHERE id = $1 AND teacher_id = $2
                RETURNING id, name, status
                ''',
                batch_id,
                user.user_id,
                clean_name,
                now,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Batch not found")

            batch = {
                "batch_id": row["id"],
                "id": row["id"],
                "name": row["name"],
                "status": row["status"] or "active",
                "org_id": user.org_id,
                "user_id": user.user_id,
            }
            await db.batches.update_one(
                {"batch_id": batch_id},
                {"$set": batch},
                upsert=True,
            )
            return {"success": True, "batch": batch}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating batch in Neon: {e}")
            raise HTTPException(status_code=500, detail="Failed to update batch")
        finally:
            if conn:
                await conn.close()

    webapp_url = os.environ.get("WEBAPP_URL")
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    if webapp_url:
        try:
            async with httpx.AsyncClient() as client_http:
                response = await client_http.patch(
                    f"{webapp_url.rstrip('/')}/api/v1/batches/{batch_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"name": clean_name},
                    timeout=15.0,
                )
                if response.status_code in [200, 204]:
                    payload = response.json() if response.content else {}
                    raw_batch = payload.get("data") or payload.get("batch") or payload or {}
                    batch = {
                        "batch_id": raw_batch.get("id") or raw_batch.get("batch_id") or batch_id,
                        "id": raw_batch.get("id") or raw_batch.get("batch_id") or batch_id,
                        "name": raw_batch.get("name") or clean_name,
                        "status": raw_batch.get("status") or "active",
                        "org_id": user.org_id,
                        "user_id": user.user_id,
                    }
                    await db.batches.update_one({"batch_id": batch_id}, {"$set": batch}, upsert=True)
                    return {"success": True, "batch": batch}
                raise HTTPException(status_code=response.status_code, detail=response.text)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    await db.batches.update_one(
        {"batch_id": batch_id},
        {"$set": {"name": clean_name, "updated_at": now}},
        upsert=False,
    )
    batch = await db.batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"success": True, "batch": batch}


@api_router.post("/batches/{batch_id}/archive")
async def archive_batch(batch_id: str, authorization: Optional[str] = Header(None)):
    """Archive a webapp batch while preserving its historical exam/student records."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    now = utc_now_text()

    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                '''
                UPDATE batches
                SET status = 'archived', updated_at = $3
                WHERE id = $1 AND teacher_id = $2
                RETURNING id
                ''',
                batch_id,
                user.user_id,
                now
            )
            if not row:
                raise HTTPException(status_code=404, detail="Batch not found")
            await db.batches.update_one(
                {"batch_id": batch_id},
                {"$set": {"status": "archived", "org_id": user.org_id, "user_id": user.user_id}},
            )
            return {"success": True, "id": batch_id}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error archiving batch in Neon: {e}")
            raise HTTPException(status_code=500, detail="Failed to archive batch")
        finally:
            if conn:
                await conn.close()

    await db.batches.update_one({"batch_id": batch_id}, {"$set": {"status": "archived"}})
    return {"success": True, "id": batch_id}


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


@api_router.patch("/batches/{batch_id}/students/{student_id}")
async def update_student(batch_id: str, student_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Update student profile fields that teachers manage from the mobile roster."""
    user = await get_current_user(authorization)

    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            student = await update_batch_student_profile(
                conn,
                teacher_id=user.user_id,
                batch_id=batch_id,
                student_id=student_id,
                data=data,
            )
            await db.students.update_one(
                {"batch_id": batch_id, "student_id": student_id},
                {"$set": student},
                upsert=True,
            )
            return {"success": True, "student": student}
        except StudentRosterServiceError as e:
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except Exception as e:
            logger.error(f"Error updating student profile in Neon: {e}")
            raise HTTPException(status_code=503, detail="Student profile sync is unavailable. Please retry.")
        finally:
            if conn:
                await conn.close()

    update_doc = {
        "name": data.get("name"),
        "roll_number": data.get("rollNumber") or data.get("roll_number") or data.get("studentId"),
        "rollNumber": data.get("rollNumber") or data.get("roll_number") or data.get("studentId"),
        "email": data.get("email") or "",
        "mobile_number": data.get("mobileNumber") or data.get("mobile_number") or data.get("phone") or "",
        "mobileNumber": data.get("mobileNumber") or data.get("mobile_number") or data.get("phone") or "",
    }
    update_doc = {key: value for key, value in update_doc.items() if value is not None}
    result = await db.students.update_one(
        {"batch_id": batch_id, "student_id": student_id},
        {"$set": update_doc},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Student not found")
    student = await db.students.find_one({"batch_id": batch_id, "student_id": student_id}, {"_id": 0})
    return {"success": True, "student": student}


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
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization

    if token != "sess_mock_token_12345":
        webapp_db_url = os.environ.get("WEBAPP_DB_URL")
        if webapp_db_url:
            conn = None
            try:
                conn = await asyncpg.connect(webapp_db_url)
                students = await fetch_batch_roster(conn, user.user_id, batch_id)
                student_ids = [student["student_id"] for student in students]
                await db.students.delete_many({
                    "batch_id": batch_id,
                    "student_id": {"$nin": student_ids},
                })
                for student in students:
                    await db.students.update_one(
                        {"batch_id": batch_id, "student_id": student["student_id"]},
                        {"$set": student},
                        upsert=True,
                    )
                await db.batches.update_one(
                    {"batch_id": batch_id},
                    {"$set": {"student_count": len(students), "studentCount": len(students)}},
                )
                strong_students, weak_students = split_students_by_strength(students)
                return {
                    "students": students,
                    "strongStudents": strong_students,
                    "weakStudents": weak_students,
                }
            except Exception as e:
                logger.error(f"Error querying Neon for batch roster: {e}")
                raise HTTPException(status_code=503, detail="Roster sync is unavailable. Please retry.")
            finally:
                if conn:
                    await conn.close()
    
    # 1. Fetch students from webapp
    webapp_url = os.environ.get("WEBAPP_URL")
    if not webapp_url:
        students = await db.students.find({"batch_id": batch_id}, {"_id": 0}).to_list(1000)
        return {"students": students}
        
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
                raw_data = res_data.get("data", [])
                if isinstance(raw_data, dict):
                    webapp_students = raw_data.get("students") or raw_data.get("rows") or raw_data.get("items") or []
                else:
                    webapp_students = raw_data
                
                mapped_students = []
                for s in webapp_students:
                    if not isinstance(s, dict):
                        continue
                    mapped_students.append({
                        "student_id": s.get("id") or s.get("student_id") or s.get("studentId"),
                        "roll_number": s.get("rollNumber") or "",
                        "rollNumber": s.get("rollNumber") or "",
                        "name": s.get("name") or "Unnamed Student",
                        "email": s.get("email") or "",
                        "mobile_number": s.get("mobileNumber") or s.get("mobile_number") or "",
                        "mobileNumber": s.get("mobileNumber") or s.get("mobile_number") or "",
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


@api_router.post("/subjects")
async def create_subject(data: SubjectCreateRequest, authorization: Optional[str] = Header(None)):
    """Create a subject for the current teacher and sync it with the webapp database."""
    user = await get_current_user(authorization)
    subject_name = data.name.strip()
    if not subject_name:
        raise HTTPException(status_code=400, detail="Subject name is required")

    now = utc_now_text()
    subject_id = generate_drizzle_id("sub_")
    subject = {
        "id": subject_id,
        "name": subject_name,
        "class_standard": data.classStandard,
        "classStandard": data.classStandard,
        "teacher_id": user.user_id,
    }

    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                '''
                INSERT INTO subjects (id, teacher_id, name, class_standard, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, name, class_standard
                ''',
                subject_id,
                user.user_id,
                subject_name,
                data.classStandard,
                now,
                now,
            )
            subject.update({
                "id": str(row["id"]),
                "name": row["name"],
                "class_standard": row["class_standard"],
                "classStandard": row["class_standard"],
            })
        except Exception as e:
            logger.error(f"Error creating subject in Neon: {e}")
            raise HTTPException(status_code=500, detail="Failed to create subject")
        finally:
            if conn:
                await conn.close()
    else:
        webapp_url = os.environ.get("WEBAPP_URL")
        token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
        if webapp_url and token != "sess_mock_token_12345":
            try:
                async with httpx.AsyncClient() as client_http:
                    response = await client_http.post(
                        f"{webapp_url.rstrip('/')}/api/v1/subjects",
                        json={"name": subject_name, "classStandard": data.classStandard},
                        headers={"Authorization": f"Bearer {token}", "Bypass-Tunnel-Reminder": "true"},
                        timeout=15.0,
                    )
                    if response.status_code in (200, 201):
                        created = response.json().get("data", {})
                        subject.update({
                            "id": created.get("id") or subject_id,
                            "name": created.get("name") or subject_name,
                            "class_standard": created.get("classStandard"),
                            "classStandard": created.get("classStandard"),
                        })
                    else:
                        raise HTTPException(status_code=response.status_code, detail=response.text)
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error creating subject through webapp: {e}")
                raise HTTPException(status_code=500, detail="Failed to create subject")

    await db.subjects.update_one({"id": subject["id"]}, {"$set": subject}, upsert=True)
    return {"subject": subject}


# ==================== SCAN SESSIONS ROUTES ====================

@api_router.post("/scan-sessions/create")
async def create_scan_session(data: ScanSessionCreate, authorization: Optional[str] = Header(None)):
    """Create a new scan session"""
    user = await get_current_user(authorization)
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    session_id = f"scan_{uuid.uuid4().hex[:12]}"
    
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url and token != "sess_mock_token_12345":
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            batch_id = data.batch_id
            batch_name = data.batch_name
            row = await conn.fetchrow(
                '''
                SELECT id, name
                FROM batches
                WHERE id = $1
                  AND teacher_id = $2
                  AND COALESCE(status, 'active') = 'active'
                LIMIT 1
                ''',
                batch_id,
                user.user_id,
            )
            if not row:
                if not batch_name:
                    raise HTTPException(
                        status_code=400,
                        detail="Selected batch is not synced with the webapp. Refresh batches or create it again before scanning.",
                    )
                batch_id = await ensure_webapp_batch_for_session(
                    conn,
                    {
                        "session_id": None,
                        "batch_id": data.batch_id,
                        "batch_name": batch_name,
                    },
                    user.user_id,
                )
                row = await conn.fetchrow(
                    '''
                    SELECT id, name
                    FROM batches
                    WHERE id = $1
                      AND teacher_id = $2
                      AND COALESCE(status, 'active') = 'active'
                    LIMIT 1
                    ''',
                    batch_id,
                    user.user_id,
                )
                if not row:
                    raise HTTPException(status_code=503, detail="Batch sync is unavailable. Please retry.")
                data.batch_id = str(row["id"])
            await db.batches.update_one(
                {"batch_id": str(row["id"])},
                {"$set": {
                    "batch_id": str(row["id"]),
                    "id": str(row["id"]),
                    "name": row["name"],
                    "student_count": 0,
                    "org_id": user.org_id,
                    "user_id": user.user_id,
                }},
                upsert=True,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error validating batch before scan session create: {e}")
            raise HTTPException(status_code=503, detail="Batch sync is unavailable. Please retry.")
        finally:
            if conn:
                await conn.close()

    # Find batch info from db
    batch = await db.batches.find_one({"batch_id": data.batch_id}, {"_id": 0})
    batch_name = batch["name"] if batch else (data.batch_name or "Unknown Batch")
    
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
    content_type = infer_upload_content_type(file)
    extension = content_type_extension(content_type)
    
    # Generate deterministic filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = f"s{student_index}_" if student_index is not None else ""
    # Safe filename without special characters
    uploaded_name = sanitize_uploaded_filename(file.filename, f"{phase}_{suffix}p{page_number}{extension}")
    filename = f"{phase}_{suffix}p{page_number}_{timestamp}_{uuid.uuid4().hex[:6]}{extension}"
    
    # Save to storage abstraction
    file_url = storage.save_file(session_id, filename, file.file, content_type=content_type)
    
    # Update stats if needed (placeholder for future metrics)
    return {
        "status": "success",
        "file_url": file_url,
        "filename": filename,
        "content_type": content_type,
        "original_name": uploaded_name,
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
            media_type="application/pdf" if filename.lower().endswith(".pdf") else "image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"}
        )


@api_router.api_route("/files-gcs/{gcs_key:path}", methods=["GET", "HEAD"])
async def get_gcs_file(gcs_key: str, request: Request):
    """Serve webapp GCS files through a stable backend URL.

    Mobile PDF viewers are sensitive to expiring redirects and range support. Streaming the
    GCS object through this endpoint gives the app a durable URL while still keeping storage
    private behind the backend.
    """
    try:
        safe_key = sanitize_gcs_key(gcs_key)
    except InvalidGCSKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    provider = os.environ.get("STORAGE_PROVIDER", "local").lower()
    if provider != "gcs" or not hasattr(storage, "bucket"):
        raise HTTPException(status_code=503, detail="GCS file storage is not configured")

    blob = storage.bucket.blob(safe_key)
    try:
        blob.reload()
    except Exception as exc:
        logger.error(f"GCS proxy could not load file metadata for {safe_key}: {exc}")
        raise HTTPException(status_code=404, detail="File not found")

    size = int(blob.size or 0)
    content_type = infer_content_type(Path(safe_key).name, blob.content_type)
    try:
        byte_range = parse_range_header(request.headers.get("range"), size)
    except (InvalidRangeHeaderError, ValueError) as exc:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"},
            content=str(exc),
        )

    headers = build_file_headers(
        filename=Path(safe_key).name,
        content_type=content_type,
        content_length=size,
        byte_range=byte_range,
    )

    if request.method == "HEAD":
        return Response(status_code=206 if byte_range else 200, headers=headers)

    try:
        if byte_range:
            content = blob.download_as_bytes(start=byte_range.start, end=byte_range.end)
            return Response(content=content, status_code=206, headers=headers, media_type=content_type)

        content = blob.download_as_bytes()
        return Response(content=content, status_code=200, headers=headers, media_type=content_type)
    except Exception as exc:
        logger.error(f"GCS proxy could not stream file {safe_key}: {exc}")
        signed_url = get_gcs_signed_url(safe_key, expiration_minutes=30)
        if signed_url:
            return RedirectResponse(
                url=signed_url,
                status_code=307,
                headers={"Cache-Control": "no-store, max-age=0"},
            )
        raise HTTPException(status_code=404, detail="File not found")


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


async def ensure_webapp_batch_for_session(conn, session: dict, user_id: str) -> str:
    """
    Return a valid webapp batch id for a scan session.

    Older mobile builds could create local-only batch ids like batch_123. During
    final sync we repair that by finding a teacher-owned batch with the same
    name, or creating one directly in the webapp database.
    """
    batch_id = str(session.get("batch_id") or "").strip()
    batch_name = str(session.get("batch_name") or "").strip() or "Mobile Batch"
    now = datetime.utcnow().isoformat() + 'Z'

    if batch_id:
        existing = await conn.fetchrow(
            '''
            SELECT id
            FROM batches
            WHERE id = $1
              AND teacher_id = $2
              AND COALESCE(status, 'active') NOT IN ('archived', 'deleted')
            LIMIT 1
            ''',
            batch_id,
            user_id,
        )
        if existing:
            return str(existing["id"])

    matched = await conn.fetchrow(
        '''
        SELECT id
        FROM batches
        WHERE teacher_id = $1
          AND lower(name) = lower($2)
          AND COALESCE(status, 'active') NOT IN ('archived', 'deleted')
        ORDER BY created_at ASC
        LIMIT 1
        ''',
        user_id,
        batch_name,
    )
    if matched:
        repaired_id = str(matched["id"])
    else:
        repaired_id = generate_drizzle_id("bat_")
        await conn.execute(
            '''
            INSERT INTO batches (
                id, teacher_id, name, class_standard, section,
                academic_year, status, created_at, updated_at
            )
            VALUES ($1, $2, $3, NULL, NULL, NULL, 'active', $4, $4)
            ''',
            repaired_id,
            user_id,
            batch_name,
            now,
        )

    if repaired_id != batch_id:
        session["batch_id"] = repaired_id
        if session.get("session_id"):
            await db.scan_sessions.update_one(
                {"session_id": session["session_id"], "user_id": user_id},
                {"$set": {
                    "batch_id": repaired_id,
                    "batch_name": batch_name,
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
        await db.batches.update_one(
            {"batch_id": repaired_id},
            {"$set": {
                "batch_id": repaired_id,
                "id": repaired_id,
                "name": batch_name,
                "student_count": 0,
                "user_id": user_id,
            }},
            upsert=True,
        )
        logger.info(
            "Repaired mobile scan session batch before sync: session=%s old_batch=%s new_batch=%s",
            session.get("session_id") or "<new-session>",
            batch_id,
            repaired_id,
        )

    return repaired_id


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
            batch_id = await ensure_webapp_batch_for_session(conn, session, user_id)
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

    async def mark_sync_failed(message: str) -> None:
        await db.scan_sessions.update_one(
            {"session_id": session_id, "user_id": user_id},
            {"$set": {
                "status": "sync_failed",
                "last_sync_error": message[:500],
                "updated_at": datetime.now(timezone.utc),
            }}
        )

    try:
        assert_webapp_sync_ready(getattr(storage, "backend", "local"), os.environ)
    except SyncPreflightError as exc:
        message = str(exc)
        logger.error(f"Webapp sync preflight failed for session {session_id}: {message}")
        await mark_sync_failed(message)
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

    def is_pdf_page(p_metadata: dict) -> bool:
        source = " ".join(
            str(p_metadata.get(key) or "")
            for key in ("content_type", "original_name", "file_url", "file_path")
        ).lower()
        return "application/pdf" in source or ".pdf" in source

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

    async def resolve_document_pdf(pages_metadata: list, output_path: Path, compile_temp_dir: str) -> bool:
        sorted_pages = sorted(pages_metadata, key=lambda x: x.get("page_number", 0))
        pdf_pages = [page for page in sorted_pages if is_pdf_page(page)]

        if len(sorted_pages) == 1 and pdf_pages:
            local_pdf_path = await download_file_locally(pdf_pages[0], compile_temp_dir)
            if local_pdf_path and local_pdf_path.exists():
                loop = asyncio.get_event_loop()
                if local_pdf_path.resolve() != output_path.resolve():
                    await loop.run_in_executor(None, shutil.copy, local_pdf_path, output_path)
                return True
            return False

        if pdf_pages:
            logger.error(
                "Mixed image/PDF or multiple-PDF document imports are not supported for a single document. "
                "Use one PDF per QP/model/student or scan image pages."
            )
            return False

        return await compile_pages_to_pdf(sorted_pages, output_path, compile_temp_dir)

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
                    if await resolve_document_pdf(qp_pages, qp_pdf_path, compile_temp_dir):
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
                    if await resolve_document_pdf(ma_pages, ma_pdf_path, compile_temp_dir):
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

                async def update_flow_session_progress(
                    current_step: int,
                    max_completed_step: int,
                    *,
                    active_job_id: Optional[str] = None,
                    session_submission_ids: Optional[list[str]] = None,
                    results_message: Optional[str] = None,
                ) -> None:
                    if not flow_session_id:
                        return

                    conn = await asyncpg.connect(webapp_db_url)
                    try:
                        row = await conn.fetchrow(
                            "SELECT state_json FROM upload_flow_sessions WHERE id = $1",
                            flow_session_id,
                        )
                        if not row:
                            return

                        await conn.execute(
                            '''
                            UPDATE upload_flow_sessions
                            SET current_step = $1, max_completed_step = $2, state_json = $3, updated_at = $4
                            WHERE id = $5
                            ''',
                            current_step,
                            max_completed_step,
                            merge_upload_flow_state(
                                row["state_json"],
                                source_paper_mode=source_paper_mode,
                                active_job_id=active_job_id,
                                session_submission_ids=session_submission_ids,
                                results_message=results_message,
                            ),
                            datetime.utcnow().isoformat() + 'Z',
                            flow_session_id,
                        )
                    finally:
                        await conn.close()

                async def upload_student_submissions() -> list[str]:
                    submission_ids = []
                    students = session.get("students", [])
                    for idx, student in enumerate(students):
                        st_pages = student.get("pages", [])
                        if not st_pages:
                            continue

                        st_label = student.get("label") or f"student_{idx}"
                        clean_label = "".join(c for c in st_label if c.isalnum() or c in (" ", "_", "-")).strip()
                        clean_label = clean_label.replace(" ", "_")

                        pdf_name = f"{clean_label}.pdf"
                        st_pdf_path = temp_dir_path / pdf_name

                        logger.info(f"Compiling Student {clean_label} PDF with {len(st_pages)} pages...")
                        if not await resolve_document_pdf(st_pages, st_pdf_path, compile_temp_dir):
                            logger.error(f"Unable to compile student submission PDF for {clean_label}")
                            continue

                        sub_id = generate_drizzle_id("sbm_")
                        sub_rand = generate_drizzle_id("")
                        sub_gcs_key = f"submissions/{sub_id}/answer-sheets/file_{sub_rand}_student_answer_paper.pdf"
                        sub_size = st_pdf_path.stat().st_size

                        logger.info(f"Uploading Student PDF to GCS bucket at {sub_gcs_key}...")
                        blob = storage.bucket.blob(sub_gcs_key)
                        blob.upload_from_filename(str(st_pdf_path), content_type="application/pdf")

                        conn = await asyncpg.connect(webapp_db_url)
                        try:
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
                                0.0,
                                float(session.get("total_marks") or 100.0),
                                0.0,
                                None,
                                None,
                                None,
                                None,
                                datetime.utcnow().isoformat() + 'Z',
                                datetime.utcnow().isoformat() + 'Z',
                                student.get("roll_number"),
                            )
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
                                datetime.utcnow().isoformat() + 'Z',
                            )
                        finally:
                            await conn.close()

                        submission_ids.append(sub_id)

                    return submission_ids

                # 4. Persist student submissions before blueprint extraction can fail.
                session_submission_ids = await upload_student_submissions()
                if not session_submission_ids:
                    message = "No student answer submissions were saved for this exam."
                    await update_flow_session_progress(4, 3, session_submission_ids=[], results_message=message)
                    await mark_sync_failed(message)
                    return

                active_job_id = None

                # 5. Enqueue Blueprint Extraction Job and poll for completion
                blueprint_extracted_and_locked = False
                blueprint_failure_message = None
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
                        j_row = await conn.fetchrow(
                            "SELECT status, error, success_count, processed_items FROM grading_jobs WHERE id = $1",
                            blueprint_job_id,
                        )
                        await conn.close()
                        if j_row:
                            status = j_row["status"]
                            if status == "completed" and is_successful_blueprint_job(dict(j_row)):
                                blueprint_extracted_and_locked = True
                                logger.info("Blueprint extraction completed successfully by worker!")
                                break
                            elif status == "completed":
                                blueprint_failure_message = "Blueprint extraction completed without producing a usable exam blueprint."
                                logger.error(blueprint_failure_message)
                                break
                            elif status == "failed":
                                blueprint_failure_message = f"Blueprint extraction failed: {j_row['error'] or 'unknown error'}"
                                logger.error(blueprint_failure_message)
                                break

                    if not blueprint_extracted_and_locked:
                        failure_message = (
                            blueprint_failure_message
                            or "Blueprint extraction timed out before producing a usable exam blueprint."
                        )
                        await update_flow_session_progress(
                            4,
                            3,
                            session_submission_ids=session_submission_ids,
                            results_message=failure_message,
                        )
                        await mark_sync_failed(failure_message)
                        return
                    
                    # Update upload flow session step 5 if blueprint ready
                    if blueprint_extracted_and_locked and flow_session_id:
                        try:
                            logger.info("Updating upload flow session progress to Step 5 mid-way in Neon DB...")
                            await update_flow_session_progress(
                                5,
                                4,
                                active_job_id="",
                                session_submission_ids=session_submission_ids,
                            )
                        except Exception as e:
                            logger.error(f"Failed to update flow session progress mid-way: {e}")

                # 6. Enqueue Grading Job for Submissions and Update Flow Session Card
                if session_submission_ids:
                    active_job_id = generate_drizzle_id("job_")
                    logger.info(f"Enqueuing grading job {active_job_id} in Neon...")
                    grading_queue = build_grading_submission_queue(
                        session_submission_ids,
                        pilot_review_first=pilot_review_first_enabled(session.get("settings")),
                    )
                    queued_submission_ids = grading_queue["queued_submission_ids"]
                    held_submission_ids = grading_queue["held_submission_ids"]
                    queue_first_only = grading_queue["queue_first_only"]
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
                        len(queued_submission_ids),
                        0,
                        0,
                        0,
                        0,
                        json.dumps({
                            "submissionIds": queued_submission_ids,
                            "heldSubmissionIds": held_submission_ids,
                            "teacherId": user_id,
                            "flow": "batch_grading",
                            "source": "mobile_scanner",
                            "queueFirstOnly": queue_first_only,
                        }),
                        "{}",
                        datetime.utcnow().isoformat() + 'Z',
                        datetime.utcnow().isoformat() + 'Z'
                    )
                    await conn.close()
                    await db.scan_sessions.update_one(
                        {"session_id": session_id, "user_id": user_id},
                        {"$set": {
                            "status": "grading",
                            "grading_job_id": active_job_id,
                            "grading_job_type": "grade_submissions",
                            "grading_status": "queued",
                            "grading_progress": 0.0,
                            "grading_processed_items": 0,
                            "grading_total_items": len(queued_submission_ids),
                            "updated_at": datetime.now(timezone.utc),
                        }}
                    )

                # Update upload flow session step 5 (completed / draft)
                if flow_session_id:
                    try:
                        logger.info("Updating final upload flow session state in Neon DB...")
                        current_step = 5 if blueprint_extracted_and_locked else 4
                        max_completed_step = 5 if blueprint_extracted_and_locked else 3
                        await update_flow_session_progress(
                            current_step,
                            max_completed_step,
                            active_job_id=active_job_id or "",
                            session_submission_ids=session_submission_ids,
                        )
                        logger.info("Final upload flow session card updated successfully via Neon DB!")
                    except Exception as e:
                        logger.error(f"Failed to update final flow session progress: {e}")
                        
            logger.info("Direct Neon DB and GCS background sync completed successfully!")
            final_status = "grading" if active_job_id else "uploaded"
            update_payload = {
                "status": final_status,
                "upload_progress": 100,
                "last_sync_error": None,
                "updated_at": datetime.now(timezone.utc),
            }
            if active_job_id:
                update_payload.update({
                    "grading_job_id": active_job_id,
                    "grading_job_type": "grade_submissions",
                    "grading_status": "queued",
                    "grading_progress": 0.0,
                    "grading_processed_items": 0,
                    "grading_total_items": len(queued_submission_ids),
                })
            await db.scan_sessions.update_one(
                {"session_id": session_id, "user_id": user_id},
                {"$set": update_payload}
            )
            return
        except Exception as e:
            logger.exception(f"Failed direct Neon background sync for session {session_id}")
            await mark_sync_failed(str(e))
            return


@api_router.post("/scan-sessions/{session_id}/complete")
async def complete_scan_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(None)
):
    """Mark scan session as complete and sync to webapp"""
    user = await get_current_user(authorization)
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user.user_id})
    validation_errors = validate_scan_session_ready_for_sync(session)
    if validation_errors:
        message = " ".join(validation_errors)
        await db.scan_sessions.update_one(
            {"session_id": session_id, "user_id": user.user_id},
            {"$set": {
                "status": "failed",
                "last_sync_error": message[:500],
                "updated_at": datetime.now(timezone.utc),
            }}
        )
        raise HTTPException(status_code=422, detail=message)

    if token != "sess_mock_token_12345":
        try:
            assert_webapp_sync_ready(getattr(storage, "backend", "local"), os.environ)
        except SyncPreflightError as exc:
            message = str(exc)
            logger.error(f"Refusing to complete scan session {session_id}: {message}")
            await db.scan_sessions.update_one(
                {"session_id": session_id, "user_id": user.user_id},
                {"$set": {
                    "status": "failed",
                    "last_sync_error": message[:500],
                    "updated_at": datetime.now(timezone.utc),
                }}
            )
            raise HTTPException(status_code=503, detail=message)
    
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
            
            # CRITICAL: Save exam_id immediately after creation, but keep the
            # session in syncing until the background task has inserted files,
            # submissions, and grading jobs into the webapp database.
            # This must happen before any flow-session or background-task code so that
            # a later exception cannot leave MongoDB with exam_id=None.
            await db.scan_sessions.update_one(
                {"session_id": session_id, "user_id": user.user_id},
                {"$set": {"exam_id": exam_id, "status": "syncing", "upload_progress": 100}}
            )
            logger.info(f"Saved exam_id={exam_id} and status=syncing to MongoDB for session {session_id}")
            
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
                        state_dict = build_upload_flow_state(session, source_paper_mode)
                        
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
                                "state": build_upload_flow_state(session, source_paper_mode)
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
            
            return {"exam_id": exam_id, "status": "syncing"}
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


async def reconcile_scan_sessions_with_webapp(user_id: str, sessions: list[dict]) -> list[dict]:
    """Keep mobile scan sessions aligned with the authoritative webapp grading jobs."""
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    candidates = [
        session
        for session in sessions
        if session.get("exam_id")
    ]
    if not webapp_db_url or not candidates:
        return sessions

    exam_ids = [str(session["exam_id"]) for session in candidates]
    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        exam_rows = await conn.fetch(
            '''
            SELECT id, status
            FROM exams
            WHERE id = ANY($1::text[])
              AND teacher_id = $2
            ''',
            exam_ids,
            user_id,
        )
        removed_exam_ids = deleted_or_missing_webapp_exam_ids(
            exam_ids,
            [dict(row) for row in exam_rows],
        )
        if removed_exam_ids:
            await delete_upload_flows_for_exams(conn, user_id, removed_exam_ids)
            await db.scan_sessions.delete_many({
                "user_id": user_id,
                "exam_id": {"$in": list(removed_exam_ids)},
            })
            sessions = [
                session
                for session in sessions
                if str(session.get("exam_id") or "") not in removed_exam_ids
            ]
            candidates = [
                session
                for session in candidates
                if str(session.get("exam_id") or "") not in removed_exam_ids
            ]
            exam_ids = [str(session["exam_id"]) for session in candidates]
            if not candidates:
                return sessions

        job_rows = await conn.fetch(
            '''
            SELECT id, type, status, exam_id, progress, total_items, processed_items,
                   success_count, failure_count, error, created_at
            FROM grading_jobs
            WHERE exam_id = ANY($1::text[])
            ORDER BY created_at DESC
            ''',
            exam_ids,
        )
        submission_rows = await conn.fetch(
            '''
            SELECT exam_id, COUNT(*) AS submission_count
            FROM submissions
            WHERE exam_id = ANY($1::text[])
            GROUP BY exam_id
            ''',
            exam_ids,
        )
    except Exception as exc:
        logger.error(f"Failed to reconcile scan sessions with webapp jobs: {exc}")
        return sessions
    finally:
        if conn:
            await conn.close()

    jobs_by_exam: dict[str, list[dict]] = {}
    for row in job_rows:
        row_dict = dict(row)
        jobs_by_exam.setdefault(str(row_dict["exam_id"]), []).append(row_dict)

    submissions_by_exam = {
        str(row["exam_id"]): int(row["submission_count"] or 0)
        for row in submission_rows
    }

    for session in candidates:
        exam_id = str(session["exam_id"])
        patch = derive_scan_session_reconciliation(
            session,
            jobs_by_exam.get(exam_id, []),
            submissions_by_exam.get(exam_id, 0),
        )
        if not patch:
            continue

        patch["updated_at"] = datetime.now(timezone.utc)
        await db.scan_sessions.update_one(
            {"session_id": session["session_id"], "user_id": user_id},
            {"$set": patch},
        )
        session.update(patch)

    return sessions


@api_router.delete("/scan-sessions/{session_id}")
async def delete_scan_session(session_id: str, authorization: Optional[str] = Header(None)):
    """Delete a scan session and its linked webapp exam when one exists."""
    user = await get_current_user(authorization)
    session = await db.scan_sessions.find_one({"session_id": session_id, "user_id": user.user_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or already deleted")

    exam_id = session.get("exam_id")
    if exam_id:
        try:
            await soft_delete_webapp_exam(str(exam_id), user.user_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting linked webapp exam {exam_id} for scan session {session_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to delete linked webapp exam")

    result = await db.scan_sessions.delete_many({"session_id": session_id, "user_id": user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found or already deleted")
    return {"status": "success", "deleted": True}


@api_router.get("/scan-sessions")
async def get_user_sessions(authorization: Optional[str] = Header(None)):
    """Get all scan sessions for the user"""
    user = await get_current_user(authorization)
    sessions = await db.scan_sessions.find({"user_id": user.user_id}, {"_id": 0}).to_list(100)
    sessions = await reconcile_scan_sessions_with_webapp(user.user_id, sessions)
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
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            rows = await conn.fetch(
                '''
                SELECT s.id,
                       s.student_id,
                       s.student_name,
                       s.student_roll_number,
                       s.total_score,
                       e.total_marks,
                       s.status,
                       roster.name AS roster_student_name,
                       roster.roll_number AS roster_student_roll_number,
                       ROW_NUMBER() OVER (
                         ORDER BY s.student_roll_number ASC NULLS LAST,
                                  s.created_at ASC NULLS LAST,
                                  s.id ASC
                       ) AS display_ordinal
                FROM submissions s
                JOIN exams e ON e.id = s.exam_id
                LEFT JOIN LATERAL (
                    SELECT u.id, u.name, u.roll_number
                    FROM users u
                    LEFT JOIN batch_students bs
                      ON bs.student_id = u.id
                     AND bs.batch_id = e.batch_id
                    WHERE (s.student_id IS NOT NULL AND u.id = s.student_id)
                       OR (
                         s.student_id IS NULL
                         AND NULLIF(s.student_roll_number, '') IS NOT NULL
                         AND bs.batch_id = e.batch_id
                         AND u.roll_number = s.student_roll_number
                       )
                    ORDER BY CASE WHEN u.id = s.student_id THEN 0 ELSE 1 END
                    LIMIT 1
                ) roster ON TRUE
                WHERE s.exam_id = $1
                  AND COALESCE(s.status, '') <> 'deleted'
                ORDER BY s.student_roll_number ASC NULLS LAST,
                         s.created_at ASC NULLS LAST,
                         s.id ASC
                ''',
                exam_id
            )
            await conn.close()
            submissions = []
            for row in rows:
                identity = normalize_review_student_identity(dict(row), int(row["display_ordinal"] or 1))
                submissions.append({
                    "id": str(row["id"]),
                    "studentName": identity.student_name,
                    "studentRollNumber": identity.student_roll_number,
                    "matchedStudentId": identity.matched_student_id,
                    "totalScore": row["total_score"] or 0,
                    "totalMarks": row["total_marks"] or 100,
                    "status": row["status"] or "graded"
                })
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
async def get_submission_detail_proxy(submission_id: str, request: Request, authorization: Optional[str] = Header(None)):
    """Get submission details - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url and not submission_id.startswith("sub_local_"):
        try:
            conn = await asyncpg.connect(webapp_db_url)
            sub_row = await conn.fetchrow(
                '''
                WITH ranked_submissions AS (
                    SELECT s.id,
                           s.exam_id,
                           s.student_id,
                           s.student_name,
                           s.student_roll_number,
                           s.total_score,
                           s.status,
                           s.teacher_feedback,
                           e.teacher_id,
                           e.batch_id,
                           e.total_marks,
                           ROW_NUMBER() OVER (
                             PARTITION BY s.exam_id
                             ORDER BY s.student_roll_number ASC NULLS LAST,
                                      s.created_at ASC NULLS LAST,
                                      s.id ASC
                           ) AS display_ordinal
                    FROM submissions s
                    JOIN exams e ON e.id = s.exam_id
                    WHERE COALESCE(s.status, '') <> 'deleted'
                )
                SELECT rs.id,
                       rs.student_id,
                       rs.student_name,
                       rs.student_roll_number,
                       rs.total_score,
                       rs.status,
                       rs.teacher_feedback,
                       rs.exam_id,
                       rs.total_marks,
                       rs.display_ordinal,
                       roster.name AS roster_student_name,
                       roster.roll_number AS roster_student_roll_number
                FROM ranked_submissions rs
                LEFT JOIN LATERAL (
                    SELECT u.id, u.name, u.roll_number
                    FROM users u
                    LEFT JOIN batch_students bs
                      ON bs.student_id = u.id
                     AND bs.batch_id = rs.batch_id
                    WHERE (rs.student_id IS NOT NULL AND u.id = rs.student_id)
                       OR (
                         rs.student_id IS NULL
                         AND NULLIF(rs.student_roll_number, '') IS NOT NULL
                         AND bs.batch_id = rs.batch_id
                         AND u.roll_number = rs.student_roll_number
                       )
                    ORDER BY CASE WHEN u.id = rs.student_id THEN 0 ELSE 1 END
                    LIMIT 1
                ) roster ON TRUE
                WHERE rs.id = $1 AND rs.teacher_id = $2
                ''',
                submission_id,
                user.user_id
            )
            if sub_row:
                score_columns = await conn.fetch(
                    '''
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'question_scores'
                    '''
                )
                student_answer_expr = student_answer_text_select_expression(
                    [row["column_name"] for row in score_columns]
                )
                score_rows = await conn.fetch(
                    f'''
                    SELECT sc.id, sc.question_number, sc.obtained_marks, sc.max_marks,
                           qi.question_text, sc.ai_feedback, sc.teacher_correction,
                           {student_answer_expr} AS student_answer_text
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
                        SELECT f.id, f.kind, f.original_name, f.content_type, f.gcs_key, f.annotation_gcs_key
                        FROM submission_files f
                        WHERE f.submission_id = $1
                        ''',
                        submission_id
                    )
                else:
                    file_rows = await conn.fetch(
                        '''
                        SELECT f.id, f.kind, f.original_name, f.content_type, f.gcs_key, NULL as annotation_gcs_key
                        FROM submission_files f
                        WHERE f.submission_id = $1
                        ''',
                        submission_id
                    )
                exam_file_rows = await conn.fetch(
                    '''
                    SELECT id, kind, original_name, content_type, gcs_key
                    FROM exam_files
                    WHERE exam_id = $1
                      AND kind IN ('question_paper', 'model_answer')
                    ORDER BY CASE kind WHEN 'question_paper' THEN 1 WHEN 'model_answer' THEN 2 ELSE 3 END,
                             created_at ASC
                    ''',
                    sub_row["exam_id"]
                )
                await conn.close()

                files = []
                file_base_url = public_request_base_url(request)
                for f in file_rows:
                    gcs_key = f["gcs_key"]
                    ann_key = f["annotation_gcs_key"]
                    
                    signed_url = build_gcs_proxy_url(file_base_url, gcs_key, cache_key=f"{f['id']}")
                    ann_signed_url = build_gcs_proxy_url(file_base_url, ann_key, cache_key=f"{f['id']}-ann")
                        
                    files.append({
                        "id": str(f["id"]),
                        "kind": f["kind"] or "answer_sheet",
                        "fileType": f["kind"] or "answer_sheet",
                        "originalName": f["original_name"] or "answer_sheet.pdf",
                        "contentType": f["content_type"],
                        "signedUrl": signed_url,
                        "annotationSignedUrl": ann_signed_url
                    })
                for f in exam_file_rows:
                    gcs_key = f["gcs_key"]
                    signed_url = build_gcs_proxy_url(file_base_url, gcs_key, cache_key=f"{f['id']}")
                    files.append({
                        "id": str(f["id"]),
                        "kind": f["kind"],
                        "fileType": f["kind"],
                        "originalName": f["original_name"],
                        "contentType": f["content_type"],
                        "signedUrl": signed_url,
                        "annotationSignedUrl": None
                    })

                identity = normalize_review_student_identity(
                    dict(sub_row),
                    int(sub_row["display_ordinal"] or 1),
                )
                return {
                    "data": {
                        "submission": {
                            "id": str(sub_row["id"]),
                            "studentName": identity.student_name,
                            "studentRollNumber": identity.student_roll_number,
                            "matchedStudentId": identity.matched_student_id,
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
                                "teacherCorrection": sc["teacher_correction"],
                                "studentAnswerText": sc["student_answer_text"],
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




@api_router.post("/v1/submissions/{submission_id}/scores/{score_id}/improve-ai")
async def improve_question_grading(
    submission_id: str,
    score_id: str,
    data: dict,
    authorization: Optional[str] = Header(None),
):
    """Save a question-level AI grading correction that the grader can reuse."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        result = await save_question_improvement(
            conn,
            teacher_id=user.user_id,
            submission_id=submission_id,
            score_id=score_id,
            data=data,
            generate_id=generate_drizzle_id,
            now_text=utc_now_text,
        )
        if bool(data.get("regradeAll")) and result.get("examId"):
            submission_rows = await conn.fetch(
                '''
                SELECT s.id
                FROM submissions s
                JOIN exams e ON e.id = s.exam_id
                WHERE s.exam_id = $1 AND e.teacher_id = $2
                ORDER BY s.created_at ASC
                ''',
                result["examId"],
                user.user_id,
            )
            submission_ids = [str(row["id"]) for row in submission_rows]
            if submission_ids:
                now = utc_now_text()
                await conn.execute(
                    '''
                    INSERT INTO grading_jobs (
                        id, type, status, exam_id, teacher_id,
                        progress, total_items, processed_items, success_count, failure_count,
                        attempts, payload_json, result_json, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    ''',
                    generate_drizzle_id("job_"),
                    "grade_submissions",
                    "queued",
                    result["examId"],
                    user.user_id,
                    0.0,
                    len(submission_ids),
                    0,
                    0,
                    0,
                    0,
                    json.dumps({
                        "submissionIds": submission_ids,
                        "teacherId": user.user_id,
                        "flow": "mobile_improve_ai_regrade",
                        "sourceScoreId": score_id,
                    }),
                    "{}",
                    now,
                    now,
                )
                result["regradeQueued"] = True
        return {"data": result}
    except ImproveAIServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception as e:
        logger.error(f"Error saving question-level Improve AI correction: {e}")
        raise HTTPException(status_code=500, detail="Failed to save Improve AI correction")
    finally:
        if conn:
            await conn.close()


async def enqueue_pilot_review_continuation(submission_id: str, authorization: Optional[str]) -> None:
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        return

    user = await get_current_user(authorization)
    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        submission_row = await conn.fetchrow(
            '''
            SELECT s.exam_id, e.teacher_id
            FROM submissions s
            INNER JOIN exams e ON e.id = s.exam_id
            WHERE s.id = $1
            ''',
            submission_id,
        )
        if not submission_row:
            return

        exam_id = str(submission_row["exam_id"])
        teacher_id = str(submission_row["teacher_id"] or user.user_id)
        if teacher_id != user.user_id:
            logger.warning(f"Skipping pilot review continuation for unauthorized teacher {user.user_id}")
            return

        job_rows = await conn.fetch(
            '''
            SELECT id, payload_json
            FROM grading_jobs
            WHERE exam_id = $1
              AND teacher_id = $2
              AND type IN ('grade_submissions', 'bulk_grade')
            ORDER BY created_at DESC
            ''',
            exam_id,
            teacher_id,
        )
        continuation = find_pilot_review_continuation(
            [dict(row) for row in job_rows],
            submission_id,
        )
        if not continuation:
            return

        held_submission_ids = continuation["held_submission_ids"]
        if not held_submission_ids:
            return

        job_id = generate_drizzle_id("job_")
        now = datetime.utcnow().isoformat() + 'Z'
        await conn.execute(
            '''
            INSERT INTO grading_jobs (
                id, type, status, exam_id, teacher_id,
                progress, total_items, processed_items, success_count, failure_count,
                attempts, payload_json, result_json, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ''',
            job_id,
            "grade_submissions",
            "queued",
            exam_id,
            teacher_id,
            0.0,
            len(held_submission_ids),
            0,
            0,
            0,
            0,
            json.dumps({
                "submissionIds": held_submission_ids,
                "heldSubmissionIds": [],
                "teacherId": teacher_id,
                "flow": "batch_grading",
                "source": "mobile_pilot_review_remaining",
                "queueFirstOnly": False,
                "pilotSourceJobId": continuation["source_job_id"],
            }),
            "{}",
            now,
            now,
        )
        await db.scan_sessions.update_one(
            {"exam_id": exam_id, "user_id": teacher_id},
            {"$set": {
                "status": "grading",
                "grading_job_id": job_id,
                "grading_job_type": "grade_submissions",
                "grading_status": "queued",
                "grading_progress": 0.0,
                "grading_processed_items": 0,
                "grading_total_items": len(held_submission_ids),
                "updated_at": datetime.now(timezone.utc),
            }}
        )
        logger.info(f"Queued pilot review continuation job {job_id} for {len(held_submission_ids)} held submissions.")
    except Exception as exc:
        logger.error(f"Failed to queue pilot review continuation after {submission_id}: {exc}")
    finally:
        if conn:
            await conn.close()


@api_router.post("/v1/submissions/{submission_id}/review")
async def post_submission_review_proxy(submission_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Save review grades (proxied to webapp or mock save)"""
    direct_save_response = None
    direct_save_failed = False
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if webapp_db_url and not submission_id.startswith("sub_mock_") and not submission_id.startswith("sub_local_"):
        conn = None
        try:
            user = await get_current_user(authorization)
            conn = await asyncpg.connect(webapp_db_url)
            direct_save_response = await save_submission_review_edits(
                conn,
                teacher_id=user.user_id,
                submission_id=submission_id,
                data=data,
                now_text=utc_now_text(),
            )
        except ReviewSaveServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail)
        except Exception as exc:
            direct_save_failed = True
            logger.error(f"Error saving mobile review edits directly: {exc}")
        finally:
            if conn:
                await conn.close()

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
                    await enqueue_pilot_review_continuation(submission_id, authorization)
                    if direct_save_response:
                        return direct_save_response
                    return response.json()
                logger.warn(f"Proxy review save returned status {response.status_code}: {response.text}")
        except Exception as e:
            logger.error(f"Error proxying submission review: {e}")

    if direct_save_response:
        await enqueue_pilot_review_continuation(submission_id, authorization)
        return direct_save_response

    if direct_save_failed:
        raise HTTPException(status_code=503, detail="Failed to save review changes")

    logger.info(f"Mock review saved for submission {submission_id}: {data}")
    return {"success": True, "message": "Review saved successfully (mock)"}


@api_router.get("/v1/analytics/overview")
async def get_analytics_overview_proxy(authorization: Optional[str] = Header(None)):
    """Get analytics overview - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            stats_row = await conn.fetchrow(
                '''
                SELECT COUNT(DISTINCT e.id) AS exams_count,
                       COUNT(s.id) AS submission_count,
                       COUNT(CASE WHEN s.status IN ('ai_graded', 'graded', 'reviewed', 'published') THEN 1 END) AS reviewed_count,
                       AVG(s.percentage) AS average_percentage
                FROM exams e
                LEFT JOIN batches b ON b.id = e.batch_id
                LEFT JOIN submissions s ON s.exam_id = e.id
                WHERE e.teacher_id = $1
                  AND COALESCE(e.status, '') <> 'deleted'
                  AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
                ''',
                user.user_id
            )
            rows = await conn.fetch(
                '''
                SELECT e.id, e.name, e.exam_date, e.total_marks, e.status
                FROM exams e
                LEFT JOIN batches b ON b.id = e.batch_id
                WHERE e.teacher_id = $1
                  AND COALESCE(e.status, '') <> 'deleted'
                  AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
                ORDER BY e.created_at DESC
                LIMIT 10
                ''',
                user.user_id
            )

            recent_exams = []
            for r in rows:
                recent_exams.append({
                    "id": str(r["id"]),
                    "name": r["name"],
                    "examDate": r["exam_date"].isoformat() if r["exam_date"] else None,
                    "totalMarks": r["total_marks"],
                    "status": r["status"] or "graded"
                })

            return {
                "data": {
                    "examsCount": stats_row["exams_count"] if stats_row else len(recent_exams),
                    "submissionsCount": stats_row["submission_count"] if stats_row else 0,
                    "reviewedCount": stats_row["reviewed_count"] if stats_row else 0,
                    "averagePercentage": round(float(stats_row["average_percentage"] or 0), 1) if stats_row else 0.0,
                    "recentExams": recent_exams
                }
            }
        except Exception as e:
            logger.error(f"Error querying Neon for analytics: {e}")
        finally:
            if conn:
                await conn.close()

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


@api_router.get("/v1/analytics/performance")
async def get_analytics_performance(authorization: Optional[str] = Header(None)):
    """Get synced subject, student, and question-level analytics from Neon."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        return {"data": {"subjectPerformance": [], "studentRankings": [], "weakStudents": [], "weakQuestions": []}}

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        subject_rows = await conn.fetch(
            '''
            SELECT COALESCE(subj.name, 'Unassigned') AS subject_name,
                   COUNT(DISTINCT e.id) AS exams_count,
                   AVG(s.percentage) AS average_percentage
            FROM exams e
            LEFT JOIN batches b ON b.id = e.batch_id
            LEFT JOIN subjects subj ON subj.id = e.subject_id
            LEFT JOIN submissions s ON s.exam_id = e.id
            WHERE e.teacher_id = $1
              AND COALESCE(e.status, '') <> 'deleted'
              AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            GROUP BY COALESCE(subj.name, 'Unassigned')
            ORDER BY subject_name ASC
            ''',
            user.user_id
        )
        top_student_rows = await conn.fetch(
            '''
            SELECT s.student_name, s.student_roll_number, e.name AS exam_name,
                   s.total_score, s.total_marks
            FROM submissions s
            JOIN exams e ON e.id = s.exam_id
            LEFT JOIN batches b ON b.id = e.batch_id
            WHERE e.teacher_id = $1
              AND COALESCE(e.status, '') <> 'deleted'
              AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            ORDER BY s.percentage DESC NULLS LAST
            LIMIT 10
            ''',
            user.user_id
        )
        weak_student_rows = await conn.fetch(
            '''
            SELECT s.student_name, s.student_roll_number, e.name AS exam_name,
                   s.total_score, s.total_marks
            FROM submissions s
            JOIN exams e ON e.id = s.exam_id
            LEFT JOIN batches b ON b.id = e.batch_id
            WHERE e.teacher_id = $1
              AND COALESCE(e.status, '') <> 'deleted'
              AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            ORDER BY s.percentage ASC NULLS LAST
            LIMIT 10
            ''',
            user.user_id
        )
        question_rows = await conn.fetch(
            '''
            SELECT qs.question_number,
                   COALESCE(qi.question_text, '') AS question_text,
                   AVG(qs.obtained_marks) AS average_score,
                   MAX(qs.max_marks) AS max_marks,
                   COUNT(qs.id) AS attempts
            FROM question_scores qs
            JOIN submissions s ON s.id = qs.submission_id
            JOIN exams e ON e.id = s.exam_id
            LEFT JOIN batches b ON b.id = e.batch_id
            LEFT JOIN question_items qi ON qi.id = qs.question_id
            WHERE e.teacher_id = $1
              AND COALESCE(e.status, '') <> 'deleted'
              AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            GROUP BY qs.question_number, COALESCE(qi.question_text, '')
            HAVING COUNT(qs.id) > 0
            ''',
            user.user_id
        )
        return {
            "data": {
                "subjectPerformance": build_subject_performance([dict(row) for row in subject_rows]),
                "studentRankings": build_student_ranking([dict(row) for row in top_student_rows]),
                "weakStudents": build_weak_student_ranking([dict(row) for row in weak_student_rows]),
                "weakQuestions": build_question_stats([dict(row) for row in question_rows]),
            }
        }
    except Exception as e:
        logger.error(f"Error querying Neon performance analytics: {e}")
        raise HTTPException(status_code=500, detail="Failed to load performance analytics")
    finally:
        if conn:
            await conn.close()


async def fetch_managed_exam(conn, exam_id: str, teacher_id: str):
    row = await conn.fetchrow(
        '''
        SELECT e.id, e.name, e.batch_id, e.subject_id, e.total_marks, e.exam_date, e.status,
               b.name AS batch_name, subj.name AS subject_name,
               e.grading_mode, e.grading_instructions, e.feedback_enabled,
               e.results_published, e.published_at,
               COUNT(s.id) AS submission_count,
               COUNT(CASE WHEN s.status IN ('ai_graded', 'graded', 'reviewed', 'published') THEN 1 END) AS graded_submission_count,
               AVG(s.percentage) AS average_percentage
        FROM exams e
        LEFT JOIN batches b ON b.id = e.batch_id
        LEFT JOIN subjects subj ON subj.id = e.subject_id
        LEFT JOIN submissions s ON s.exam_id = e.id
        WHERE e.id = $1
          AND e.teacher_id = $2
          AND COALESCE(e.status, '') <> 'deleted'
          AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
        GROUP BY e.id, e.name, e.batch_id, e.subject_id, e.total_marks, e.exam_date, e.status,
                 b.name, subj.name,
                 e.grading_mode, e.grading_instructions, e.feedback_enabled,
                 e.results_published, e.published_at, e.created_at
        ''',
        exam_id,
        teacher_id
    )
    if not row:
        return None
    exams = build_managed_exams([dict(row)])
    return exams[0] if exams else None


async def soft_delete_webapp_exam(exam_id: str, teacher_id: str) -> bool:
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        async with conn.transaction():
            row = await conn.fetchrow(
                '''
                UPDATE exams
                SET status = 'deleted', updated_at = $3
                WHERE id = $1
                  AND teacher_id = $2
                  AND COALESCE(status, '') <> 'deleted'
                RETURNING id
                ''',
                exam_id,
                teacher_id,
                utc_now_text()
            )
            if row:
                await delete_upload_flows_for_exams(conn, teacher_id, [exam_id])
        return bool(row)
    finally:
        if conn:
            await conn.close()


@api_router.get("/v1/exams")
async def list_exams_v1(authorization: Optional[str] = Header(None)):
    """List exams - reads directly from Neon PostgreSQL (always reachable from Render)"""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")

    if webapp_db_url:
        try:
            conn = await asyncpg.connect(webapp_db_url)
            await delete_stale_upload_flows_for_teacher(conn, user.user_id)
            rows = await conn.fetch(
                '''
                SELECT e.id, e.name, e.batch_id, e.subject_id, e.total_marks, e.exam_date, e.status,
                       b.name AS batch_name, subj.name AS subject_name,
                       e.grading_mode, e.grading_instructions, e.feedback_enabled,
                       e.results_published, e.published_at,
                       COUNT(s.id) AS submission_count,
                       COUNT(CASE WHEN s.status IN ('ai_graded', 'graded', 'reviewed', 'published') THEN 1 END) AS graded_submission_count,
                       AVG(s.percentage) AS average_percentage
                FROM exams e
                LEFT JOIN batches b ON b.id = e.batch_id
                LEFT JOIN subjects subj ON subj.id = e.subject_id
                LEFT JOIN submissions s ON s.exam_id = e.id
                WHERE e.teacher_id = $1
                  AND COALESCE(e.status, '') <> 'deleted'
                  AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
                GROUP BY e.id, e.name, e.batch_id, e.subject_id, e.total_marks, e.exam_date, e.status,
                         b.name, subj.name,
                         e.grading_mode, e.grading_instructions, e.feedback_enabled,
                         e.results_published, e.published_at, e.created_at
                ORDER BY e.created_at DESC
                LIMIT 50
                ''',
                user.user_id
            )
            return {"data": build_managed_exams([dict(row) for row in rows])}
        except Exception as e:
            logger.error(f"Error querying Neon for exams list: {e}")
        finally:
            if conn:
                await conn.close()

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


@api_router.patch("/v1/exams/{exam_id}")
async def update_exam_v1(exam_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Update synced exam metadata owned by the authenticated teacher."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    payload = normalize_exam_update_payload(data)
    if not payload:
        raise HTTPException(status_code=400, detail="No supported exam fields were provided")

    now = utc_now_text()
    values = [exam_id, user.user_id]
    assignments = []
    for column, value in payload.items():
        values.append(value)
        assignments.append(f"{column} = ${len(values)}")
    values.append(now)
    assignments.append(f"updated_at = ${len(values)}")

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        row = await conn.fetchrow(
            f'''
            UPDATE exams
            SET {", ".join(assignments)}
            WHERE id = $1
              AND teacher_id = $2
              AND COALESCE(status, '') <> 'deleted'
            RETURNING id
            ''',
            *values
        )
        if not row:
            raise HTTPException(status_code=404, detail="Exam not found")

        exam = await fetch_managed_exam(conn, exam_id, user.user_id)
        return {"data": exam}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating exam in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to update exam")
    finally:
        if conn:
            await conn.close()


@api_router.post("/v1/exams/{exam_id}/close")
async def close_exam_v1(exam_id: str, authorization: Optional[str] = Header(None)):
    """Close an exam without deleting its submissions or files."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        row = await conn.fetchrow(
            '''
            UPDATE exams
            SET status = 'closed', updated_at = $3
            WHERE id = $1
              AND teacher_id = $2
              AND COALESCE(status, '') <> 'deleted'
            RETURNING id
            ''',
            exam_id,
            user.user_id,
            utc_now_text()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Exam not found")
        exam = await fetch_managed_exam(conn, exam_id, user.user_id)
        return {"data": exam}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error closing exam in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to close exam")
    finally:
        if conn:
            await conn.close()


@api_router.post("/v1/exams/{exam_id}/publish")
async def publish_exam_results_v1(exam_id: str, authorization: Optional[str] = Header(None)):
    """Publish exam results in the synced webapp database."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    now = utc_now_text()
    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        async with conn.transaction():
            row = await conn.fetchrow(
                '''
                UPDATE exams
                SET results_published = TRUE,
                    published_at = COALESCE(published_at, $3),
                    status = CASE WHEN status = 'closed' THEN status ELSE 'published' END,
                    updated_at = $3
                WHERE id = $1
                  AND teacher_id = $2
                  AND COALESCE(status, '') <> 'deleted'
                RETURNING id
                ''',
                exam_id,
                user.user_id,
                now
            )
            if not row:
                raise HTTPException(status_code=404, detail="Exam not found")
            await conn.execute(
                '''
                UPDATE submissions
                SET published_at = COALESCE(published_at, $2),
                    updated_at = $2
                WHERE exam_id = $1
                ''',
                exam_id,
                now
            )
        exam = await fetch_managed_exam(conn, exam_id, user.user_id)
        return {"data": exam}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error publishing exam results in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to publish exam results")
    finally:
        if conn:
            await conn.close()


@api_router.delete("/v1/exams/{exam_id}")
async def archive_exam_v1(exam_id: str, authorization: Optional[str] = Header(None)):
    """Soft-delete an exam from mobile while preserving historical records."""
    user = await get_current_user(authorization)
    try:
        deleted = await soft_delete_webapp_exam(exam_id, user.user_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Exam not found")
        await db.scan_sessions.delete_many({"exam_id": exam_id, "user_id": user.user_id})
        return {"success": True, "id": exam_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error archiving exam in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to archive exam")


@api_router.get("/v1/exams/{exam_id}/settings")
async def get_exam_review_settings(exam_id: str, authorization: Optional[str] = Header(None)):
    """Read review settings from the webapp database so mobile stays in sync."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    try:
        conn = await asyncpg.connect(webapp_db_url)
        row = await conn.fetchrow(
            '''
            SELECT e.grading_mode, e.feedback_enabled, e.grading_instructions,
                   u.state_json
            FROM exams e
            LEFT JOIN LATERAL (
                SELECT state_json
                FROM upload_flow_sessions
                WHERE exam_id = e.id
                ORDER BY created_at DESC
                LIMIT 1
            ) u ON TRUE
            WHERE e.id = $1 AND e.teacher_id = $2
            ''',
            exam_id,
            user.user_id
        )
        await conn.close()
    except Exception as e:
        logger.error(f"Error reading exam settings from Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to read exam settings")

    if not row:
        raise HTTPException(status_code=404, detail="Exam not found")

    settings = normalize_review_settings({
        "grading_mode": row["grading_mode"],
        "feedback_enabled": row["feedback_enabled"],
        "grading_instructions": row["grading_instructions"],
        "difficulty": difficulty_from_state_json(row["state_json"]),
    })
    return {"data": settings}


@api_router.patch("/v1/exams/{exam_id}/settings")
async def update_exam_review_settings(exam_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Update synced review settings on the webapp database."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    settings = normalize_review_settings(data)
    now = utc_now_text()

    try:
        conn = await asyncpg.connect(webapp_db_url)
        row = await conn.fetchrow(
            '''
            UPDATE exams
            SET grading_mode = $3,
                feedback_enabled = $4,
                grading_instructions = $5,
                updated_at = $6
            WHERE id = $1 AND teacher_id = $2
            RETURNING grading_mode, feedback_enabled, grading_instructions
            ''',
            exam_id,
            user.user_id,
            settings["gradingMode"],
            settings["feedbackEnabled"],
            settings["customInstructions"] or None,
            now
        )

        if not row:
            await conn.close()
            raise HTTPException(status_code=404, detail="Exam not found")

        flow_row = await conn.fetchrow(
            '''
            SELECT id, state_json
            FROM upload_flow_sessions
            WHERE exam_id = $1 AND teacher_id = $2
            ORDER BY created_at DESC
            LIMIT 1
            ''',
            exam_id,
            user.user_id
        )
        if flow_row:
            await conn.execute(
                '''
                UPDATE upload_flow_sessions
                SET state_json = $2, updated_at = $3
                WHERE id = $1
                ''',
                flow_row["id"],
                merge_difficulty_into_state_json(flow_row["state_json"], settings["difficulty"]),
                now
            )

        await conn.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating exam settings in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to update exam settings")

    return {"data": settings}


@api_router.post("/v1/exams/{exam_id}/flag-grading")
async def flag_exam_grading(exam_id: str, data: dict, authorization: Optional[str] = Header(None)):
    """Create a synced Improve AI / grading-quality flag for the webapp."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    settings = normalize_review_settings(data)
    reason = data.get("reason")
    now = utc_now_text()
    feedback_id = generate_drizzle_id("pfb_")

    try:
        conn = await asyncpg.connect(webapp_db_url)
        exam_exists = await conn.fetchval(
            '''
            SELECT EXISTS (
                SELECT 1 FROM exams WHERE id = $1 AND teacher_id = $2
            )
            ''',
            exam_id,
            user.user_id
        )
        if not exam_exists:
            await conn.close()
            raise HTTPException(status_code=404, detail="Exam not found")

        payload_json = build_grading_flag_payload(exam_id, settings, reason)
        metadata_json = '{"source":"mobile_scanner"}'
        await conn.execute(
            '''
            INSERT INTO product_feedback (
                id, user_id, type, status, data_json, metadata_json,
                resolved_by_user_id, resolved_at, admin_notes, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, $7, $8)
            ''',
            feedback_id,
            user.user_id,
            "ai_grading_flag",
            "open",
            payload_json,
            metadata_json,
            now,
            now
        )
        await conn.execute(
            '''
            INSERT INTO audit_logs (
                id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ''',
            generate_drizzle_id("aud_"),
            user.user_id,
            "mobile_ai_grading_flag_created",
            "exam",
            exam_id,
            payload_json,
            now
        )
        await conn.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating grading flag in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to flag grading")

    return {"success": True, "id": feedback_id}


@api_router.get("/v1/ai-brain")
async def list_ai_brain_rules(authorization: Optional[str] = Header(None)):
    """List synced teacher AI Brain grading memories."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        rows = await conn.fetch(
            '''
            SELECT id, exam_id, question_number, original_ai_feedback,
                   teacher_correction, pattern_json, created_at, updated_at
            FROM teacher_feedback_patterns
            WHERE teacher_id = $1
            ORDER BY created_at DESC
            LIMIT 100
            ''',
            user.user_id,
        )
    except Exception as e:
        logger.error(f"Error reading AI Brain rules from Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to load AI Brain")
    finally:
        if conn:
            await conn.close()

    return {
        "data": [
            {
                "id": str(row["id"]),
                "examId": row["exam_id"],
                "questionNumber": row["question_number"],
                "originalAiFeedback": row["original_ai_feedback"],
                "teacherCorrection": row["teacher_correction"],
                "patternJson": row["pattern_json"],
                "scope": "global" if row["exam_id"] is None else "exam",
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]
    }


@api_router.post("/v1/ai-brain")
async def create_ai_brain_rule(data: dict, authorization: Optional[str] = Header(None)):
    """Create a global teacher grading memory from mobile."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    correction = str(data.get("teacherCorrection") or data.get("rule") or "").strip()
    if not correction:
        raise HTTPException(status_code=400, detail="AI Brain rule text is required")

    now = utc_now_text()
    rule_id = generate_drizzle_id("tfp_")
    pattern_json = json.dumps({
        "source": "mobile_scanner",
        "type": "global_grading_memory",
        "teacherCorrection": correction,
        "applyToFuture": True,
    })

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        await conn.execute(
            '''
            INSERT INTO teacher_feedback_patterns (
                id, teacher_id, exam_id, question_number,
                original_ai_feedback, teacher_correction, pattern_json,
                created_at, updated_at
            ) VALUES ($1, $2, NULL, NULL, NULL, $3, $4, $5, $6)
            ''',
            rule_id,
            user.user_id,
            correction,
            pattern_json,
            now,
            now,
        )
    except Exception as e:
        logger.error(f"Error creating AI Brain rule in Neon: {e}")
        raise HTTPException(status_code=500, detail="Failed to save AI Brain rule")
    finally:
        if conn:
            await conn.close()

    return {
        "data": {
            "id": rule_id,
            "scope": "global",
            "teacherCorrection": correction,
            "patternJson": pattern_json,
            "createdAt": now,
            "updatedAt": now,
        }
    }


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
                SELECT j.id, j.type, j.status, j.progress, j.processed_items, j.total_items, j.payload_json, j.updated_at
                FROM grading_jobs j
                WHERE j.exam_id = $1
                ORDER BY j.created_at DESC
                LIMIT 5
                ''',
                exam_id
            )
            await conn.close()
            jobs = build_grading_jobs([dict(r) for r in rows])
            if jobs:
                return {"data": jobs}
        except Exception as e:
            logger.error(f"Error querying Neon for exam jobs: {e}")

    # Fallback: check scan session status in MongoDB
    session = await db.scan_sessions.find_one({"exam_id": exam_id})
    session_job_type = session.get("grading_job_type") if session else None
    if session and session.get("grading_job_id") and session_job_type in (None, "bulk_grade", "grade_submissions"):
        return {
            "data": [{
                "id": session.get("grading_job_id"),
                "type": session_job_type or "grade_submissions",
                "status": session.get("grading_status") or "queued",
                "progress": float(session.get("grading_progress") or 0.0),
                "processedItems": int(session.get("grading_processed_items") or 0),
                "totalItems": int(session.get("grading_total_items") or len(session.get("students", [])))
            }]
        }
    return {"data": []}


@api_router.post("/v1/exams/{exam_id}/retry-grading")
async def retry_exam_grading_v1(
    exam_id: str,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(None),
):
    """Retry a failed mobile grading flow without requiring the teacher to rescan papers."""
    user = await get_current_user(authorization)
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    if not webapp_db_url:
        raise HTTPException(status_code=503, detail="WEBAPP_DB_URL is not configured")

    conn = None
    try:
        conn = await asyncpg.connect(webapp_db_url)
        submission_ids = await fetch_exam_submission_ids(conn, exam_id, user.user_id)
        if not submission_ids:
            raise HTTPException(status_code=409, detail="No student submissions are available for grading")

        if await exam_has_blueprint(conn, exam_id):
            grading_job_id = await insert_grade_submissions_job(
                conn,
                exam_id,
                user.user_id,
                submission_ids,
                generate_drizzle_id,
                utc_now_text,
                source="mobile_retry",
            )
            await update_scan_grading_state(
                db.scan_sessions,
                exam_id,
                user.user_id,
                status="grading",
                job_id=grading_job_id,
                job_type="grade_submissions",
                total_items=len(submission_ids),
                message=None,
            )
            return {
                "data": {
                    "status": "grading_queued",
                    "examId": exam_id,
                    "jobId": grading_job_id,
                    "totalItems": len(submission_ids),
                }
            }

        source_paper_mode = await resolve_source_paper_mode(conn, exam_id)
        blueprint_job_id = await insert_blueprint_extraction_job(
            conn,
            exam_id,
            user.user_id,
            source_paper_mode,
            generate_drizzle_id,
            utc_now_text,
        )
        await update_scan_grading_state(
            db.scan_sessions,
            exam_id,
            user.user_id,
            status="syncing",
            job_id=blueprint_job_id,
            job_type="blueprint_extraction",
            total_items=1,
            message="Rebuilding exam blueprint before grading.",
        )
        background_tasks.add_task(
            retry_grading_after_blueprint,
            webapp_db_url=webapp_db_url,
            scan_sessions=db.scan_sessions,
            logger=logger,
            id_factory=generate_drizzle_id,
            now_factory=utc_now_text,
            exam_id=exam_id,
            teacher_id=user.user_id,
            blueprint_job_id=blueprint_job_id,
            submission_ids=submission_ids,
        )
        return {
            "data": {
                "status": "blueprint_retry_queued",
                "examId": exam_id,
                "jobId": blueprint_job_id,
                "totalItems": len(submission_ids),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrying grading for exam {exam_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retry grading")
    finally:
        if conn:
            await conn.close()


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
    user = await get_current_user(authorization)
    webapp_url = os.environ.get("WEBAPP_URL")
    token = authorization.replace("Bearer ", "") if authorization and authorization.startswith("Bearer ") else authorization

    if token != "sess_mock_token_12345":
        webapp_db_url = os.environ.get("WEBAPP_DB_URL")
        if webapp_db_url:
            conn = None
            try:
                conn = await asyncpg.connect(webapp_db_url)
                exams = await fetch_batch_exams(conn, user.user_id, batch_id)
                return {"exams": exams}
            except Exception as e:
                logger.error(f"Error querying Neon for batch exams: {e}")
                raise HTTPException(status_code=503, detail="Batch exam sync is unavailable. Please retry.")
            finally:
                if conn:
                    await conn.close()
    
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


# ==================== STUDENT PORTAL WEBAPP PROXY ====================

@api_router.get("/v1/student/dashboard")
async def student_dashboard_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/analytics/student-dashboard", authorization, request=request)


@api_router.get("/v1/student/exams")
async def student_exams_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/exams", authorization, request=request)


@api_router.get("/v1/student/submissions")
async def student_submissions_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/submissions/mine", authorization, request=request)


@api_router.get("/v1/student/submissions/{submission_id}")
async def student_submission_detail_proxy(
    submission_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(f"/api/v1/submissions/{submission_id}", authorization, request=request)


@api_router.get("/v1/student/exams/{exam_id}/files")
async def student_exam_files_proxy(
    exam_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(f"/api/v1/exams/{exam_id}/files", authorization, request=request)


@api_router.get("/v1/student/re-evaluations")
async def student_re_evaluations_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/re-evaluations", authorization, request=request)


@api_router.post("/v1/student/re-evaluations")
async def create_student_re_evaluation_proxy(
    data: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(
        "/api/v1/re-evaluations",
        authorization,
        method="POST",
        request=request,
        json_body=data,
    )


# ==================== ADMIN PORTAL WEBAPP PROXY ====================

@api_router.get("/v1/admin/teachers")
async def admin_teachers_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/admin/users", authorization, request=request)


@api_router.patch("/v1/admin/teachers/{user_id}")
async def update_admin_teacher_proxy(
    user_id: str,
    data: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(
        f"/api/v1/admin/users/{user_id}",
        authorization,
        method="PATCH",
        request=request,
        json_body=data,
    )


@api_router.get("/v1/admin/teacher-invites")
async def admin_teacher_invites_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/admin/teacher-invites", authorization, request=request)


@api_router.post("/v1/admin/teacher-invites")
async def create_admin_teacher_invite_proxy(
    data: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(
        "/api/v1/admin/teacher-invites",
        authorization,
        method="POST",
        request=request,
        json_body=data,
    )


@api_router.delete("/v1/admin/teacher-invites/{invite_id}")
async def delete_admin_teacher_invite_proxy(
    invite_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(
        f"/api/v1/admin/teacher-invites/{invite_id}",
        authorization,
        method="DELETE",
        request=request,
    )


@api_router.get("/v1/admin/feedback")
async def admin_feedback_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/feedback", authorization, request=request)


@api_router.patch("/v1/admin/feedback/{feedback_id}/resolve")
async def resolve_admin_feedback_proxy(
    feedback_id: str,
    data: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    return await proxy_webapp_json(
        f"/api/v1/feedback/{feedback_id}/resolve",
        authorization,
        method="PATCH",
        request=request,
        json_body=data,
    )


@api_router.get("/v1/admin/audit-logs")
async def admin_audit_logs_proxy(request: Request, authorization: Optional[str] = Header(None)):
    return await proxy_webapp_json("/api/v1/admin/audit-logs", authorization, request=request)


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


@api_router.get("/v1/system/readiness")
async def system_readiness():
    """Return safe deployment readiness metadata without exposing secret values."""
    readiness = build_readiness_report(os.environ)
    missing_portal_routes = get_missing_portal_proxy_routes()
    readiness["checks"]["portalProxy"] = {
        "routesRegistered": not missing_portal_routes,
        "missingRoutes": missing_portal_routes,
    }
    if missing_portal_routes:
        readiness["status"] = "degraded"
    return {"data": readiness}


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
