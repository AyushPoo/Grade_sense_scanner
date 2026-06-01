import unittest

from manage_analytics_service import (
    build_managed_exams,
    build_question_stats,
    build_student_ranking,
    build_subject_performance,
    build_weak_student_ranking,
    normalize_exam_update_payload,
    percent,
)


class ManageAnalyticsServiceTest(unittest.TestCase):
    def test_percent_handles_missing_totals(self):
        self.assertEqual(percent(4, 5), 80.0)
        self.assertEqual(percent(4, 0), 0.0)
        self.assertEqual(percent(None, 5), 0.0)

    def test_build_student_ranking_sorts_high_to_low(self):
        ranking = build_student_ranking([
            {"student_name": "B", "student_roll_number": "2", "exam_name": "Math", "total_score": 6, "total_marks": 10},
            {"student_name": "A", "student_roll_number": "1", "exam_name": "Math", "total_score": 9, "total_marks": 10},
        ])

        self.assertEqual([item["studentName"] for item in ranking], ["A", "B"])
        self.assertEqual(ranking[0]["percentage"], 90.0)

    def test_build_weak_student_ranking_sorts_low_to_high(self):
        ranking = build_weak_student_ranking([
            {"student_name": "B", "student_roll_number": "2", "exam_name": "Math", "total_score": 6, "total_marks": 10},
            {"student_name": "A", "student_roll_number": "1", "exam_name": "Math", "total_score": 9, "total_marks": 10},
        ])

        self.assertEqual([item["studentName"] for item in ranking], ["B", "A"])

    def test_build_question_stats_sorts_weakest_first(self):
        stats = build_question_stats([
            {"question_number": "2", "question_text": "Hard", "average_score": 2, "max_marks": 10, "attempts": 3},
            {"question_number": "1", "question_text": "Easy", "average_score": 8, "max_marks": 10, "attempts": 3},
        ])

        self.assertEqual(stats[0]["questionNumber"], "2")
        self.assertEqual(stats[0]["averagePercentage"], 20.0)

    def test_build_subject_performance_formats_rows(self):
        subjects = build_subject_performance([
            {"subject_name": "Science", "exams_count": 2, "average_percentage": 72.345},
        ])

        self.assertEqual(subjects[0]["subjectName"], "Science")
        self.assertEqual(subjects[0]["averagePercentage"], 72.3)

    def test_build_managed_exams_formats_publication_and_counts(self):
        exams = build_managed_exams([
            {
                "id": "exam_1",
                "name": "Algebra Term Test",
                "batch_id": "batch_1",
                "batch_name": "Grade 8 A",
                "subject_id": "subject_1",
                "subject_name": "Math",
                "total_marks": 40,
                "exam_date": None,
                "status": None,
                "results_published": True,
                "published_at": "2026-05-01T08:00:00+00:00",
                "submission_count": 12,
                "graded_submission_count": 12,
                "average_percentage": 77.96,
            }
        ])

        self.assertEqual(exams[0]["name"], "Algebra Term Test")
        self.assertEqual(exams[0]["batchName"], "Grade 8 A")
        self.assertEqual(exams[0]["subjectName"], "Math")
        self.assertEqual(exams[0]["status"], "graded")
        self.assertEqual(exams[0]["resultsPublished"], True)
        self.assertEqual(exams[0]["submissionCount"], 12)
        self.assertEqual(exams[0]["gradedSubmissionCount"], 12)
        self.assertEqual(exams[0]["reviewReady"], True)
        self.assertEqual(exams[0]["averagePercentage"], 78.0)

    def test_normalize_exam_update_payload_trims_and_filters_values(self):
        payload = normalize_exam_update_payload({
            "name": "  Unit Test 1  ",
            "examDate": "",
            "totalMarks": "50",
            "status": "published",
            "ignored": "value",
        })

        self.assertEqual(payload, {
            "name": "Unit Test 1",
            "exam_date": None,
            "total_marks": 50.0,
            "status": "published",
        })


if __name__ == "__main__":
    unittest.main()
