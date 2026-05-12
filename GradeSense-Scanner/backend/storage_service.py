import os
import shutil
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class StorageService:
    """
    Abstraction layer for file storage.
    Currently supports local filesystem.
    Can be extended to S3, Cloudinary, GridFS, etc.
    """
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(exist_ok=True, parents=True)

    def get_session_dir(self, session_id: str) -> Path:
        session_dir = self.base_dir / session_id
        session_dir.mkdir(exist_ok=True, parents=True)
        return session_dir

    def save_file(self, session_id: str, filename: str, file_obj) -> str:
        """Saves a file and returns the local path/URL identifier"""
        session_dir = self.get_session_dir(session_id)
        file_path = session_dir / filename
        
        # Ensure directory exists (redundant but safe)
        session_dir.mkdir(exist_ok=True, parents=True)
        
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file_obj, buffer)
            
        logger.info(f"Saved file: {file_path}")
        return f"/api/files/{session_id}/{filename}"

    def get_file_path(self, session_id: str, filename: str) -> Optional[Path]:
        file_path = self.base_dir / session_id / filename
        if file_path.exists():
            return file_path
        return None

    def delete_session(self, session_id: str):
        session_dir = self.base_dir / session_id
        if session_dir.exists():
            shutil.rmtree(session_dir)
            logger.info(f"Deleted session directory: {session_dir}")

    def list_files(self, session_id: str) -> list[str]:
        session_dir = self.base_dir / session_id
        if not session_dir.exists():
            return []
        return [f.name for f in session_dir.iterdir() if f.is_file()]
