import unittest

from batch_sync_service import (
    ACTIVE_RECORD_STATUSES,
    build_batch_exam_response,
    build_batch_response,
    build_student_roster_response,
    split_students_by_strength,
)


class BatchSyncServiceTest(unittest.TestCase):
    def test_build_batch_response_formats_active_batches(self):
        batches = build_batch_response([
            {
                "id": "batch_1",
                "name": "Class 10-A",
                "class_standard": "10",
                "section": "A",
                "status": "active",
                "student_count": 3,
            },
            {
                "id": "batch_2",
                "name": "",
                "class_standard": "11",
                "section": "B",
                "status": None,
                "student_count": 0,
            },
        ])

        self.assertEqual(ACTIVE_RECORD_STATUSES, {"", "active", "draft", "published", "closed", "graded", "processing", "uploaded"})
        self.assertEqual(batches[0]["batch_id"], "batch_1")
        self.assertEqual(batches[0]["name"], "Class 10-A")
        self.assertEqual(batches[0]["student_count"], 3)
        self.assertEqual(batches[1]["name"], "Class 11-B")

    def test_build_batch_exam_response_excludes_archived_and_deleted(self):
        exams = build_batch_exam_response([
            {
                "id": "exam_1",
                "name": "Visible",
                "subject_id": "sub_1",
                "total_marks": 50,
                "exam_date": "2026-06-03",
                "status": "graded",
                "submission_count": 2,
                "average_percentage": 70,
            },
            {
                "id": "exam_2",
                "name": "Deleted",
                "status": "deleted",
            },
            {
                "id": "exam_3",
                "name": "Archived",
                "status": "archived",
            },
        ])

        self.assertEqual([exam["id"] for exam in exams], ["exam_1"])
        self.assertEqual(exams[0]["batchId"], None)
        self.assertEqual(exams[0]["submissionCount"], 2)
        self.assertEqual(exams[0]["averagePercentage"], 70.0)

    def test_build_student_roster_response_derives_performance_from_submissions(self):
        students = build_student_roster_response([
            {
                "batch_id": "batch_1",
                "student_id": "std_0",
                "student_name": "Noor",
                "student_email": "noor@example.com",
                "student_roll_number": "6",
                "exam_id": None,
            },
            {
                "exam_id": "exam_1",
                "student_id": "std_1",
                "student_name": "Asha",
                "student_email": "asha@example.com",
                "student_roll_number": "7",
                "exam_name": "Math 1",
                "subject_name": "Math",
                "percentage": 90,
                "total_score": 45,
                "total_marks": 50,
                "exam_date": "2026-06-03",
            },
            {
                "exam_id": "exam_2",
                "student_id": "std_1",
                "student_name": "Asha",
                "student_email": "asha@example.com",
                "student_roll_number": "7",
                "exam_name": "Science 1",
                "subject_name": "Science",
                "percentage": 50,
                "total_score": 25,
                "total_marks": 50,
                "exam_date": "2026-06-01",
            },
            {
                "exam_id": "exam_1",
                "student_id": "std_2",
                "student_name": "Kabir",
                "student_email": "",
                "student_roll_number": "8",
                "exam_name": "Math 1",
                "subject_name": "Math",
                "percentage": 60,
                "total_score": 30,
                "total_marks": 50,
                "exam_date": "2026-06-03",
            },
        ])

        noor = students[0]
        self.assertEqual(noor["name"], "Noor")
        self.assertEqual(noor["examCount"], 0)
        self.assertEqual(noor["averagePercentage"], 0.0)

        asha = students[1]
        self.assertEqual(asha["student_id"], "std_1")
        self.assertEqual(asha["name"], "Asha")
        self.assertEqual(asha["examCount"], 2)
        self.assertEqual(asha["averagePercentage"], 70.0)
        self.assertEqual(asha["latestExam"]["examName"], "Math 1")
        self.assertEqual(asha["strongSubject"]["subjectName"], "Math")
        self.assertEqual(asha["weakSubject"]["subjectName"], "Science")

    def test_split_students_by_strength_uses_average_percentage(self):
        strong, weak = split_students_by_strength([
            {"name": "A", "averagePercentage": 80},
            {"name": "B", "averagePercentage": 55},
            {"name": "C", "averagePercentage": 70},
        ], limit=2)

        self.assertEqual([student["name"] for student in strong], ["A", "C"])
        self.assertEqual([student["name"] for student in weak], ["B", "C"])


if __name__ == "__main__":
    unittest.main()
