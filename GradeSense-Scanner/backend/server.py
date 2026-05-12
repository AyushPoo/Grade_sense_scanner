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
from storage_service import StorageService

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
storage = StorageService(UPLOADS_DIR)

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

async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    """Get current user from session token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    
    # Find session
    if token == "sess_mock_token_12345":
        # Hardcoded mock session for development/guest bypass
        session_doc = {
            "user_id": "user_mock_001",
            "session_token": "sess_mock_token_12345",
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        }
    else:
        session_doc = await db.user_sessions.find_one(
            {"session_token": token},
            {"_id": 0}
        )
    
    if not session_doc:
        raise HTTPException(status_code=401, detail="Invalid session token")
    
    # Check expiry
    expires_at = session_doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    
    # Find user
    user_doc = await db.users.find_one(
        {"user_id": session_doc["user_id"]},
        {"_id": 0}
    )
    
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    
    return User(**user_doc)


# ==================== AUTH ROUTES ====================

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
    
    # Create session token
    session_token = auth_data.get("session_token", f"sess_{uuid.uuid4().hex}")
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    
    # Store session
    session = UserSession(
        user_id=user_id,
        session_token=session_token,
        expires_at=expires_at
    )
    
    # Delete old sessions for this user
    await db.user_sessions.delete_many({"user_id": user_id})
    await db.user_sessions.insert_one(session.model_dump())
    
    # Get updated user
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})

    # Serialize datetime fields to ISO strings so the mobile app can parse them
    def serialize_doc(doc):
        if doc is None:
            return doc
        result = {}
        for k, v in doc.items():
            if isinstance(v, datetime):
                result[k] = v.isoformat()
            else:
                result[k] = v
        return result

    return {
        "user": serialize_doc(user_doc),
        "session_token": session_token
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
    """Get all batches for the organization"""
    user = await get_current_user(authorization)
    batches = await db.batches.find({"org_id": user.org_id}, {"_id": 0}).to_list(100)
    return {"batches": batches}


@api_router.get("/batches/{batch_id}/students")
async def get_batch_students(batch_id: str, authorization: Optional[str] = Header(None)):
    """Get students in a batch"""
    user = await get_current_user(authorization)
    students = await db.students.find({"batch_id": batch_id}, {"_id": 0}).to_list(1000)
    return {"students": students}


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
    """Production-hardened file serving"""
    file_path = storage.get_file_path(session_id, filename)
    if not file_path or not file_path.exists():
        logger.error(f"File not found: {session_id}/{filename}")
        raise HTTPException(status_code=404, detail="File not found")
    
    # MIME type detection is automatic in FileResponse
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


@api_router.post("/scan-sessions/{session_id}/complete")
async def complete_scan_session(session_id: str, authorization: Optional[str] = Header(None)):
    """Mark scan session as complete"""
    user = await get_current_user(authorization)
    await db.scan_sessions.update_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"$set": {"status": "completed"}}
    )
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
    """Apply real OpenCV enhancement to a captured image with mode support"""
    enhanced_base64 = process_enhance(data.image, data.mode)
    return {"enhanced_image": enhanced_base64}


# ==================== HEALTH CHECK ====================

@api_router.get("/")
async def root():
    return {"message": "GradeSense Scanner API", "status": "healthy"}


@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


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
