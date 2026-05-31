from typing import Any, Callable

from review_settings_service import build_question_improvement_pattern_json


class ImproveAIServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def save_question_improvement(
    conn: Any,
    *,
    teacher_id: str,
    submission_id: str,
    score_id: str,
    data: dict[str, Any],
    generate_id: Callable[[str], str],
    now_text: Callable[[], str],
) -> dict[str, Any]:
    teacher_correction = str(data.get("teacherCorrection") or "").strip()
    if not teacher_correction:
        raise ImproveAIServiceError(400, "Teacher correction is required")

    async with conn.transaction():
        score_row = await _fetch_owned_score(conn, teacher_id, submission_id, score_id)
        if not score_row:
            raise ImproveAIServiceError(404, "Question score not found")

        max_marks = float(score_row["max_marks"] or data.get("maxMarks") or 0)
        expected_grade = _normalize_expected_grade(data.get("expectedGrade", score_row["obtained_marks"]), max_marks)
        now = now_text()
        pattern_id = generate_id("tfp_")
        pattern_json = build_question_improvement_pattern_json({
            **data,
            "scoreId": score_row["id"],
            "questionId": score_row["question_id"],
            "questionNumber": score_row["question_number"],
            "questionText": data.get("questionText") or score_row["question_text"] or "",
            "aiGrade": score_row["obtained_marks"] or 0,
            "expectedGrade": expected_grade,
            "maxMarks": max_marks,
            "aiFeedback": data.get("aiFeedback") or score_row["ai_feedback"] or "",
            "teacherCorrection": teacher_correction,
        })

        await _insert_feedback_pattern(
            conn,
            pattern_id=pattern_id,
            teacher_id=teacher_id,
            exam_id=score_row["exam_id"],
            question_number=str(score_row["question_number"]),
            ai_feedback=score_row["ai_feedback"] or "",
            teacher_correction=teacher_correction,
            pattern_json=pattern_json,
            now=now,
        )
        updated_score = await _update_question_score(
            conn,
            submission_id=submission_id,
            score_id=score_id,
            expected_grade=expected_grade,
            teacher_correction=teacher_correction,
        )
        submission_totals = await _refresh_submission_totals(conn, submission_id, now)
        await _insert_audit_log(conn, generate_id, teacher_id, score_id, pattern_json, now)

    return {
        "patternId": pattern_id,
        "score": {
            "id": str(updated_score["id"]),
            "questionNumber": updated_score["question_number"],
            "obtainedMarks": updated_score["obtained_marks"] or 0,
            "maxMarks": updated_score["max_marks"] or 0,
            "aiFeedback": updated_score["ai_feedback"],
            "teacherCorrection": updated_score["teacher_correction"],
        },
        "submission": {
            "id": submission_id,
            **submission_totals,
        },
    }


async def _fetch_owned_score(conn: Any, teacher_id: str, submission_id: str, score_id: str):
    return await conn.fetchrow(
        '''
        SELECT qs.id, qs.question_id, qs.question_number, qs.obtained_marks, qs.max_marks,
               qs.ai_feedback, qi.question_text, s.exam_id
        FROM question_scores qs
        JOIN submissions s ON s.id = qs.submission_id
        JOIN exams e ON e.id = s.exam_id
        LEFT JOIN question_items qi ON qi.id = qs.question_id
        WHERE qs.id = $1
          AND qs.submission_id = $2
          AND e.teacher_id = $3
        ''',
        score_id,
        submission_id,
        teacher_id,
    )


def _normalize_expected_grade(raw_expected: Any, max_marks: float) -> float:
    try:
        expected_grade = float(raw_expected)
    except (TypeError, ValueError):
        raise ImproveAIServiceError(400, "Expected grade must be numeric")
    return max(0.0, min(expected_grade, max_marks))


async def _insert_feedback_pattern(
    conn: Any,
    *,
    pattern_id: str,
    teacher_id: str,
    exam_id: str,
    question_number: str,
    ai_feedback: str,
    teacher_correction: str,
    pattern_json: str,
    now: str,
) -> None:
    await conn.execute(
        '''
        INSERT INTO teacher_feedback_patterns (
            id, teacher_id, exam_id, question_number,
            original_ai_feedback, teacher_correction, pattern_json,
            created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ''',
        pattern_id,
        teacher_id,
        exam_id,
        question_number,
        ai_feedback,
        teacher_correction,
        pattern_json,
        now,
        now,
    )


async def _update_question_score(
    conn: Any,
    *,
    submission_id: str,
    score_id: str,
    expected_grade: float,
    teacher_correction: str,
):
    return await conn.fetchrow(
        '''
        UPDATE question_scores
        SET obtained_marks = $3,
            teacher_correction = $4,
            is_reviewed = TRUE
        WHERE id = $1 AND submission_id = $2
        RETURNING id, question_number, obtained_marks, max_marks, ai_feedback, teacher_correction
        ''',
        score_id,
        submission_id,
        expected_grade,
        teacher_correction,
    )


async def _refresh_submission_totals(conn: Any, submission_id: str, now: str) -> dict[str, float]:
    totals = await conn.fetchrow(
        '''
        SELECT COALESCE(SUM(obtained_marks), 0) AS total_score,
               COALESCE(SUM(max_marks), 0) AS total_marks
        FROM question_scores
        WHERE submission_id = $1
        ''',
        submission_id,
    )
    total_score = float(totals["total_score"] or 0)
    total_marks = float(totals["total_marks"] or 0)
    percentage = round((total_score / total_marks) * 100, 2) if total_marks > 0 else 0

    await conn.execute(
        '''
        UPDATE submissions
        SET total_score = $2,
            total_marks = $3,
            percentage = $4,
            updated_at = $5
        WHERE id = $1
        ''',
        submission_id,
        total_score,
        total_marks,
        percentage,
        now,
    )
    return {
        "totalScore": total_score,
        "totalMarks": total_marks,
        "percentage": percentage,
    }


async def _insert_audit_log(
    conn: Any,
    generate_id: Callable[[str], str],
    teacher_id: str,
    score_id: str,
    pattern_json: str,
    now: str,
) -> None:
    await conn.execute(
        '''
        INSERT INTO audit_logs (
            id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ''',
        generate_id("aud_"),
        teacher_id,
        "mobile_question_ai_improvement_created",
        "question_score",
        score_id,
        pattern_json,
        now,
    )
