import os
import shutil
from pathlib import Path
from typing import Optional
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

class StorageService:
    """
    Abstraction layer for file storage.
    Supports local filesystem.
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
            
        logger.info(f"Saved local file: {file_path}")
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
            logger.info(f"Deleted local session directory: {session_dir}")

    def list_files(self, session_id: str) -> list[str]:
        session_dir = self.base_dir / session_id
        if not session_dir.exists():
            return []
        return [f.name for f in session_dir.iterdir() if f.is_file()]


class GcsStorageService:
    """
    Cloud file storage using Google Cloud Storage.
    """
    def __init__(self, bucket_name: str, credentials_path: Optional[str] = None):
        try:
            from google.cloud import storage
            if credentials_path:
                self.client = storage.Client.from_service_account_json(credentials_path)
            else:
                self.client = storage.Client()
            self.bucket_name = bucket_name
            self.bucket = self.client.bucket(self.bucket_name)
            logger.info(f"Initialized GcsStorageService with bucket: {self.bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize GcsStorageService: {e}")
            raise

    def get_session_dir(self, session_id: str) -> str:
        return f"{session_id}/"

    def save_file(self, session_id: str, filename: str, file_obj) -> str:
        """Saves a file to GCS and returns the api endpoint URL identifier"""
        blob_path = f"{session_id}/{filename}"
        blob = self.bucket.blob(blob_path)
        
        # Seek file to start to be safe
        try:
            file_obj.seek(0)
        except Exception:
            pass
            
        blob.upload_from_file(file_obj, content_type="image/jpeg")
        logger.info(f"Saved file to GCS: gs://{self.bucket_name}/{blob_path}")
        return f"/api/files/{session_id}/{filename}"

    def get_file_path(self, session_id: str, filename: str) -> Optional[Path]:
        # For compatibility with local path, returns None since GCS has no local path
        return None

    def get_signed_url(self, session_id: str, filename: str, expiration_minutes: int = 60) -> Optional[str]:
        """Generates a signed read URL for a file in GCS"""
        try:
            blob_path = f"{session_id}/{filename}"
            blob = self.bucket.blob(blob_path)
            # Check if blob exists
            if not blob.exists():
                logger.warning(f"GCS blob does not exist: {blob_path}")
                return None
            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=expiration_minutes),
                method="GET"
            )
            return url
        except Exception as e:
            logger.error(f"Error generating signed URL: {e}")
            return None

    def delete_session(self, session_id: str):
        """Deletes all files in a session directory prefix on GCS"""
        try:
            prefix = f"{session_id}/"
            blobs = self.bucket.list_blobs(prefix=prefix)
            deleted_count = 0
            for blob in blobs:
                blob.delete()
                deleted_count += 1
            logger.info(f"Deleted {deleted_count} blobs for session {session_id} on GCS")
        except Exception as e:
            logger.error(f"Error deleting session blobs on GCS: {e}")

    def list_files(self, session_id: str) -> list[str]:
        """Lists files in a session directory prefix on GCS"""
        try:
            prefix = f"{session_id}/"
            blobs = self.bucket.list_blobs(prefix=prefix)
            # Return list of file names (without the prefix folder name)
            return [blob.name.split('/')[-1] for blob in blobs if blob.name != prefix and '/' in blob.name]
        except Exception as e:
            logger.error(f"Error listing files on GCS: {e}")
            return []


def get_storage_service(uploads_dir: Path):
    """
    Factory function to return the correct StorageService based on configuration.
    """
    provider = os.environ.get("STORAGE_PROVIDER", "local").lower()
    if provider == "gcs":
        bucket_name = os.environ.get("GCS_BUCKET_NAME")
        if not bucket_name:
            logger.warning("STORAGE_PROVIDER is set to GCS, but GCS_BUCKET_NAME is not set. Falling back to local storage.")
            return StorageService(uploads_dir)
        
        credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        try:
            return GcsStorageService(bucket_name, credentials_path)
        except Exception as e:
            logger.error(f"Failed to create GcsStorageService: {e}. Falling back to local storage.")
            return StorageService(uploads_dir)
    else:
        return StorageService(uploads_dir)
