import unittest

from review_identity_service import normalize_review_student_identity


class ReviewIdentityServiceTest(unittest.TestCase):
    def test_uses_roster_identity_when_student_id_matches(self):
        identity = normalize_review_student_identity(
            {
                "student_id": "stu_1",
                "student_name": "Wrong OCR Name",
                "student_roll_number": "",
                "roster_student_name": "Asha Rao",
                "roster_student_roll_number": "12",
            },
            ordinal=1,
        )

        self.assertEqual(identity.student_name, "Asha Rao")
        self.assertEqual(identity.student_roll_number, "12")
        self.assertEqual(identity.matched_student_id, "stu_1")

    def test_keeps_roll_number_identity_even_without_roster_name(self):
        identity = normalize_review_student_identity(
            {
                "student_id": None,
                "student_name": "Asha Rao",
                "student_roll_number": "12",
                "roster_student_name": None,
                "roster_student_roll_number": None,
            },
            ordinal=2,
        )

        self.assertEqual(identity.student_name, "Asha Rao")
        self.assertEqual(identity.student_roll_number, "12")

    def test_unlinked_extracted_name_falls_back_to_stable_student_label(self):
        identity = normalize_review_student_identity(
            {
                "student_id": None,
                "student_name": "SHARMILA PUSHPARAJ",
                "student_roll_number": "",
                "roster_student_name": None,
                "roster_student_roll_number": None,
            },
            ordinal=3,
        )

        self.assertEqual(identity.student_name, "Student #3")
        self.assertEqual(identity.student_roll_number, "")
        self.assertIsNone(identity.matched_student_id)

    def test_keeps_existing_generic_label_for_unlinked_submission(self):
        identity = normalize_review_student_identity(
            {
                "student_id": None,
                "student_name": "Student #1",
                "student_roll_number": "",
                "roster_student_name": None,
                "roster_student_roll_number": None,
            },
            ordinal=1,
        )

        self.assertEqual(identity.student_name, "Student #1")


if __name__ == "__main__":
    unittest.main()
