import json
from datetime import datetime
from typing import Any, Optional


VALID_GRADING_MODES = {"balanced", "strict", "lenient", "conceptual"}
VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def utc_now_text() -> str:
    return datetime.utcnow().isoformat() + "Z"


def normalize_review_settings(data: Optional[dict[str, Any]]) -> dict[str, Any]:
    data = data or {}
    grading_mode = data.get("gradingMode") or data.get("grading_mode") or "balanced"
    difficulty = data.get("difficulty") or "medium"

    return {
        "gradingMode": grading_mode if grading_mode in VALID_GRADING_MODES else "balanced",
        "feedbackEnabled": bool(data.get("feedbackEnabled", data.get("feedback_enabled", True))),
        "difficulty": difficulty if difficulty in VALID_DIFFICULTIES else "medium",
        "customInstructions": data.get("customInstructions") or data.get("grading_instructions") or "",
    }


def merge_difficulty_into_state_json(state_json: Optional[str], difficulty: str) -> str:
    try:
        state = json.loads(state_json or "{}")
        if not isinstance(state, dict):
            state = {}
    except json.JSONDecodeError:
        state = {}

    state["difficulty"] = difficulty
    return json.dumps(state, separators=(",", ":"))


def difficulty_from_state_json(state_json: Optional[str]) -> str:
    try:
        state = json.loads(state_json or "{}")
    except json.JSONDecodeError:
        return "medium"

    difficulty = state.get("difficulty") if isinstance(state, dict) else None
    return difficulty if difficulty in VALID_DIFFICULTIES else "medium"


def build_grading_flag_payload(exam_id: str, settings: dict[str, Any], reason: Optional[str]) -> str:
    return json.dumps(
        {
            "source": "mobile_scanner",
            "examId": exam_id,
            "reason": reason or "Teacher flagged AI grading from mobile review.",
            "settings": normalize_review_settings(settings),
        },
        separators=(",", ":"),
    )
