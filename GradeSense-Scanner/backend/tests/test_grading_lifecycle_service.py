import unittest

from grading_lifecycle_service import (
    build_grading_jobs,
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
        self.assertTrue(is_successful_blueprint_job({
            "status": "completed",
            "success_count": 1,
            "processed_items": 0,
        }))


if __name__ == "__main__":
    unittest.main()
