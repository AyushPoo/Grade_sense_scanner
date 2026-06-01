from typing import Mapping


REQUIRED_ENV_VARS = ("MONGO_URL", "DB_NAME", "WEBAPP_DB_URL", "WEBAPP_JWT_SECRET")
OPTIONAL_ENV_VARS = ("WEBAPP_URL",)
GCS_CREDENTIAL_ENV_VARS = ("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS_JSON")


def has_value(env: Mapping[str, str | None], key: str) -> bool:
    value = env.get(key)
    return isinstance(value, str) and bool(value.strip())


def is_webapp_sync_configured(env: Mapping[str, str | None]) -> bool:
    return has_value(env, "WEBAPP_DB_URL") and has_value(env, "WEBAPP_JWT_SECRET")


def is_gcs_storage_configured(env: Mapping[str, str | None]) -> bool:
    return (
        env.get("STORAGE_PROVIDER", "").strip().lower() == "gcs"
        and has_value(env, "GCS_BUCKET_NAME")
        and any(has_value(env, key) for key in GCS_CREDENTIAL_ENV_VARS)
    )


def get_missing_required_env(env: Mapping[str, str | None]) -> list[str]:
    missing_required = [key for key in REQUIRED_ENV_VARS if not has_value(env, key)]

    if is_webapp_sync_configured(env) and not is_gcs_storage_configured(env):
        if env.get("STORAGE_PROVIDER", "").strip().lower() != "gcs":
            missing_required.append("STORAGE_PROVIDER=gcs")
        if not has_value(env, "GCS_BUCKET_NAME"):
            missing_required.append("GCS_BUCKET_NAME")
        if not any(has_value(env, key) for key in GCS_CREDENTIAL_ENV_VARS):
            missing_required.append("GOOGLE_APPLICATION_CREDENTIALS")

    return missing_required


def build_readiness_report(env: Mapping[str, str | None]) -> dict:
    missing_required = get_missing_required_env(env)
    missing_optional = [key for key in OPTIONAL_ENV_VARS if not has_value(env, key)]

    return {
        "status": "ready" if not missing_required else "degraded",
        "missingRequired": missing_required,
        "missingOptional": missing_optional,
        "checks": {
            "database": {
                "configured": has_value(env, "MONGO_URL") and has_value(env, "DB_NAME"),
            },
            "webappSync": {
                "configured": is_webapp_sync_configured(env),
            },
            "fileStorage": {
                "provider": env.get("STORAGE_PROVIDER", "local"),
                "configured": is_gcs_storage_configured(env),
            },
            "webappProxy": {
                "configured": has_value(env, "WEBAPP_URL"),
            },
        },
    }
