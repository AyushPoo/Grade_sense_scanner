from typing import Any, Iterable


DELETE_UPLOAD_FLOWS_FOR_EXAMS_SQL = '''
DELETE FROM upload_flow_sessions
WHERE teacher_id = $1
  AND exam_id = ANY($2::text[])
'''

DELETE_STALE_UPLOAD_FLOWS_FOR_TEACHER_SQL = '''
DELETE FROM upload_flow_sessions u
WHERE u.teacher_id = $1
  AND (
    (
      u.exam_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM exams e
        WHERE e.id = u.exam_id
          AND COALESCE(e.status, '') <> 'deleted'
      )
    )
    OR (
      u.exam_id IS NULL
      AND u.status IN ('completed', 'failed')
    )
  )
'''


def normalize_exam_ids(exam_ids: Iterable[Any]) -> list[str]:
    return sorted({str(exam_id) for exam_id in exam_ids if exam_id})


def parse_asyncpg_execute_count(result: str | None) -> int:
    if not result:
        return 0
    parts = result.split()
    if len(parts) < 2:
        return 0
    try:
        return int(parts[-1])
    except ValueError:
        return 0


async def delete_upload_flows_for_exams(conn: Any, teacher_id: str, exam_ids: Iterable[Any]) -> int:
    normalized_ids = normalize_exam_ids(exam_ids)
    if not normalized_ids:
        return 0

    result = await conn.execute(
        DELETE_UPLOAD_FLOWS_FOR_EXAMS_SQL,
        teacher_id,
        normalized_ids,
    )
    return parse_asyncpg_execute_count(result)


async def delete_stale_upload_flows_for_teacher(conn: Any, teacher_id: str) -> int:
    result = await conn.execute(
        DELETE_STALE_UPLOAD_FLOWS_FOR_TEACHER_SQL,
        teacher_id,
    )
    return parse_asyncpg_execute_count(result)
