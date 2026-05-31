from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .commands import CommandResult


def format_result(result: CommandResult) -> str:
    status = "PASS" if result.passed else "FAIL"
    tail = "\n".join(result.output.strip().splitlines()[-20:])
    return (
        f"### {result.name}: {status}\n\n"
        f"- Command: `{result.command}`\n"
        f"- CWD: `{result.cwd}`\n"
        f"- Exit code: `{result.exit_code}`\n\n"
        "```text\n"
        f"{tail}\n"
        "```\n"
    )


def write_report(report_path: Path, results: list[CommandResult]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    overall = "PASS" if all(result.passed for result in results) else "FAIL"
    body = [
        "# Mobile Smoke Test Report",
        "",
        f"- Generated: {datetime.now(timezone.utc).isoformat()}",
        f"- Overall: {overall}",
        "",
        *[format_result(result) for result in results],
    ]
    report_path.write_text("\n".join(body), encoding="utf-8")
