from __future__ import annotations

import re
from typing import Any


PHONE_COLUMNS = ("mobile_number", "phone_number", "phone")


class StudentRosterServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def normalize_student_profile_update(data: dict[str, Any]) -> dict[str, str | None]:
    update: dict[str, str | None] = {}

    if _has_any_key(data, ("name",)):
        name = _trim_optional(data.get("name"))
        if not name:
            raise StudentRosterServiceError(400, "Student name is required")
        update["name"] = name

    if _has_any_key(data, ("rollNumber", "roll_number", "studentId", "student_id")):
        update["roll_number"] = _trim_optional(
            data.get("rollNumber", data.get("roll_number", data.get("studentId", data.get("student_id"))))
        )

    if _has_any_key(data, ("email",)):
        email = _trim_optional(data.get("email"))
        if email and not _looks_like_email(email):
            raise StudentRosterServiceError(400, "Email address is invalid")
        update["email"] = email

    if _has_any_key(data, ("mobileNumber", "mobile_number", "phone", "phoneNumber", "phone_number")):
        update["mobile_number"] = _trim_optional(
            data.get(
                "mobileNumber",
                data.get("mobile_number", data.get("phone", data.get("phoneNumber", data.get("phone_number")))),
            )
        )

    if not update:
        raise StudentRosterServiceError(400, "No student profile changes were provided")

    return update


async def update_batch_student_profile(
    conn: Any,
    *,
    teacher_id: str,
    batch_id: str,
    student_id: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    update = normalize_student_profile_update(data)

    async with conn.transaction():
        existing = await _fetch_owned_student(conn, teacher_id, batch_id, student_id)
        if not existing:
            raise StudentRosterServiceError(404, "Student not found")

        existing_student = dict(existing)
        phone_column = await fetch_phone_column(conn, "users")
        if existing_student.get("source") == "invitation" and not existing_student.get("accepted_by_user_id"):
            phone_column = await fetch_phone_column(conn, "student_invitations")
            updated = await _update_invitation_profile(
                conn,
                invitation_id=existing_student["student_id"],
                existing=existing_student,
                update=update,
                phone_column=phone_column,
            )
        else:
            updated = await _update_user_profile(
                conn,
                user_id=existing_student.get("accepted_by_user_id") or student_id,
                existing=existing_student,
                update=update,
                phone_column=phone_column,
            )
        if not updated:
            raise StudentRosterServiceError(404, "Student not found")
        await _sync_submission_identity(
            conn,
            teacher_id=teacher_id,
            batch_id=batch_id,
            student_id=student_id,
            name=updated.get("name"),
            roll_number=updated.get("roll_number"),
            email=updated.get("email"),
        )

    mobile_number = updated.get(phone_column) if phone_column else update.get("mobile_number")
    return {
        "student_id": student_id,
        "id": student_id,
        "name": updated.get("name") or "",
        "email": updated.get("email") or "",
        "roll_number": updated.get("roll_number") or "",
        "rollNumber": updated.get("roll_number") or "",
        "mobile_number": mobile_number or "",
        "mobileNumber": mobile_number or "",
        "batch_id": batch_id,
    }


async def fetch_phone_column(conn: Any, table_name: str) -> str | None:
    column = await conn.fetchval(
        '''
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $1
          AND column_name = ANY($2::text[])
        ORDER BY CASE column_name
          WHEN 'mobile_number' THEN 1
          WHEN 'phone_number' THEN 2
          WHEN 'phone' THEN 3
          ELSE 4
        END
        LIMIT 1
        ''',
        table_name,
        list(PHONE_COLUMNS),
    )
    column = str(column or "").strip()
    return column if column in PHONE_COLUMNS else None


async def _fetch_owned_student(conn: Any, teacher_id: str, batch_id: str, student_id: str):
    return await conn.fetchrow(
        '''
        SELECT 'user' AS source,
               u.id AS student_id,
               u.name,
               u.email,
               u.roll_number,
               NULL::text AS accepted_by_user_id
        FROM batch_students bs
        JOIN users u ON u.id = bs.student_id
        JOIN batches b
          ON b.id = bs.batch_id
         AND b.teacher_id = $3
         AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
        WHERE bs.batch_id = $1
          AND bs.student_id = $2
        UNION ALL
        SELECT 'invitation' AS source,
               si.id AS student_id,
               si.name,
               si.email,
               si.roll_number,
               si.accepted_by_user_id
        FROM student_invitations si
        JOIN batches b
          ON b.id = si.batch_id
         AND b.teacher_id = $3
         AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
        WHERE si.batch_id = $1
          AND (si.id = $2 OR si.accepted_by_user_id = $2 OR LOWER(si.email) = LOWER($2))
          AND COALESCE(si.status, '') NOT IN ('cancelled', 'deleted')
        LIMIT 1
        ''',
        batch_id,
        student_id,
        teacher_id,
    )


async def _update_user_profile(
    conn: Any,
    *,
    user_id: str,
    existing: dict[str, Any],
    update: dict[str, str | None],
    phone_column: str | None,
):
    name = update.get("name", existing.get("name"))
    roll_number = update.get("roll_number", existing.get("roll_number"))
    email = update.get("email", existing.get("email"))
    mobile_number = update.get("mobile_number")

    phone_select = f", {phone_column}" if phone_column else ""
    phone_assignment = f", {phone_column} = $5" if phone_column else ""
    return await conn.fetchrow(
        f'''
        UPDATE users
        SET name = $2,
            roll_number = $3,
            email = $4
            {phone_assignment}
        WHERE id = $1
        RETURNING id AS student_id,
                  name,
                  email,
                  roll_number
                  {phone_select}
        ''',
        user_id,
        name,
        roll_number,
        email,
        mobile_number,
    )


async def _update_invitation_profile(
    conn: Any,
    *,
    invitation_id: str,
    existing: dict[str, Any],
    update: dict[str, str | None],
    phone_column: str | None,
):
    name = update.get("name", existing.get("name"))
    roll_number = update.get("roll_number", existing.get("roll_number"))
    email = update.get("email", existing.get("email"))
    mobile_number = update.get("mobile_number")

    phone_select = f", {phone_column}" if phone_column else ""
    phone_assignment = f", {phone_column} = $5" if phone_column else ""
    return await conn.fetchrow(
        f'''
        UPDATE student_invitations
        SET name = $2,
            roll_number = $3,
            email = $4
            {phone_assignment}
        WHERE id = $1
        RETURNING id AS student_id,
                  name,
                  email,
                  roll_number
                  {phone_select}
        ''',
        invitation_id,
        name,
        roll_number,
        email,
        mobile_number,
    )


async def _sync_submission_identity(
    conn: Any,
    *,
    teacher_id: str,
    batch_id: str,
    student_id: str,
    name: str | None,
    roll_number: str | None,
    email: str | None,
) -> None:
    await conn.execute(
        '''
        UPDATE submissions s
        SET student_name = $4,
            student_roll_number = $5,
            student_email = $6
        FROM exams e
        WHERE e.id = s.exam_id
          AND e.teacher_id = $1
          AND e.batch_id = $2
          AND s.student_id = $3
          AND COALESCE(e.status, '') NOT IN ('deleted', 'archived')
        ''',
        teacher_id,
        batch_id,
        student_id,
        name,
        roll_number,
        email,
    )


def _has_any_key(data: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return any(key in data for key in keys)


def _trim_optional(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _looks_like_email(value: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value))
