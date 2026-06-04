from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable


ACTIVE_RECORD_STATUSES = {"", "active", "draft", "published", "closed", "graded", "processing", "uploaded"}
REMOVED_RECORD_STATUSES = {"archived", "deleted"}


def _status(value: Any) -> str:
    return str(value or "").strip().lower()


def is_visible_record(row: dict[str, Any]) -> bool:
    return _status(row.get("status")) not in REMOVED_RECORD_STATUSES


def as_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _batch_display_name(row: dict[str, Any]) -> str:
    name = str(row.get("name") or "").strip()
    if name:
        return name

    class_standard = str(row.get("class_standard") or "").strip()
    section = str(row.get("section") or "").strip()
    if class_standard and section:
        return f"Class {class_standard}-{section}"
    if class_standard:
        return f"Class {class_standard}"
    return "Untitled class"


def build_batch_response(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    batches = []
    for row in rows:
        if not is_visible_record(row):
            continue
        batch_id = str(row.get("id") or row.get("batch_id") or "").strip()
        if not batch_id:
            continue
        batches.append({
            "batch_id": batch_id,
            "id": batch_id,
            "name": _batch_display_name(row),
            "classStandard": row.get("class_standard"),
            "section": row.get("section"),
            "student_count": int(row.get("student_count") or 0),
            "studentCount": int(row.get("student_count") or 0),
            "status": _status(row.get("status")) or "active",
        })
    return batches


def build_batch_exam_response(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    exams = []
    for row in rows:
        if not is_visible_record(row):
            continue
        exam_id = str(row.get("id") or "").strip()
        if not exam_id:
            continue
        exams.append({
            "id": exam_id,
            "name": row.get("name") or "Untitled Exam",
            "batchId": row.get("batch_id"),
            "subjectId": row.get("subject_id") or "",
            "subjectName": row.get("subject_name") or "Unassigned subject",
            "totalMarks": number(row.get("total_marks")),
            "examDate": as_iso(row.get("exam_date")),
            "status": row.get("status") or "graded",
            "submissionCount": int(row.get("submission_count") or 0),
            "gradedSubmissionCount": int(row.get("graded_submission_count") or 0),
            "averagePercentage": round(number(row.get("average_percentage")), 1),
        })
    return exams


def _student_key(row: dict[str, Any]) -> str:
    explicit_id = str(row.get("student_id") or "").strip()
    if explicit_id:
        return explicit_id
    name = str(row.get("student_name") or "").strip().lower()
    roll = str(row.get("student_roll_number") or "").strip().lower()
    email = str(row.get("student_email") or "").strip().lower()
    return email or f"{name}:{roll}"


def _subject_performance(attempts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_subject: dict[str, list[float]] = defaultdict(list)
    for attempt in attempts:
        subject_name = attempt.get("subjectName") or "Unassigned subject"
        by_subject[subject_name].append(number(attempt.get("percentage")))

    subjects = []
    for subject_name, percentages in by_subject.items():
        average = sum(percentages) / len(percentages) if percentages else 0
        subjects.append({
            "subjectName": subject_name,
            "examCount": len(percentages),
            "averagePercentage": round(average, 1),
        })
    return sorted(subjects, key=lambda item: item["subjectName"])


def build_student_roster_response(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for row in rows:
        key = _student_key(row)
        if not key:
            continue

        student = grouped.setdefault(key, {
            "student_id": key,
            "id": key,
            "name": row.get("student_name") or "Unnamed Student",
            "email": row.get("student_email") or "",
            "roll_number": row.get("student_roll_number") or "",
            "rollNumber": row.get("student_roll_number") or "",
            "batch_id": row.get("batch_id"),
            "examHistory": [],
        })

        if not student["email"] and row.get("student_email"):
            student["email"] = row.get("student_email")
        if not student["roll_number"] and row.get("student_roll_number"):
            student["roll_number"] = row.get("student_roll_number")
            student["rollNumber"] = row.get("student_roll_number")

        exam_id = row.get("exam_id")
        if exam_id:
            student["examHistory"].append({
                "examId": str(exam_id),
                "examName": row.get("exam_name") or "Untitled Exam",
                "subjectName": row.get("subject_name") or "Unassigned subject",
                "score": number(row.get("total_score")),
                "totalMarks": number(row.get("total_marks")),
                "percentage": round(number(row.get("percentage")), 1),
                "examDate": as_iso(row.get("exam_date")),
                "status": row.get("submission_status") or row.get("status") or "",
            })

    students = []
    for student in grouped.values():
        history = sorted(
            student["examHistory"],
            key=lambda item: item["examDate"] or "",
            reverse=True,
        )
        percentages = [number(item.get("percentage")) for item in history]
        subjects = _subject_performance(history)
        strong_subject = max(subjects, key=lambda item: item["averagePercentage"], default=None)
        weak_subject = min(subjects, key=lambda item: item["averagePercentage"], default=None)

        students.append({
            **student,
            "examHistory": history,
            "examCount": len(history),
            "averagePercentage": round(sum(percentages) / len(percentages), 1) if percentages else 0.0,
            "latestExam": history[0] if history else None,
            "subjectPerformance": subjects,
            "strongSubject": strong_subject,
            "weakSubject": weak_subject,
        })

    return sorted(students, key=lambda item: (item.get("roll_number") or "", item.get("name") or ""))


def split_students_by_strength(students: Iterable[dict[str, Any]], limit: int = 5) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    roster = list(students)
    strong = sorted(roster, key=lambda item: number(item.get("averagePercentage")), reverse=True)[:limit]
    weak = sorted(roster, key=lambda item: number(item.get("averagePercentage")))[:limit]
    return strong, weak


async def fetch_active_batches(conn: Any, teacher_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        '''
        SELECT b.id, b.name, b.class_standard, b.section, b.status,
               GREATEST(
                   COALESCE(enrolled.student_count, 0),
                   COALESCE(submitted.student_count, 0)
               ) AS student_count
        FROM batches b
        LEFT JOIN (
            SELECT batch_id, COUNT(DISTINCT student_id) AS student_count
            FROM batch_students
            GROUP BY batch_id
        ) enrolled ON enrolled.batch_id = b.id
        LEFT JOIN (
            SELECT e.batch_id, COUNT(DISTINCT NULLIF(s.student_id, '')) AS student_count
            FROM exams e
            JOIN submissions s
              ON s.exam_id = e.id
             AND COALESCE(s.status, '') <> 'deleted'
            WHERE COALESCE(e.status, '') NOT IN ('deleted', 'archived')
            GROUP BY e.batch_id
        ) submitted ON submitted.batch_id = b.id
        WHERE b.teacher_id = $1
          AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
        GROUP BY b.id, b.name, b.class_standard, b.section, b.status, b.created_at
               , enrolled.student_count, submitted.student_count
        ORDER BY b.created_at DESC
        ''',
        teacher_id,
    )
    return build_batch_response([dict(row) for row in rows])


async def fetch_batch_exams(conn: Any, teacher_id: str, batch_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        '''
        SELECT e.id, e.name, e.batch_id, e.subject_id, subj.name AS subject_name,
               e.total_marks, e.exam_date, e.status,
               COUNT(s.id) AS submission_count,
               COUNT(CASE WHEN s.status IN ('ai_graded', 'graded', 'reviewed', 'published') THEN 1 END) AS graded_submission_count,
               AVG(s.percentage) AS average_percentage
        FROM exams e
        JOIN batches b
          ON b.id = e.batch_id
         AND b.teacher_id = e.teacher_id
         AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
        LEFT JOIN subjects subj ON subj.id = e.subject_id
        LEFT JOIN submissions s
          ON s.exam_id = e.id
         AND COALESCE(s.status, '') <> 'deleted'
        WHERE e.teacher_id = $1
          AND e.batch_id = $2
          AND COALESCE(e.status, '') NOT IN ('deleted', 'archived')
        GROUP BY e.id, e.name, e.batch_id, e.subject_id, subj.name,
                 e.total_marks, e.exam_date, e.status, e.created_at
        ORDER BY e.created_at DESC
        ''',
        teacher_id,
        batch_id,
    )
    return build_batch_exam_response([dict(row) for row in rows])


async def fetch_batch_roster(conn: Any, teacher_id: str, batch_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        '''
        WITH roster_rows AS (
            SELECT bs.batch_id,
                   u.id AS student_id,
                   u.name AS student_name,
                   u.email AS student_email,
                   u.roll_number AS student_roll_number,
                   NULL::text AS exam_id,
                   NULL::text AS exam_name,
                   NULL::text AS subject_name,
                   NULL::real AS total_score,
                   NULL::real AS total_marks,
                   NULL::real AS percentage,
                   NULL::text AS exam_date,
                   'enrolled' AS submission_status,
                   bs.joined_at AS sort_date
            FROM batch_students bs
            JOIN users u ON u.id = bs.student_id
            JOIN batches b
              ON b.id = bs.batch_id
             AND b.teacher_id = $1
             AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            WHERE bs.batch_id = $2

            UNION ALL

            SELECT si.batch_id,
                   COALESCE(si.accepted_by_user_id, si.id) AS student_id,
                   si.name AS student_name,
                   si.email AS student_email,
                   si.roll_number AS student_roll_number,
                   NULL::text AS exam_id,
                   NULL::text AS exam_name,
                   NULL::text AS subject_name,
                   NULL::real AS total_score,
                   NULL::real AS total_marks,
                   NULL::real AS percentage,
                   NULL::text AS exam_date,
                   COALESCE(si.status, 'invited') AS submission_status,
                   si.created_at AS sort_date
            FROM student_invitations si
            JOIN batches b
              ON b.id = si.batch_id
             AND b.teacher_id = $1
             AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            WHERE si.batch_id = $2
              AND COALESCE(si.status, '') NOT IN ('cancelled', 'deleted')

            UNION ALL

            SELECT e.batch_id,
                   s.student_id,
                   s.student_name,
                   s.student_email,
                   s.student_roll_number,
                   e.id AS exam_id,
                   e.name AS exam_name,
                   COALESCE(subj.name, 'Unassigned subject') AS subject_name,
                   s.total_score,
                   s.total_marks,
                   s.percentage,
                   e.exam_date,
                   s.status AS submission_status,
                   e.created_at AS sort_date
            FROM submissions s
            JOIN exams e ON e.id = s.exam_id
            JOIN batches b
              ON b.id = e.batch_id
             AND b.teacher_id = e.teacher_id
             AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            LEFT JOIN subjects subj ON subj.id = e.subject_id
            WHERE e.teacher_id = $1
              AND e.batch_id = $2
              AND COALESCE(e.status, '') NOT IN ('deleted', 'archived')
              AND COALESCE(s.status, '') <> 'deleted'
        )
        SELECT *
        FROM roster_rows
        ORDER BY student_roll_number ASC NULLS LAST,
                 student_name ASC NULLS LAST,
                 sort_date DESC NULLS LAST
        ''',
        teacher_id,
        batch_id,
    )
    return build_student_roster_response([dict(row) for row in rows])
