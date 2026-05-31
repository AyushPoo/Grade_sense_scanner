from typing import Mapping


REQUIRED_ENV_VARS = ("MONGO_URL", "DB_NAME", "WEBAPP_DB_URL", "WEBAPP_JWT_SECRET")
OPTIONAL_ENV_VARS = ("WEBAPP_URL", "GCS_BUCKET_NAME", "GOOGLE_APPLICATION_CREDENTIALS")


def has_value(env: Mapping[str, str | None], key: str) -> bool:
    value = env.get(key)
    return isinstance(value, str) and bool(value.strip())


def build_readiness_report(env: Mapping[str, str | None]) -> dict:
    missing_required = [key for key in REQUIRED_ENV_VARS if not has_value(env, key)]
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
                "configured": has_value(env, "WEBAPP_DB_URL") and has_value(env, "WEBAPP_JWT_SECRET"),
            },
            "fileStorage": {
                "configured": has_value(env, "GCS_BUCKET_NAME") or has_value(env, "GOOGLE_APPLICATION_CREDENTIALS"),
            },
            "webappProxy": {
                "configured": has_value(env, "WEBAPP_URL"),
            },
        },
    }
