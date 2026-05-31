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


def merge_pilot_review_first_into_state_json(state_json: Optional[str], enabled: bool) -> str:
    try:
        state = json.loads(state_json or "{}")
        if not isinstance(state, dict):
            state = {}
    except json.JSONDecodeError:
        state = {}

    state["pilotReviewFirst"] = bool(enabled)
    return json.dumps(state, separators=(",", ":"))


def difficulty_from_state_json(state_json: Optional[str]) -> str:
    try:
        state = json.loads(state_json or "{}")
    except json.JSONDecodeError:
        return "medium"

    difficulty = state.get("difficulty") if isinstance(state, dict) else None
    return difficulty if difficulty in VALID_DIFFICULTIES else "medium"


def pilot_review_first_from_state_json(state_json: Optional[str]) -> bool:
    try:
        state = json.loads(state_json or "{}")
    except json.JSONDecodeError:
        return False

    return bool(state.get("pilotReviewFirst")) if isinstance(state, dict) else False


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


def build_question_improvement_pattern_json(data: dict[str, Any]) -> str:
    correction = str(data.get("teacherCorrection") or data.get("teacher_correction") or "").strip()
    question_number = str(data.get("questionNumber") or data.get("question_number") or "").strip()

    return json.dumps(
        {
            "source": "mobile_scanner",
            "type": "question_grading_correction",
            "scoreId": data.get("scoreId") or data.get("score_id"),
            "questionId": data.get("questionId") or data.get("question_id"),
            "questionNumber": question_number,
            "questionText": data.get("questionText") or data.get("question_text") or "",
            "studentAnswerText": data.get("studentAnswerText") or data.get("student_answer_text") or "",
            "aiGrade": _number_or_zero(data.get("aiGrade", data.get("ai_grade"))),
            "expectedGrade": _number_or_zero(data.get("expectedGrade", data.get("expected_grade"))),
            "maxMarks": _number_or_zero(data.get("maxMarks", data.get("max_marks"))),
            "aiFeedback": data.get("aiFeedback") or data.get("ai_feedback") or "",
            "teacherCorrection": correction,
            "applyToFuture": bool(data.get("applyToFuture", data.get("apply_to_future", True))),
        },
        separators=(",", ":"),
    )


def _number_or_zero(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
