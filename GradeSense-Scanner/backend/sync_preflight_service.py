from typing import Mapping

from runtime_readiness_service import is_webapp_sync_configured, is_gcs_storage_configured


class SyncPreflightError(RuntimeError):
    pass


def assert_webapp_sync_ready(storage_backend: str, env: Mapping[str, str | None]) -> None:
    if not is_webapp_sync_configured(env):
        return

    if storage_backend != "gcs" or not is_gcs_storage_configured(env):
        raise SyncPreflightError(
            "Webapp grading sync requires GCS file storage. Set STORAGE_PROVIDER=gcs, "
            "GCS_BUCKET_NAME, and GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON."
        )
