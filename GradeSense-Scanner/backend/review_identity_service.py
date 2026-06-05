from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class ReviewStudentIdentity:
    student_name: str
    student_roll_number: str
    matched_student_id: Optional[str]


def normalize_review_student_identity(row: Mapping[str, Any], ordinal: int) -> ReviewStudentIdentity:
    """Return a display identity that avoids treating weak OCR names as roster truth."""
    student_id = _read_text(row.get("student_id"))
    roll_number = _read_text(row.get("student_roll_number"))
    roster_name = _read_text(row.get("roster_student_name"))
    roster_roll = _read_text(row.get("roster_student_roll_number"))
    raw_name = _read_text(row.get("student_name"))

    if roster_name or roster_roll:
        return ReviewStudentIdentity(
            student_name=roster_name or raw_name or _fallback_name(ordinal),
            student_roll_number=roster_roll or roll_number,
            matched_student_id=student_id,
        )

    if student_id or roll_number or _is_safe_generic_student_name(raw_name):
        return ReviewStudentIdentity(
            student_name=raw_name or _fallback_name(ordinal),
            student_roll_number=roll_number,
            matched_student_id=student_id,
        )

    return ReviewStudentIdentity(
        student_name=_fallback_name(ordinal),
        student_roll_number="",
        matched_student_id=None,
    )


def _read_text(value: Any) -> str:
    return str(value or "").strip()


def _fallback_name(ordinal: int) -> str:
    return f"Student #{max(ordinal, 1)}"


def _is_safe_generic_student_name(value: str) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return False
    return normalized.startswith("student #") or normalized.startswith("student_")
