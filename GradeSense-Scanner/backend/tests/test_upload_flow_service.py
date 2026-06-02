import json
import unittest

from upload_flow_service import merge_upload_flow_state


class UploadFlowServiceTest(unittest.TestCase):
    def test_merge_upload_flow_state_preserves_form_and_records_submissions(self):
        state_json = merge_upload_flow_state(
            '{"form":{"name":"Exam F"},"activeJobId":"","sessionSubmissionIds":[]}',
            source_paper_mode="combined_model_answer",
            session_submission_ids=["sbm_1", "sbm_2"],
            results_message="Question extraction failed.",
        )

        state = json.loads(state_json)
        self.assertEqual(state["form"], {"name": "Exam F"})
        self.assertEqual(state["sourcePaperMode"], "combined_model_answer")
        self.assertEqual(state["sessionSubmissionIds"], ["sbm_1", "sbm_2"])
        self.assertEqual(state["resultsMessage"], "Question extraction failed.")

    def test_merge_upload_flow_state_recovers_from_invalid_json(self):
        state_json = merge_upload_flow_state(
            "{bad json",
            source_paper_mode="separate",
            active_job_id="job_1",
        )

        state = json.loads(state_json)
        self.assertEqual(state["sourcePaperMode"], "separate")
        self.assertEqual(state["activeJobId"], "job_1")


if __name__ == "__main__":
    unittest.main()
