import csv
import io
import logging
from typing import Any, Dict, List
from student_roster_service import (
    _sync_submission_identity,
    fetch_phone_column,
    _looks_like_email,
    _trim_optional,
)

logger = logging.getLogger(__name__)

# Expected headers in the CSV template
REQUIRED_HEADERS = ["Roll Number", "Name", "Email", "Mobile Number"]


def generate_drizzle_id(prefix: str) -> str:
    import random
    import string

    chars = string.ascii_letters + string.digits
    return prefix + "".join(random.choices(chars, k=14))


def generate_csv_template(students: List[Dict[str, Any]]) -> str:
    """Generates a CSV template containing existing students in the batch."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(REQUIRED_HEADERS)

    for s in students:
        writer.writerow([
            s.get("roll_number") or s.get("rollNumber") or "",
            s.get("name") or "",
            s.get("email") or "",
            s.get("mobile_number") or s.get("mobileNumber") or "",
        ])
    return output.getvalue()


async def import_students_csv(
    conn: Any,
    *,
    teacher_id: str,
    batch_id: str,
    csv_content: str,
) -> Dict[str, Any]:
    """Parses a CSV file containing students, validates, and syncs them to Neon database."""
    f = io.StringIO(csv_content.strip())
    reader = csv.reader(f)
    try:
        headers = next(reader)
    except StopIteration:
        return {"success": False, "error": "CSV file is empty."}

    headers = [h.strip() for h in headers]

    # Normalize headers for matching (lowercase, no spaces/underscores)
    expected_normalized = [
        h.lower().replace(" ", "").replace("_", "") for h in REQUIRED_HEADERS
    ]
    headers_normalized = [
        h.lower().replace(" ", "").replace("_", "") for h in headers
    ]

    header_map = {}
    for req, req_norm in zip(REQUIRED_HEADERS, expected_normalized):
        try:
            idx = headers_normalized.index(req_norm)
            header_map[req] = idx
        except ValueError:
            return {
                "success": False,
                "error": f"Required column '{req}' is missing.",
            }

    added_count = 0
    updated_count = 0
    linked_count = 0
    errors = []

    row_num = 1
    for row in reader:
        row_num += 1
        if not row or all(not cell.strip() for cell in row):
            continue

        try:
            roll_number = _trim_optional(row[header_map["Roll Number"]])
            name = _trim_optional(row[header_map["Name"]])
            email = _trim_optional(row[header_map["Email"]])
            mobile_number = _trim_optional(row[header_map["Mobile Number"]])
        except IndexError:
            errors.append(f"Row {row_num}: Row has fewer columns than headers.")
            continue

        if not name:
            errors.append(f"Row {row_num}: Name is required.")
            continue

        if not email:
            errors.append(f"Row {row_num}: Email is required.")
            continue

        if not _looks_like_email(email):
            errors.append(f"Row {row_num}: Invalid email format '{email}'.")
            continue

        email = email.lower()

        async with conn.transaction():
            # 1. Check if user already exists globally
            user_row = await conn.fetchrow(
                "SELECT id, name, email, roll_number FROM users WHERE LOWER(email) = $1",
                email,
            )

            if user_row:
                student_id = user_row["id"]
                # Link to batch if not already linked
                is_linked = await conn.fetchval(
                    "SELECT 1 FROM batch_students WHERE batch_id = $1 AND student_id = $2",
                    batch_id,
                    student_id,
                )

                if not is_linked:
                    await conn.execute(
                        "INSERT INTO batch_students (batch_id, student_id) VALUES ($1, $2)",
                        batch_id,
                        student_id,
                    )
                    linked_count += 1

                # Update user details if different
                phone_column = await fetch_phone_column(conn, "users")
                phone_select = f", {phone_column}" if phone_column else ""
                current_user = await conn.fetchrow(
                    f"SELECT id, name, email, roll_number {phone_select} FROM users WHERE id = $1",
                    student_id,
                )

                has_changed = (
                    current_user["name"] != name
                    or current_user["roll_number"] != roll_number
                    or (
                        phone_column
                        and current_user[phone_column] != mobile_number
                    )
                )

                if has_changed:
                    phone_assignment = (
                        f", {phone_column} = $4" if phone_column else ""
                    )
                    args = [student_id, name, roll_number]
                    if phone_column:
                        args.append(mobile_number)

                    await conn.execute(
                        f"""
                        UPDATE users
                        SET name = $2,
                            roll_number = $3
                            {phone_assignment}
                        WHERE id = $1
                        """,
                        *args,
                    )
                    updated_count += 1

                # Sync submissions
                await _sync_submission_identity(
                    conn,
                    teacher_id=teacher_id,
                    batch_id=batch_id,
                    student_id=student_id,
                    name=name,
                    roll_number=roll_number,
                    email=email,
                    old_email=email,
                    is_invitation=False,
                )

            else:
                # 2. Check if invitation already exists in this batch
                inv_row = await conn.fetchrow(
                    """
                    SELECT id, name, email, roll_number, phone 
                    FROM student_invitations 
                    WHERE batch_id = $1 AND LOWER(email) = $2 AND COALESCE(status, '') NOT IN ('cancelled', 'deleted')
                    """,
                    batch_id,
                    email,
                )

                if inv_row:
                    invitation_id = inv_row["id"]
                    phone_column = await fetch_phone_column(
                        conn, "student_invitations"
                    )
                    phone_select = f", {phone_column}" if phone_column else ""
                    current_inv = await conn.fetchrow(
                        f"SELECT id, name, email, roll_number {phone_select} FROM student_invitations WHERE id = $1",
                        invitation_id,
                    )

                    has_changed = (
                        current_inv["name"] != name
                        or current_inv["roll_number"] != roll_number
                        or (
                            phone_column
                            and current_inv[phone_column] != mobile_number
                        )
                    )

                    if has_changed:
                        phone_assignment = (
                            f", {phone_column} = $4" if phone_column else ""
                        )
                        args = [invitation_id, name, roll_number]
                        if phone_column:
                            args.append(mobile_number)

                        await conn.execute(
                            f"""
                            UPDATE student_invitations
                            SET name = $2,
                                roll_number = $3
                                {phone_assignment}
                            WHERE id = $1
                            """,
                            *args,
                        )
                        updated_count += 1

                    # Sync submissions
                    await _sync_submission_identity(
                        conn,
                        teacher_id=teacher_id,
                        batch_id=batch_id,
                        student_id=invitation_id,
                        name=name,
                        roll_number=roll_number,
                        email=email,
                        old_email=inv_row["email"],
                        is_invitation=True,
                    )

                else:
                    # 3. Create new invitation
                    new_inv_id = generate_drizzle_id("inv_")
                    phone_column = await fetch_phone_column(
                        conn, "student_invitations"
                    )
                    phone_field = f", {phone_column}" if phone_column else ""
                    phone_param = ", $7" if phone_column else ""

                    args = [
                        new_inv_id,
                        teacher_id,
                        batch_id,
                        email,
                        name,
                        roll_number,
                    ]
                    if phone_column:
                        args.append(mobile_number)

                    await conn.execute(
                        f"""
                        INSERT INTO student_invitations (id, teacher_id, batch_id, email, name, roll_number {phone_field}, status)
                        VALUES ($1, $2, $3, $4, $5, $6 {phone_param}, 'pending')
                        """,
                        *args,
                    )
                    added_count += 1

                    # Sync any submissions that had the same email or roll number previously
                    await _sync_submission_identity(
                        conn,
                        teacher_id=teacher_id,
                        batch_id=batch_id,
                        student_id=new_inv_id,
                        name=name,
                        roll_number=roll_number,
                        email=email,
                        old_email=email,
                        is_invitation=True,
                    )

    return {
        "success": True,
        "added": added_count,
        "updated": updated_count,
        "linked": linked_count,
        "errors": errors,
    }
