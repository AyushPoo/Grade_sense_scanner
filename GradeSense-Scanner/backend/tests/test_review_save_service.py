import unittest

from review_save_service import (
    ReviewSaveServiceError,
    normalize_review_score_updates,
    save_submission_review_edits,
)


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeConnection:
    def __init__(self, *, owned=True):
        self.owned = owned
        self.executed = []

    def transaction(self):
        return FakeTransaction()

    async def fetchrow(self, query, *args):
        if "FROM submissions s" in query:
            return {"id": args[0]} if self.owned else None
        if "FROM question_scores" in query:
            return {"total_score": 8.5, "total_marks": 10}
        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"


class ReviewSaveServiceTest(unittest.IsolatedAsyncioTestCase):
    def test_normalize_review_score_updates_preserves_editable_feedback(self):
        updates = normalize_review_score_updates([
            {
                "id": "qsc_1",
                "obtainedMarks": 0,
                "teacherCorrection": "",
                "aiFeedback": "Teacher-approved feedback.",
            },
            {
                "scoreId": "qsc_2",
                "obtainedMarks": "4.5",
            },
        ])

        self.assertEqual(updates[0]["score_id"], "qsc_1")
        self.assertEqual(updates[0]["obtained_marks"], 0)
        self.assertTrue(updates[0]["has_teacher_correction"])
        self.assertEqual(updates[0]["teacher_correction"], "")
        self.assertTrue(updates[0]["has_ai_feedback"])
        self.assertEqual(updates[0]["ai_feedback"], "Teacher-approved feedback.")
        self.assertEqual(updates[1]["score_id"], "qsc_2")
        self.assertFalse(updates[1]["has_ai_feedback"])

    def test_normalize_review_score_updates_rejects_invalid_marks(self):
        with self.assertRaises(ReviewSaveServiceError):
            normalize_review_score_updates([{"id": "qsc_1", "obtainedMarks": "bad"}])

    async def test_save_submission_review_updates_scores_and_submission_totals(self):
        conn = FakeConnection()

        result = await save_submission_review_edits(
            conn,
            teacher_id="user_1",
            submission_id="sub_1",
            data={
                "teacherFeedback": "Overall good.",
                "scores": [
                    {
                        "scoreId": "qsc_1",
                        "obtainedMarks": 8.5,
                        "teacherCorrection": "Award method marks.",
                        "aiFeedback": "Good working, check final answer.",
                    }
                ],
            },
            now_text="2026-06-06T00:00:00Z",
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["submission"]["totalScore"], 8.5)
        self.assertEqual(result["submission"]["totalMarks"], 10.0)
        self.assertEqual(result["submission"]["percentage"], 85.0)
        self.assertEqual(len(conn.executed), 2)

        score_args = conn.executed[0][1]
        self.assertEqual(score_args[0], "qsc_1")
        self.assertEqual(score_args[2], 8.5)
        self.assertTrue(score_args[3])
        self.assertEqual(score_args[4], "Award method marks.")
        self.assertTrue(score_args[5])
        self.assertEqual(score_args[6], "Good working, check final answer.")

        submission_args = conn.executed[1][1]
        self.assertEqual(submission_args[0], "sub_1")
        self.assertTrue(submission_args[4])
        self.assertEqual(submission_args[5], "Overall good.")

    async def test_save_submission_review_requires_owned_submission(self):
        conn = FakeConnection(owned=False)

        with self.assertRaises(ReviewSaveServiceError) as ctx:
            await save_submission_review_edits(
                conn,
                teacher_id="user_1",
                submission_id="sub_1",
                data={"scores": []},
                now_text="2026-06-06T00:00:00Z",
            )

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(conn.executed, [])


if __name__ == "__main__":
    unittest.main()
