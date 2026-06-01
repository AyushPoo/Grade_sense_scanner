from typing import Any, Iterable


GRADING_JOB_TYPES = {"bulk_grade", "grade_submissions"}
ACTIVE_JOB_STATUSES = {"queued", "processing", "running", "in_progress"}
COMPLETED_JOB_STATUS = "completed"
FAILED_JOB_STATUS = "failed"


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
