import unittest
from typing import Any, List
from student_import_service import (
    generate_csv_template,
    import_students_csv,
    REQUIRED_HEADERS,
)


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeConnection:
    def __init__(
        self,
        *,
        phone_column="phone",
        existing_user=None,
        existing_invitation=None,
        is_linked=False,
    ):
        self.phone_column = phone_column
        self.existing_user = existing_user
        self.existing_invitation = existing_invitation
        self.is_linked = is_linked
        self.executed = []

    def transaction(self):
        return FakeTransaction()

    async def fetchrow(self, query, *args):
        # 1. User search by email
        if "FROM users WHERE LOWER(email)" in query:
            if self.existing_user and self.existing_user["email"].lower() == args[0].lower():
                return self.existing_user
            return None

        # 2. User details fetch by ID
        if "FROM users WHERE id = $1" in query:
            if self.existing_user and self.existing_user["id"] == args[0]:
                return self.existing_user
            return None

        # 3. Invitation search
        if "FROM student_invitations" in query and "LOWER(email)" in query:
            if self.existing_invitation and self.existing_invitation["email"].lower() == args[1].lower():
                return self.existing_invitation
            return None

        # 4. Invitation details fetch by ID
        if "FROM student_invitations" in query and "WHERE id = $1" in query:
            if self.existing_invitation and self.existing_invitation["id"] == args[0]:
                return self.existing_invitation
            return None

        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def fetchval(self, query, *args):
        if "information_schema.columns" in query:
            return self.phone_column
        if "FROM batch_students" in query:
            return 1 if self.is_linked else None
        raise AssertionError(f"Unexpected fetchval query: {query}")

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "SUCCESS"


class StudentImportServiceTest(unittest.IsolatedAsyncioTestCase):
    def test_generate_csv_template(self):
        students = [
            {"roll_number": "1", "name": "Alice", "email": "alice@example.com", "mobile_number": "111111"},
            {"roll_number": "2", "name": "Bob", "email": "bob@example.com", "mobile_number": "222222"},
        ]
        csv_str = generate_csv_template(students)
        lines = csv_str.strip().split("\r\n")
        self.assertEqual(lines[0], ",".join(REQUIRED_HEADERS))
        self.assertEqual(lines[1], "1,Alice,alice@example.com,111111")
        self.assertEqual(lines[2], "2,Bob,bob@example.com,222222")

    async def test_import_students_csv_creates_new_invitations(self):
        conn = FakeConnection()
        csv_content = f"""{",".join(REQUIRED_HEADERS)}
1,Alice,alice@example.com,111111
"""
        result = await import_students_csv(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            csv_content=csv_content,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["linked"], 0)
        self.assertEqual(result["errors"], [])

        # Verify insert query
        insert_calls = [c for c in conn.executed if "INSERT INTO student_invitations" in c[0]]
        self.assertEqual(len(insert_calls), 1)
        self.assertEqual(insert_calls[0][1][1], "teacher_1")
        self.assertEqual(insert_calls[0][1][2], "batch_1")
        self.assertEqual(insert_calls[0][1][3], "alice@example.com")
        self.assertEqual(insert_calls[0][1][4], "Alice")
        self.assertEqual(insert_calls[0][1][5], "1")
        self.assertEqual(insert_calls[0][1][6], "111111")

    async def test_import_students_csv_links_existing_user(self):
        existing_user = {
            "id": "usr_alice",
            "name": "Alice",
            "email": "alice@example.com",
            "roll_number": "1",
            "phone": "111111",
        }
        conn = FakeConnection(existing_user=existing_user, is_linked=False)
        csv_content = f"""{",".join(REQUIRED_HEADERS)}
1,Alice,alice@example.com,111111
"""
        result = await import_students_csv(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            csv_content=csv_content,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["linked"], 1)
        self.assertEqual(result["errors"], [])

        # Verify batch_students insert
        link_calls = [c for c in conn.executed if "INSERT INTO batch_students" in c[0]]
        self.assertEqual(len(link_calls), 1)
        self.assertEqual(link_calls[0][1][0], "batch_1")
        self.assertEqual(link_calls[0][1][1], "usr_alice")

    async def test_import_students_csv_updates_existing_user_details(self):
        existing_user = {
            "id": "usr_alice",
            "name": "Alice",
            "email": "alice@example.com",
            "roll_number": "1",
            "phone": "111111",
        }
        conn = FakeConnection(existing_user=existing_user, is_linked=True)
        csv_content = f"""{",".join(REQUIRED_HEADERS)}
1,Alice Updated,alice@example.com,999999
"""
        result = await import_students_csv(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            csv_content=csv_content,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["linked"], 0)
        self.assertEqual(result["errors"], [])

        # Verify update users query
        update_calls = [c for c in conn.executed if "UPDATE users" in c[0]]
        self.assertEqual(len(update_calls), 1)
        self.assertEqual(update_calls[0][1][0], "usr_alice")
        self.assertEqual(update_calls[0][1][1], "Alice Updated")
        self.assertEqual(update_calls[0][1][2], "1")
        self.assertEqual(update_calls[0][1][3], "999999")

    async def test_import_students_csv_updates_existing_invitations(self):
        existing_inv = {
            "id": "inv_bob",
            "name": "Bob",
            "email": "bob@example.com",
            "roll_number": "2",
            "phone": "222222",
        }
        conn = FakeConnection(existing_invitation=existing_inv)
        csv_content = f"""{",".join(REQUIRED_HEADERS)}
2,Bob Updated,bob@example.com,888888
"""
        result = await import_students_csv(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            csv_content=csv_content,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["linked"], 0)
        self.assertEqual(result["errors"], [])

        # Verify update student_invitations query
        update_calls = [c for c in conn.executed if "UPDATE student_invitations" in c[0]]
        self.assertEqual(len(update_calls), 1)
        self.assertEqual(update_calls[0][1][0], "inv_bob")
        self.assertEqual(update_calls[0][1][1], "Bob Updated")
        self.assertEqual(update_calls[0][1][2], "2")
        self.assertEqual(update_calls[0][1][3], "888888")

    async def test_import_students_csv_validates_malformed_csv(self):
        conn = FakeConnection()
        
        # Missing headers
        csv_content = "Name,Email\nAlice,alice@example.com"
        result = await import_students_csv(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            csv_content=csv_content,
        )
        self.assertFalse(result["success"])
        self.assertIn("missing", result["error"])

        # Invalid email format
        csv_content = f"""{",".join(REQUIRED_HEADERS)}
1,Alice,not-an-email,111111
"""
        result = await import_students_csv(
            conn,
            teacher_id="teacher_1",
            batch_id="batch_1",
            csv_content=csv_content,
        )
        self.assertTrue(result["success"])
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("Invalid email format", result["errors"][0])


if __name__ == "__main__":
    unittest.main()
