import unittest

from google_invite_auth_service import (
    AccessRequest,
    GoogleInviteAuthError,
    GoogleProfile,
    resolve_or_claim_teacher_invite,
    upsert_access_request,
)


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeConn:
    def __init__(self, fetchrows):
        self.fetchrows = list(fetchrows)
        self.executed = []

    def transaction(self):
        return FakeTransaction()

    async def fetchrow(self, query, *args):
        self.executed.append(("fetchrow", query, args))
        if not self.fetchrows:
            return None
        return self.fetchrows.pop(0)

    async def execute(self, query, *args):
        self.executed.append(("execute", query, args))
        return "UPDATE 1"


class GoogleInviteAuthServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_existing_active_user_can_login_and_claims_pending_invite(self):
        conn = FakeConn([
            {
                "id": "usr_existing12345",
                "email": "Teacher@Example.com",
                "name": "Existing Teacher",
                "role": "teacher",
                "account_status": "active",
                "picture_url": "",
            }
        ])

        user = await resolve_or_claim_teacher_invite(
            conn,
            GoogleProfile(email="Teacher@Example.com", name="Teacher Google", subject="sub_1"),
            id_factory=lambda: "usr_newshouldnotuse",
            now_factory=lambda: "2026-06-07T12:00:00+00:00",
        )

        self.assertEqual(user["id"], "usr_existing12345")
        self.assertEqual(user["email"], "teacher@example.com")
        self.assertEqual(user["role"], "teacher")
        self.assertTrue(any("UPDATE teacher_invitations" in query for _, query, _ in conn.executed))

    async def test_pending_teacher_invite_creates_active_teacher_and_accepts_invite(self):
        conn = FakeConn([
            None,
            {
                "id": "tiv_invite123456",
                "email": "newteacher@example.com",
                "name": "Invited Teacher",
            },
        ])

        user = await resolve_or_claim_teacher_invite(
            conn,
            GoogleProfile(email="NewTeacher@Example.com", name="", picture_url="https://img.test/p.png"),
            id_factory=lambda: "usr_newteacher123",
            now_factory=lambda: "2026-06-07T12:00:00+00:00",
        )

        self.assertEqual(
            user,
            {
                "id": "usr_newteacher123",
                "email": "newteacher@example.com",
                "name": "Invited Teacher",
                "role": "teacher",
                "account_status": "active",
                "picture_url": "https://img.test/p.png",
            },
        )
        self.assertTrue(any("INSERT INTO users" in query for _, query, _ in conn.executed))
        self.assertTrue(any("UPDATE teacher_invitations" in query for _, query, _ in conn.executed))

    async def test_missing_invite_rejects_mobile_first_login(self):
        conn = FakeConn([None, None])

        with self.assertRaises(GoogleInviteAuthError) as ctx:
            await resolve_or_claim_teacher_invite(
                conn,
                GoogleProfile(email="notinvited@example.com", name="No Invite"),
                id_factory=lambda: "usr_unused123456",
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.code, "INVITE_REQUIRED")
        self.assertIn("not been invited", ctx.exception.detail)
        self.assertFalse(any("INSERT INTO users" in query for _, query, _ in conn.executed))

    async def test_inactive_existing_user_is_rejected(self):
        conn = FakeConn([
            {
                "id": "usr_inactive1234",
                "email": "inactive@example.com",
                "name": "Inactive Teacher",
                "role": "teacher",
                "account_status": "disabled",
                "picture_url": "",
            }
        ])

        with self.assertRaises(GoogleInviteAuthError) as ctx:
            await resolve_or_claim_teacher_invite(
                conn,
                GoogleProfile(email="inactive@example.com", name="Inactive Teacher"),
                id_factory=lambda: "usr_unused123456",
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "Account is not active")

    async def test_access_request_is_created_for_new_uninvited_google_user(self):
        conn = FakeConn([None])

        stored = await upsert_access_request(
            conn,
            AccessRequest(
                email="Interested@Example.com",
                name="Interested Teacher",
                picture_url="https://img.test/i.png",
                subject="google-subject-1",
                source="mobile",
                app_version="1.0.0",
                build_version="8",
                device_info={"platform": "android"},
            ),
            id_factory=lambda: "arq_newrequest123",
            now_factory=lambda: "2026-06-07T12:00:00+00:00",
        )

        self.assertEqual(stored["id"], "arq_newrequest123")
        self.assertEqual(stored["email"], "interested@example.com")
        self.assertTrue(stored["created"])
        self.assertTrue(any("INSERT INTO access_requests" in query for _, query, _ in conn.executed))

    async def test_access_request_is_deduplicated_by_email_or_google_subject(self):
        conn = FakeConn([
            {
                "id": "arq_existing123",
                "email": "interested@example.com",
                "attempt_count": 2,
            }
        ])

        stored = await upsert_access_request(
            conn,
            AccessRequest(email="Interested@Example.com", subject="google-subject-1"),
            id_factory=lambda: "arq_unused",
            now_factory=lambda: "2026-06-07T12:00:00+00:00",
        )

        self.assertEqual(stored["id"], "arq_existing123")
        self.assertFalse(stored["created"])
        self.assertEqual(stored["attempt_count"], 3)
        self.assertTrue(any("UPDATE access_requests" in query for _, query, _ in conn.executed))


if __name__ == "__main__":
    unittest.main()
