from typing import Any, Iterable

from grading_lifecycle_service import is_review_ready_exam

VALID_EXAM_STATUSES = {"draft", "uploaded", "processing", "graded", "published", "closed", "archived"}


def percent(score: float | int | None, total: float | int | None) -> float:
    if not score or not total:
        return 0.0
    return round((float(score) / float(total)) * 100, 1)


def build_student_ranking(rows: Iterable[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    students = [
        {
            "studentName": row.get("student_name") or "Unknown",
            "rollNumber": row.get("student_roll_number") or "",
            "examName": row.get("exam_name") or "",
            "score": float(row.get("total_score") or 0),
            "totalMarks": float(row.get("total_marks") or 0),
            "percentage": percent(row.get("total_score"), row.get("total_marks")),
        }
        for row in rows
    ]
    return sorted(students, key=lambda item: item["percentage"], reverse=True)[:limit]


def build_weak_student_ranking(rows: Iterable[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    students = build_student_ranking(rows, limit=1000)
    return sorted(students, key=lambda item: item["percentage"])[:limit]


def build_question_stats(rows: Iterable[dict[str, Any]], limit: int = 12) -> list[dict[str, Any]]:
    questions = []
    for row in rows:
        average_score = float(row.get("average_score") or 0)
        max_marks = float(row.get("max_marks") or 0)
        questions.append({
            "questionNumber": str(row.get("question_number") or ""),
            "questionText": row.get("question_text") or "",
            "averageScore": round(average_score, 1),
            "maxMarks": max_marks,
            "averagePercentage": percent(average_score, max_marks),
            "attempts": int(row.get("attempts") or 0),
        })

    return sorted(questions, key=lambda item: item["averagePercentage"])[:limit]


def build_subject_performance(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    subjects = [
        {
            "subjectName": row.get("subject_name") or "Unassigned",
            "examsCount": int(row.get("exams_count") or 0),
            "averagePercentage": round(float(row.get("average_percentage") or 0), 1),
        }
        for row in rows
    ]
    return sorted(subjects, key=lambda item: item["subjectName"])


def as_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def build_managed_exams(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    exams = []
    for row in rows:
        exams.append({
            "id": str(row.get("id") or ""),
            "name": row.get("name") or "Untitled Exam",
            "batchId": str(row.get("batch_id")) if row.get("batch_id") else None,
            "batchName": row.get("batch_name") or "Unassigned class",
            "subjectId": str(row.get("subject_id")) if row.get("subject_id") else None,
            "subjectName": row.get("subject_name") or "Unassigned subject",
            "totalMarks": float(row.get("total_marks") or 0),
            "examDate": as_iso(row.get("exam_date")),
            "status": row.get("status") or "graded",
            "gradingMode": row.get("grading_mode"),
            "customInstructions": row.get("grading_instructions") or "",
            "feedbackEnabled": row.get("feedback_enabled"),
            "resultsPublished": bool(row.get("results_published")),
            "publishedAt": as_iso(row.get("published_at")),
            "submissionCount": int(row.get("submission_count") or 0),
            "gradedSubmissionCount": int(row.get("graded_submission_count") or 0),
            "reviewReady": is_review_ready_exam(row),
            "averagePercentage": round(float(row.get("average_percentage") or 0), 1),
        })
    return exams


def normalize_exam_update_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    if "name" in data:
        name = str(data.get("name") or "").strip()
        if name:
            payload["name"] = name

    if "examDate" in data or "exam_date" in data:
        raw_date = data.get("examDate", data.get("exam_date"))
        payload["exam_date"] = str(raw_date).strip() or None

    if "totalMarks" in data or "total_marks" in data:
        raw_total = data.get("totalMarks", data.get("total_marks"))
        try:
            total_marks = float(raw_total)
        except (TypeError, ValueError):
            total_marks = 0.0
        if total_marks > 0:
            payload["total_marks"] = total_marks

    if "status" in data:
        status = str(data.get("status") or "").strip().lower()
        if status in VALID_EXAM_STATUSES:
            payload["status"] = status

    return payload
