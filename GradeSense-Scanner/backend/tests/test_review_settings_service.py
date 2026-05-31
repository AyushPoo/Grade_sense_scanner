import json
import unittest

from review_settings_service import (
    build_grading_flag_payload,
    difficulty_from_state_json,
    merge_difficulty_into_state_json,
    normalize_review_settings,
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


if __name__ == "__main__":
    unittest.main()
