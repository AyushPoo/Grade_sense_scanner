import json
import unittest

from review_settings_service import (
    build_question_improvement_pattern_json,
    build_grading_flag_payload,
    difficulty_from_state_json,
    merge_difficulty_into_state_json,
    merge_pilot_review_first_into_state_json,
    normalize_review_settings,
    pilot_review_first_from_state_json,
)


class ReviewSettingsServiceTest(unittest.TestCase):
    def test_normalize_review_settings_defaults_invalid_values(self):
        settings = normalize_review_settings({
            "gradingMode": "extreme",
            "feedbackEnabled": False,
            "difficulty": "wild",
            "customInstructions": "Check working.",
        })

        self.assertEqual(settings["gradingMode"], "balanced")
        self.assertEqual(settings["feedbackEnabled"], False)
        self.assertEqual(settings["difficulty"], "medium")
        self.assertEqual(settings["customInstructions"], "Check working.")

    def test_merge_difficulty_preserves_existing_flow_state(self):
        state_json = merge_difficulty_into_state_json('{"currentStep":3}', "hard")

        self.assertEqual(json.loads(state_json), {"currentStep": 3, "difficulty": "hard"})
        self.assertEqual(difficulty_from_state_json(state_json), "hard")

    def test_build_grading_flag_payload_contains_exam_and_settings(self):
        payload = json.loads(build_grading_flag_payload("exam_1", {"gradingMode": "strict"}, "Bad rubric"))

        self.assertEqual(payload["source"], "mobile_scanner")
        self.assertEqual(payload["examId"], "exam_1")
        self.assertEqual(payload["reason"], "Bad rubric")
        self.assertEqual(payload["settings"]["gradingMode"], "strict")

    def test_build_question_improvement_pattern_json_captures_reusable_correction(self):
        payload = json.loads(build_question_improvement_pattern_json({
            "scoreId": "qsc_1",
            "questionId": "qi_1",
            "questionNumber": "2",
            "questionText": "Explain trial balance.",
            "studentAnswerText": "Debit and credit totals should match.",
            "aiGrade": 6,
            "expectedGrade": 8,
            "maxMarks": 10,
            "aiFeedback": "Partial answer.",
            "teacherCorrection": "Award method marks when both totals are compared correctly.",
        }))

        self.assertEqual(payload["source"], "mobile_scanner")
        self.assertEqual(payload["type"], "question_grading_correction")
        self.assertEqual(payload["scoreId"], "qsc_1")
        self.assertEqual(payload["questionId"], "qi_1")
        self.assertEqual(payload["questionNumber"], "2")
        self.assertEqual(payload["aiGrade"], 6)
        self.assertEqual(payload["expectedGrade"], 8)
        self.assertEqual(payload["maxMarks"], 10)
        self.assertEqual(payload["teacherCorrection"], "Award method marks when both totals are compared correctly.")
        self.assertTrue(payload["applyToFuture"])

    def test_pilot_review_first_state_json_uses_webapp_flag_name(self):
        state_json = merge_pilot_review_first_into_state_json(
            '{"form":{"gradingMode":"strict"},"pilotReviewFirst":false}',
            True,
        )

        state = json.loads(state_json)
        self.assertTrue(state["pilotReviewFirst"])
        self.assertEqual(state["form"]["gradingMode"], "strict")
        self.assertTrue(pilot_review_first_from_state_json(state_json))


if __name__ == "__main__":
    unittest.main()
