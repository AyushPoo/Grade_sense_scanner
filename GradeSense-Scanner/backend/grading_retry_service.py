import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import asyncpg
from fastapi import HTTPException

from grading_lifecycle_service import is_successful_blueprint_job


IdFactory = Callable[[str], str]
NowFactory = Callable[[], str]


async def fetch_exam_submission_ids(conn: asyncpg.Connection, exam_id: str, teacher_id: str) -> list[str]:
    rows = await conn.fetch(
        '''
        SELECT s.id
        FROM submissions s
        JOIN exams e ON e.id = s.exam_id
        WHERE s.exam_id = $1
          AND e.teacher_id = $2
          AND COALESCE(e.status, '') <> 'deleted'
        ORDER BY s.created_at ASC
        ''',
        exam_id,
        teacher_id,
    )
    return [str(row["id"]) for row in rows]


async def exam_has_blueprint(conn: asyncpg.Connection, exam_id: str) -> bool:
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM question_items WHERE exam_id = $1",
        exam_id,
    )
    return int(count or 0) > 0


async def resolve_source_paper_mode(conn: asyncpg.Connection, exam_id: str) -> str:
    rows = await conn.fetch(
        '''
        SELECT kind, COUNT(*) AS file_count
        FROM exam_files
        WHERE exam_id = $1
          AND kind IN ('question_paper', 'model_answer')
        GROUP BY kind
        ''',
        exam_id,
    )
    counts = {row["kind"]: int(row["file_count"] or 0) for row in rows}
    if counts.get("model_answer", 0) <= 0:
        raise HTTPException(status_code=409, detail="Model answer file is required before grading can run")
    return "combined_model_answer" if counts.get("question_paper", 0) <= 0 else "separate"


async def insert_blueprint_extraction_job(
    conn: asyncpg.Connection,
    exam_id: str,
    teacher_id: str,
    source_paper_mode: str,
    id_factory: IdFactory,
    now_factory: NowFactory,
) -> str:
    job_id = id_factory("job_")
    now = now_factory()
    await conn.execute(
        '''
        INSERT INTO grading_jobs (
            id, type, status, exam_id, teacher_id,
            progress, total_items, processed_items, success_count, failure_count,
            attempts, payload_json, result_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ''',
        job_id,
        "blueprint_extraction",
        "queued",
        exam_id,
        teacher_id,
        0.0,
        1,
        0,
        0,
        0,
        0,
        json.dumps({"teacherId": teacher_id, "sourceMode": source_paper_mode, "source": "mobile_retry"}),
        "{}",
        now,
        now,
    )
    return job_id


async def insert_grade_submissions_job(
    conn: asyncpg.Connection,
    exam_id: str,
    teacher_id: str,
    submission_ids: list[str],
    id_factory: IdFactory,
    now_factory: NowFactory,
    source: str = "mobile_scanner",
) -> str:
    if not submission_ids:
        raise HTTPException(status_code=409, detail="No student submissions are available for grading")

    job_id = id_factory("job_")
    now = now_factory()
    await conn.execute(
        '''
        INSERT INTO grading_jobs (
            id, type, status, exam_id, teacher_id,
            progress, total_items, processed_items, success_count, failure_count,
            attempts, payload_json, result_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ''',
        job_id,
        "grade_submissions",
        "queued",
        exam_id,
        teacher_id,
        0.0,
        len(submission_ids),
        0,
        0,
        0,
        0,
        json.dumps({
            "submissionIds": submission_ids,
            "teacherId": teacher_id,
            "flow": "batch_grading",
            "source": source,
            "queueFirstOnly": False,
        }),
        "{}",
        now,
        now,
    )
    return job_id


async def update_scan_grading_state(
    scan_sessions: Any,
    exam_id: str,
    user_id: str,
    *,
    status: str,
    job_id: Optional[str] = None,
    job_type: str = "grade_submissions",
    total_items: int = 0,
    message: Optional[str] = None,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "updated_at": datetime.now(timezone.utc),
    }
    if message is not None:
        payload["last_sync_error"] = message[:500]
    elif status == "grading":
        payload["last_sync_error"] = None
    if job_id:
        payload.update({
            "grading_job_id": job_id,
            "grading_job_type": job_type,
            "grading_status": "queued",
            "grading_progress": 0.0,
            "grading_processed_items": 0,
            "grading_total_items": total_items,
        })
    await scan_sessions.update_one(
        {"exam_id": exam_id, "user_id": user_id},
        {"$set": payload},
    )


async def retry_grading_after_blueprint(
    *,
    webapp_db_url: str,
    scan_sessions: Any,
    logger: Any,
    id_factory: IdFactory,
    now_factory: NowFactory,
    exam_id: str,
    teacher_id: str,
    blueprint_job_id: str,
    submission_ids: list[str],
) -> None:
    poll_start = datetime.utcnow()
    while (datetime.utcnow() - poll_start).total_seconds() < 300:
        await asyncio.sleep(3.0)
        conn = None
        try:
            conn = await asyncpg.connect(webapp_db_url)
            row = await conn.fetchrow(
                "SELECT status, error, success_count, processed_items FROM grading_jobs WHERE id = $1",
                blueprint_job_id,
            )
            if not row:
                continue

            row_dict = dict(row)
            if is_successful_blueprint_job(row_dict):
                grading_job_id = await insert_grade_submissions_job(
                    conn,
                    exam_id,
                    teacher_id,
                    submission_ids,
                    id_factory,
                    now_factory,
                    source="mobile_retry_after_blueprint",
                )
                await update_scan_grading_state(
                    scan_sessions,
                    exam_id,
                    teacher_id,
                    status="grading",
                    job_id=grading_job_id,
                    job_type="grade_submissions",
                    total_items=len(submission_ids),
                    message=None,
                )
                return

            if row_dict.get("status") == "failed":
                await update_scan_grading_state(
                    scan_sessions,
                    exam_id,
                    teacher_id,
                    status="sync_failed",
                    message=f"Blueprint retry failed: {row_dict.get('error') or 'unknown error'}",
                )
                return

            if row_dict.get("status") == "completed":
                await update_scan_grading_state(
                    scan_sessions,
                    exam_id,
                    teacher_id,
                    status="sync_failed",
                    message="Blueprint retry completed without producing a usable exam blueprint.",
                )
                return
        except Exception as exc:
            logger.error(f"Error while retrying grading after blueprint for exam {exam_id}: {exc}")
        finally:
            if conn:
                await conn.close()

    await update_scan_grading_state(
        scan_sessions,
        exam_id,
        teacher_id,
        status="sync_failed",
        message="Blueprint retry timed out before grading could start.",
    )
