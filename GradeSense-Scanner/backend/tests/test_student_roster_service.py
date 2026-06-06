import unittest

from student_roster_service import (
    StudentRosterServiceError,
    normalize_student_profile_update,
    update_batch_student_profile,
)


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeConnection:
    def __init__(self, *, owned=True, phone_column="mobile_number", source="user"):
        self.owned = owned
        self.phone_column = phone_column
        self.source = source
        self.executed = []

    def transaction(self):
        return FakeTransaction()

    async def fetchrow(self, query, *args):
        if "FROM batch_students bs" in query:
            if not self.owned:
                return None
            return {
                "source": self.source,
                "student_id": args[1],
                "name": "Old Name",
                "email": "old@example.com",
                "roll_number": "OLD",
                "accepted_by_user_id": None,
            }
        if "UPDATE users" in query:
            return {
                "student_id": args[0],
                "name": args[1],
                "email": args[3],
                "roll_number": args[2],
                self.phone_column: args[4],
            }
        if "UPDATE student_invitations" in query:
            return {
                "student_id": args[0],
                "name": args[1],
                "email": args[3],
                "roll_number": args[2],
                self.phone_column: args[4],
            }
        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def fetchval(self, query, *args):
        if "information_schema.columns" in query:
            return self.phone_column
        raise AssertionError(f"Unexpected fetchval query: {query}")

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"


class StudentRosterServiceTest(unittest.IsolatedAsyncioTestCase):
    def test_normalize_student_profile_update_trims_supported_fields(self):
        update = normalize_student_profile_update({
            "name": "  Aayush Nigam  ",
            "rollNumber": "  24002  ",
            "email": "  aayush@example.com  ",
            "mobileNumber": "  9876543210  ",
        })

        self.assertEqual(update["name"], "Aayush Nigam")
        self.assertEqual(update["roll_number"], "24002")
        self.assertEqual(update["email"], "aayush@example.com")
        self.assertEqual(update["mobile_number"], "9876543210")

    def test_normalize_student_profile_update_rejects_blank_name(self):
        with self.assertRaises(StudentRosterServiceError):
            normalize_student_profile_update({"name": "   "})

    async def test_update_batch_student_profile_updates_user_and_submission_identity(self):
        conn = FakeConnection()

        student = await update_batch_student_profile(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            student_id="student_1",
            data={
                "name": "Aayush Nigam",
                "rollNumber": "24002",
                "email": "aayush@example.com",
                "mobileNumber": "9876543210",
            },
        )

        self.assertEqual(student["student_id"], "student_1")
        self.assertEqual(student["name"], "Aayush Nigam")
        self.assertEqual(student["roll_number"], "24002")
        self.assertEqual(student["mobileNumber"], "9876543210")
        self.assertEqual(len(conn.executed), 1)
        self.assertIn("UPDATE submissions", conn.executed[0][0])

    async def test_update_batch_student_profile_updates_invitation_roster_rows(self):
        conn = FakeConnection(source="invitation")

        student = await update_batch_student_profile(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            student_id="invite_1",
            data={
                "name": "Invited Student",
                "rollNumber": "INV-1",
                "email": "invite@example.com",
                "mobileNumber": "9000000000",
            },
        )

        self.assertEqual(student["student_id"], "invite_1")
        self.assertEqual(student["name"], "Invited Student")
        self.assertEqual(student["roll_number"], "INV-1")
        self.assertEqual(student["mobileNumber"], "9000000000")

    async def test_update_batch_student_profile_requires_owned_batch_student(self):
        conn = FakeConnection(owned=False)

        with self.assertRaises(StudentRosterServiceError) as ctx:
            await update_batch_student_profile(
                conn,
                teacher_id="teacher_1",
                batch_id="batch_1",
                student_id="student_1",
                data={"name": "Aayush"},
            )

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(conn.executed, [])


if __name__ == "__main__":
    unittest.main()
