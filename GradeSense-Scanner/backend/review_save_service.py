from typing import Any, Iterable


class ReviewSaveServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def normalize_review_score_updates(raw_scores: Iterable[dict[str, Any]] | None) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    for raw_score in raw_scores or []:
        if not isinstance(raw_score, dict):
            continue

        score_id = raw_score.get("scoreId") or raw_score.get("score_id") or raw_score.get("id")
        if not score_id:
            continue

        updates.append({
            "score_id": str(score_id),
            "obtained_marks": _optional_number(raw_score.get("obtainedMarks", raw_score.get("obtained_marks"))),
            "has_teacher_correction": _has_any_key(raw_score, ("teacherCorrection", "teacher_correction")),
            "teacher_correction": _optional_text(raw_score, ("teacherCorrection", "teacher_correction")),
            "has_ai_feedback": _has_any_key(raw_score, ("aiFeedback", "ai_feedback")),
            "ai_feedback": _optional_text(raw_score, ("aiFeedback", "ai_feedback")),
        })
    return updates


async def save_submission_review_edits(
    conn: Any,
    *,
    teacher_id: str,
    submission_id: str,
    data: dict[str, Any],
    now_text: str,
) -> dict[str, Any]:
    score_updates = normalize_review_score_updates(data.get("scores"))
    has_teacher_feedback = _has_any_key(data, ("teacherFeedback", "teacher_feedback"))
    teacher_feedback = _optional_text(data, ("teacherFeedback", "teacher_feedback"))

    async with conn.transaction():
        owned_submission = await _fetch_owned_submission(conn, teacher_id, submission_id)
        if not owned_submission:
            raise ReviewSaveServiceError(404, "Submission not found")

        for update in score_updates:
            await _update_question_score(conn, submission_id, update)

        totals = await _refresh_submission_review_totals(
            conn,
            submission_id=submission_id,
            has_teacher_feedback=has_teacher_feedback,
            teacher_feedback=teacher_feedback,
            now_text=now_text,
        )

    return {
        "success": True,
        "message": "Review saved successfully",
        "submission": {
            "id": submission_id,
            **totals,
        },
    }


async def _fetch_owned_submission(conn: Any, teacher_id: str, submission_id: str):
    return await conn.fetchrow(
        '''
        SELECT s.id
        FROM submissions s
        JOIN exams e ON e.id = s.exam_id
        WHERE s.id = $1
          AND e.teacher_id = $2
          AND COALESCE(e.status, '') <> 'deleted'
        ''',
        submission_id,
        teacher_id,
    )


async def _update_question_score(conn: Any, submission_id: str, update: dict[str, Any]) -> None:
    await conn.execute(
        '''
        UPDATE question_scores
        SET obtained_marks = COALESCE($3, obtained_marks),
            teacher_correction = CASE WHEN $4 THEN $5 ELSE teacher_correction END,
            ai_feedback = CASE WHEN $6 THEN $7 ELSE ai_feedback END,
            is_reviewed = TRUE
        WHERE id = $1
          AND submission_id = $2
        ''',
        update["score_id"],
        submission_id,
        update["obtained_marks"],
        update["has_teacher_correction"],
        update["teacher_correction"],
        update["has_ai_feedback"],
        update["ai_feedback"],
    )


async def _refresh_submission_review_totals(
    conn: Any,
    *,
    submission_id: str,
    has_teacher_feedback: bool,
    teacher_feedback: str | None,
    now_text: str,
) -> dict[str, float]:
    totals = await conn.fetchrow(
        '''
        SELECT COALESCE(SUM(obtained_marks), 0) AS total_score,
               COALESCE(SUM(max_marks), 0) AS total_marks
        FROM question_scores
        WHERE submission_id = $1
        ''',
        submission_id,
    )
    total_score = float(totals["total_score"] or 0) if totals else 0.0
    total_marks = float(totals["total_marks"] or 0) if totals else 0.0
    percentage = round((total_score / total_marks) * 100, 2) if total_marks > 0 else 0.0

    await conn.execute(
        '''
        UPDATE submissions
        SET total_score = $2,
            total_marks = $3,
            percentage = $4,
            teacher_feedback = CASE WHEN $5 THEN $6 ELSE teacher_feedback END,
            status = CASE WHEN COALESCE(status, '') = 'published' THEN status ELSE 'reviewed' END,
            updated_at = $7
        WHERE id = $1
        ''',
        submission_id,
        total_score,
        total_marks,
        percentage,
        has_teacher_feedback,
        teacher_feedback,
        now_text,
    )
    return {
        "totalScore": total_score,
        "totalMarks": total_marks,
        "percentage": percentage,
    }


def _has_any_key(data: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return any(key in data for key in keys)


def _optional_text(data: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        if key in data:
            value = data.get(key)
            return "" if value is None else str(value)
    return None


def _optional_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ReviewSaveServiceError(400, "Obtained marks must be numeric")
