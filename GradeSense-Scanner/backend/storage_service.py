import os
import shutil
import json
from pathlib import Path
from typing import Mapping, Optional
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)


class StorageConfigurationError(RuntimeError):
    pass


def resolve_gcs_credentials(env: Mapping[str, str | None]) -> dict:
    credentials_json = env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if isinstance(credentials_json, str) and credentials_json.strip():
        return {"mode": "json", "value": json.loads(credentials_json)}

    credentials_path = env.get("GOOGLE_APPLICATION_CREDENTIALS")
    if isinstance(credentials_path, str) and credentials_path.strip():
        return {"mode": "path", "value": credentials_path.strip()}

    return {"mode": "default", "value": None}


class StorageService:
    """
    Abstraction layer for file storage.
    Supports local filesystem.
    """
    backend = "local"

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(exist_ok=True, parents=True)

    def get_session_dir(self, session_id: str) -> Path:
        session_dir = self.base_dir / session_id
        session_dir.mkdir(exist_ok=True, parents=True)
        return session_dir

    def save_file(self, session_id: str, filename: str, file_obj, content_type: str = "image/jpeg") -> str:
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
    backend = "gcs"

    def __init__(self, bucket_name: str):
        try:
            from google.cloud import storage
            credentials_config = resolve_gcs_credentials(os.environ)

            if credentials_config["mode"] == "json":
                from google.oauth2 import service_account

                credentials = service_account.Credentials.from_service_account_info(credentials_config["value"])
                self.client = storage.Client(
                    credentials=credentials,
                    project=credentials.project_id,
                )
            elif credentials_config["mode"] == "path":
                self.client = storage.Client.from_service_account_json(credentials_config["value"])
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

    def save_file(self, session_id: str, filename: str, file_obj, content_type: str = "image/jpeg") -> str:
        """Saves a file to GCS and returns the api endpoint URL identifier"""
        blob_path = f"{session_id}/{filename}"
        blob = self.bucket.blob(blob_path)
        
        # Seek file to start to be safe
        try:
            file_obj.seek(0)
        except Exception:
            pass
            
        blob.upload_from_file(file_obj, content_type=content_type)
        logger.info(f"Saved file to GCS: gs://{self.bucket_name}/{blob_path}")

        # Cache locally for fast background compilation
        try:
            import tempfile
            cache_dir = Path(tempfile.gettempdir()) / "gradesense_cache" / session_id
            cache_dir.mkdir(exist_ok=True, parents=True)
            cache_file = cache_dir / filename
            try:
                file_obj.seek(0)
            except Exception:
                pass
            with cache_file.open("wb") as f:
                shutil.copyfileobj(file_obj, f)
            logger.info(f"Cached uploaded file locally: {cache_file}")
        except Exception as cache_err:
            logger.warning(f"Failed to cache uploaded file locally: {cache_err}")

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
            raise StorageConfigurationError("STORAGE_PROVIDER=gcs requires GCS_BUCKET_NAME")
        
        return GcsStorageService(bucket_name)
    else:
        return StorageService(uploads_dir)
