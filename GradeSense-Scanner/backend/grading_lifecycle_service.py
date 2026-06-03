from datetime import datetime, timezone
from typing import Any, Iterable


GRADING_JOB_TYPES = {"bulk_grade", "grade_submissions"}
ACTIVE_JOB_STATUSES = {"queued", "processing", "running", "in_progress"}
COMPLETED_JOB_STATUS = "completed"
FAILED_JOB_STATUS = "failed"
SYNCING_SESSION_STATUSES = {"syncing", "grading", "uploaded"}
DELETED_EXAM_STATUS = "deleted"


def normalize_job(row: dict[str, Any]) -> dict[str, Any]:
    total_items = int(row.get("total_items") or row.get("totalItems") or 0)
    processed_items = int(row.get("processed_items") or row.get("processedItems") or 0)
    progress = row.get("progress")
    if progress is None and total_items > 0:
        progress = processed_items / total_items

    return {
        "id": str(row.get("id") or ""),
        "type": row.get("type") or "grade_submissions",
        "status": row.get("status") or "queued",
        "progress": float(progress or 0.0),
        "processedItems": processed_items,
        "totalItems": total_items,
        "error": row.get("error"),
        "createdAt": row.get("created_at") or row.get("createdAt"),
    }


def build_grading_jobs(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs = [
        normalize_job(row)
        for row in rows
        if row.get("type") in GRADING_JOB_TYPES and int(row.get("total_items") or row.get("totalItems") or 0) > 0
    ]
    return sorted(jobs, key=_job_sort_key)


def select_primary_grading_job(rows: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    jobs = build_grading_jobs(rows)
    if not jobs:
        return None

    active_job = next((job for job in jobs if job["status"] in ACTIVE_JOB_STATUSES), None)
    if active_job:
        return active_job

    return jobs[0]


def is_review_ready_exam(row: dict[str, Any]) -> bool:
    submission_count = int(row.get("submission_count") or 0)
    graded_count = int(row.get("graded_submission_count") or 0)
    status = str(row.get("status") or "").lower()

    if submission_count <= 0:
        return False
    if status in {"published", "closed"}:
        return True
    return graded_count >= submission_count


def is_successful_blueprint_job(row: dict[str, Any] | None) -> bool:
    if not row or row.get("status") != COMPLETED_JOB_STATUS:
        return False
    return int(row.get("success_count") or 0) > 0 or int(row.get("processed_items") or 0) > 0


def count_student_answer_pages(session: dict[str, Any] | None) -> int:
    if not session:
        return 0
    return sum(
        len(student.get("pages") or [])
        for student in session.get("students") or []
    )


def count_students_with_answer_pages(session: dict[str, Any] | None) -> int:
    if not session:
        return 0
    return sum(
        1
        for student in session.get("students") or []
        if len(student.get("pages") or []) > 0
    )


def validate_scan_session_ready_for_sync(session: dict[str, Any] | None) -> list[str]:
    if not session:
        return ["Scan session was not found."]

    errors = []
    model_pages = len((session.get("model_answer") or {}).get("pages") or [])
    question_pages = len((session.get("question_paper") or {}).get("pages") or [])
    student_count = count_students_with_answer_pages(session)

    if model_pages <= 0:
        errors.append("Upload the model answer paper before starting grading.")
    if model_pages <= 0 and question_pages <= 0:
        errors.append("Upload the question paper or combined question/model answer paper before starting grading.")
    if student_count <= 0:
        errors.append("Scan at least one student answer paper before starting grading.")

    return errors


def derive_scan_session_reconciliation(
    session: dict[str, Any],
    job_rows: Iterable[dict[str, Any]],
    submission_count: int,
    *,
    now: datetime | None = None,
    stale_after_seconds: int = 600,
) -> dict[str, Any] | None:
    status = str(session.get("status") or "")
    if status not in SYNCING_SESSION_STATUSES:
        return None

    rows = list(job_rows)
    grading_job = select_primary_grading_job(rows)
    blueprint_rows = [row for row in rows if row.get("type") == "blueprint_extraction"]
    latest_blueprint = blueprint_rows[0] if blueprint_rows else None

    if grading_job:
        if grading_job["status"] == FAILED_JOB_STATUS:
            return _sync_failure_payload(
                grading_job.get("error") or "AI grading failed before any papers were completed.",
                grading_job=grading_job,
            )
        if (
            grading_job["status"] == COMPLETED_JOB_STATUS
            and grading_job["totalItems"] > 0
            and grading_job["processedItems"] >= grading_job["totalItems"]
        ):
            return {
                "status": "graded",
                "grading_job_id": grading_job["id"],
                "grading_job_type": grading_job["type"],
                "grading_status": "completed",
                "grading_progress": 100.0,
                "grading_processed_items": grading_job["processedItems"],
                "grading_total_items": grading_job["totalItems"],
                "last_sync_error": None,
            }
        if grading_job["status"] == COMPLETED_JOB_STATUS:
            return _sync_failure_payload(
                "AI grading completed without processing all submitted papers.",
                grading_job=grading_job,
            )
        if (
            grading_job["status"] in ACTIVE_JOB_STATUSES
            and grading_job["processedItems"] <= 0
            and _timestamp_age_seconds(grading_job.get("createdAt"), now or datetime.now(timezone.utc)) >= stale_after_seconds
        ):
            return _sync_failure_payload(
                "AI grading did not start within the expected time. Please retry grading.",
                grading_job=grading_job,
            )
        return {
            "status": "grading",
            "grading_job_id": grading_job["id"],
            "grading_job_type": grading_job["type"],
            "grading_status": grading_job["status"],
            "grading_progress": grading_job["progress"],
            "grading_processed_items": grading_job["processedItems"],
            "grading_total_items": grading_job["totalItems"],
            "last_sync_error": None,
        }

    if latest_blueprint:
        blueprint_status = str(latest_blueprint.get("status") or "")
        if blueprint_status == FAILED_JOB_STATUS:
            return _sync_failure_payload(
                latest_blueprint.get("error") or "Question extraction failed before grading could start.",
                job_type="blueprint_extraction",
                job_id=latest_blueprint.get("id"),
            )
        if blueprint_status == COMPLETED_JOB_STATUS and not is_successful_blueprint_job(latest_blueprint):
            return _sync_failure_payload(
                "Question extraction completed without producing a usable exam blueprint.",
                job_type="blueprint_extraction",
                job_id=latest_blueprint.get("id"),
            )

    if submission_count <= 0 and _session_age_seconds(session, now or datetime.now(timezone.utc)) >= stale_after_seconds:
        return _sync_failure_payload("No student answer submissions were saved for this exam.")

    return None


def student_answer_text_select_expression(columns: Iterable[str]) -> str:
    available_columns = {str(column) for column in columns}
    candidates = [
        "student_answer_text",
        "extracted_answer_text",
        "answer_text",
    ]
    selected = [f"sc.{column}" for column in candidates if column in available_columns]
    if not selected:
        return "NULL"
    return f"COALESCE({', '.join(selected)})"


def deleted_or_missing_webapp_exam_ids(
    requested_exam_ids: Iterable[str],
    exam_rows: Iterable[dict[str, Any]],
) -> set[str]:
    requested = {str(exam_id) for exam_id in requested_exam_ids if exam_id}
    rows_by_id = {
        str(row.get("id")): str(row.get("status") or "").lower()
        for row in exam_rows
        if row.get("id")
    }

    return {
        exam_id
        for exam_id in requested
        if exam_id not in rows_by_id or rows_by_id[exam_id] == DELETED_EXAM_STATUS
    }


def _job_sort_key(job: dict[str, Any]) -> tuple[int, str]:
    status = str(job.get("status") or "")
    if status in ACTIVE_JOB_STATUSES:
        priority = 0
    elif status == COMPLETED_JOB_STATUS:
        priority = 1
    elif status == FAILED_JOB_STATUS:
        priority = 2
    else:
        priority = 3
    return (priority, str(job.get("id") or ""))


def _sync_failure_payload(
    message: str,
    *,
    grading_job: dict[str, Any] | None = None,
    job_type: str = "grade_submissions",
    job_id: Any = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "sync_failed",
        "last_sync_error": message[:500],
    }
    source_job = grading_job or {}
    resolved_job_id = source_job.get("id") or job_id
    if resolved_job_id:
        payload.update({
            "grading_job_id": str(resolved_job_id),
            "grading_job_type": source_job.get("type") or job_type,
            "grading_status": source_job.get("status") or FAILED_JOB_STATUS,
            "grading_progress": float(source_job.get("progress") or 0.0),
            "grading_processed_items": int(source_job.get("processedItems") or 0),
            "grading_total_items": int(source_job.get("totalItems") or 0),
        })
    return payload


def _session_age_seconds(session: dict[str, Any], now: datetime) -> float:
    return _timestamp_age_seconds(session.get("updated_at") or session.get("created_at"), now)


def _timestamp_age_seconds(value: Any, now: datetime) -> float:
    if not value:
        return 0
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return 0
    if not isinstance(value, datetime):
        return 0
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return max(0.0, (now - value).total_seconds())
