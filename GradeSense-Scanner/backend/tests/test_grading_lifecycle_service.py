import unittest
from datetime import datetime, timedelta, timezone

from grading_lifecycle_service import (
    build_grading_jobs,
    derive_scan_session_reconciliation,
    validate_scan_session_ready_for_sync,
    is_review_ready_exam,
    is_successful_blueprint_job,
    select_primary_grading_job,
    student_answer_text_select_expression,
)


class GradingLifecycleServiceTest(unittest.TestCase):
    def test_build_grading_jobs_ignores_blueprint_extraction(self):
        jobs = build_grading_jobs([
            {
                "id": "job_blueprint",
                "type": "blueprint_extraction",
                "status": "completed",
                "progress": 1,
                "processed_items": 1,
                "total_items": 1,
            },
            {
                "id": "job_grade",
                "type": "grade_submissions",
                "status": "queued",
                "progress": 0,
                "processed_items": 0,
                "total_items": 3,
            },
        ])

        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["id"], "job_grade")

    def test_select_primary_grading_job_prefers_active_over_completed(self):
        job = select_primary_grading_job([
            {
                "id": "job_old",
                "type": "grade_submissions",
                "status": "completed",
                "processed_items": 3,
                "total_items": 3,
            },
            {
                "id": "job_new",
                "type": "grade_submissions",
                "status": "processing",
                "processed_items": 1,
                "total_items": 3,
            },
        ])

        self.assertIsNotNone(job)
        self.assertEqual(job["id"], "job_new")

    def test_review_ready_requires_graded_submissions(self):
        self.assertFalse(is_review_ready_exam({
            "status": "draft",
            "submission_count": 3,
            "graded_submission_count": 0,
        }))
        self.assertFalse(is_review_ready_exam({
            "status": "draft",
            "submission_count": 3,
            "graded_submission_count": 2,
        }))
        self.assertTrue(is_review_ready_exam({
            "status": "draft",
            "submission_count": 3,
            "graded_submission_count": 3,
        }))

    def test_student_answer_text_expression_uses_existing_columns_without_new_ai_work(self):
        self.assertEqual(
            student_answer_text_select_expression(["id", "extracted_answer_text"]),
            "COALESCE(sc.extracted_answer_text)",
        )
        self.assertEqual(student_answer_text_select_expression(["id"]), "NULL")

    def test_successful_blueprint_job_requires_real_processed_output(self):
        self.assertFalse(is_successful_blueprint_job({
            "status": "completed",
            "success_count": 0,
            "processed_items": 0,
        }))

    def test_scan_session_ready_for_sync_requires_student_answer_pages(self):
        errors = validate_scan_session_ready_for_sync({
            "model_answer": {"pages": [{"page_number": 1}]},
            "question_paper": {"pages": []},
            "students": [{"label": "Student 1", "pages": []}],
        })

        self.assertEqual(errors, ["Scan at least one student answer paper before starting grading."])

    def test_reconciliation_marks_failed_grading_job_as_sync_failed(self):
        payload = derive_scan_session_reconciliation(
            {"status": "grading"},
            [{
                "id": "job_grade",
                "type": "grade_submissions",
                "status": "failed",
                "total_items": 3,
                "processed_items": 0,
                "error": "Exam blueprint not found",
            }],
            3,
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["status"], "sync_failed")
        self.assertEqual(payload["last_sync_error"], "Exam blueprint not found")

    def test_reconciliation_marks_zero_output_blueprint_as_sync_failed(self):
        payload = derive_scan_session_reconciliation(
            {"status": "syncing"},
            [{
                "id": "job_blueprint",
                "type": "blueprint_extraction",
                "status": "completed",
                "total_items": 1,
                "processed_items": 0,
                "success_count": 0,
            }],
            0,
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["status"], "sync_failed")
        self.assertIn("usable exam blueprint", payload["last_sync_error"])

    def test_reconciliation_marks_stale_empty_exam_as_sync_failed(self):
        payload = derive_scan_session_reconciliation(
            {
                "status": "syncing",
                "updated_at": datetime.now(timezone.utc) - timedelta(minutes=20),
            },
            [],
            0,
            now=datetime.now(timezone.utc),
            stale_after_seconds=600,
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["status"], "sync_failed")
        self.assertIn("No student answer submissions", payload["last_sync_error"])

    def test_reconciliation_does_not_mark_partial_completed_job_as_graded(self):
        payload = derive_scan_session_reconciliation(
            {"status": "grading"},
            [{
                "id": "job_grade",
                "type": "grade_submissions",
                "status": "completed",
                "total_items": 3,
                "processed_items": 0,
            }],
            3,
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["status"], "sync_failed")
        self.assertIn("without processing all submitted papers", payload["last_sync_error"])

    def test_reconciliation_marks_stale_unstarted_grading_job_as_failed(self):
        now = datetime.now(timezone.utc)
        payload = derive_scan_session_reconciliation(
            {"status": "grading"},
            [{
                "id": "job_grade",
                "type": "grade_submissions",
                "status": "queued",
                "total_items": 3,
                "processed_items": 0,
                "created_at": now - timedelta(minutes=20),
            }],
            3,
            now=now,
            stale_after_seconds=600,
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["status"], "sync_failed")
        self.assertIn("did not start", payload["last_sync_error"])
        self.assertTrue(is_successful_blueprint_job({
            "status": "completed",
            "success_count": 1,
            "processed_items": 0,
        }))


if __name__ == "__main__":
    unittest.main()
