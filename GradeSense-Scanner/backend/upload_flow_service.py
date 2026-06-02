import json
from typing import Any, Optional


def merge_upload_flow_state(
    raw_state_json: str | None,
    *,
    source_paper_mode: str,
    active_job_id: Optional[str] = None,
    session_submission_ids: Optional[list[str]] = None,
    results_message: Optional[str] = None,
) -> str:
    """Merge scanner-owned sync progress into a webapp upload-flow state blob."""
    try:
        state: dict[str, Any] = json.loads(raw_state_json or "{}")
    except json.JSONDecodeError:
        state = {}

    state["sourcePaperMode"] = source_paper_mode
    if active_job_id is not None:
        state["activeJobId"] = active_job_id
    if session_submission_ids is not None:
        state["sessionSubmissionIds"] = session_submission_ids
    if results_message is not None:
        state["resultsMessage"] = results_message

    return json.dumps(state)
