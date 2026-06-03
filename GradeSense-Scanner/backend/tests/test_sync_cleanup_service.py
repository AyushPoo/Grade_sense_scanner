import unittest

from sync_cleanup_service import (
    DELETE_STALE_UPLOAD_FLOWS_FOR_TEACHER_SQL,
    DELETE_UPLOAD_FLOWS_FOR_EXAMS_SQL,
    delete_stale_upload_flows_for_teacher,
    delete_upload_flows_for_exams,
    normalize_exam_ids,
    parse_asyncpg_execute_count,
)


class FakeConnection:
    def __init__(self, result="DELETE 2"):
        self.result = result
        self.calls = []

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        return self.result


class SyncCleanupServiceTest(unittest.IsolatedAsyncioTestCase):
    def test_normalize_exam_ids_deduplicates_and_drops_empty_values(self):
        self.assertEqual(
            normalize_exam_ids(["exam_b", None, "", "exam_a", "exam_b"]),
            ["exam_a", "exam_b"],
        )

    def test_parse_asyncpg_execute_count_reads_affected_rows(self):
        self.assertEqual(parse_asyncpg_execute_count("DELETE 3"), 3)
        self.assertEqual(parse_asyncpg_execute_count("UPDATE 0"), 0)
        self.assertEqual(parse_asyncpg_execute_count(None), 0)

    async def test_delete_upload_flows_for_exams_uses_teacher_and_normalized_ids(self):
        conn = FakeConnection()

        deleted_count = await delete_upload_flows_for_exams(
            conn,
            "teacher_1",
            ["exam_2", "exam_1", "exam_2"],
        )

        self.assertEqual(deleted_count, 2)
        self.assertEqual(len(conn.calls), 1)
        sql, args = conn.calls[0]
        self.assertEqual(sql, DELETE_UPLOAD_FLOWS_FOR_EXAMS_SQL)
        self.assertEqual(args, ("teacher_1", ["exam_1", "exam_2"]))

    async def test_delete_upload_flows_for_exams_skips_empty_input(self):
        conn = FakeConnection()

        deleted_count = await delete_upload_flows_for_exams(conn, "teacher_1", [])

        self.assertEqual(deleted_count, 0)
        self.assertEqual(conn.calls, [])

    async def test_delete_stale_upload_flows_for_teacher_scopes_to_teacher(self):
        conn = FakeConnection(result="DELETE 4")

        deleted_count = await delete_stale_upload_flows_for_teacher(conn, "teacher_1")

        self.assertEqual(deleted_count, 4)
        self.assertEqual(len(conn.calls), 1)
        sql, args = conn.calls[0]
        self.assertEqual(sql, DELETE_STALE_UPLOAD_FLOWS_FOR_TEACHER_SQL)
        self.assertEqual(args, ("teacher_1",))
        self.assertIn("u.exam_id IS NULL", sql)
        self.assertIn("u.status IN ('completed', 'failed')", sql)
