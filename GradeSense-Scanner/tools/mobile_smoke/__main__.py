from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .checks import run_checks
from .reporting import write_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run GradeSense mobile production smoke checks.")
    parser.add_argument(
        "--skip-android-export",
        action="store_true",
        help="Skip Expo Android export when a faster local smoke pass is needed.",
    )
    parser.add_argument(
        "--report",
        default="docs/smoke/mobile-smoke-report.md",
        help="Markdown report path relative to the repository root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    results = run_checks(repo_root, include_android_export=not args.skip_android_export)
    report_path = repo_root / args.report
    write_report(report_path, results)

    for result in results:
        status = "PASS" if result.passed else "FAIL"
        print(f"{status}: {result.name}")
    print(f"Report: {report_path}")

    return 0 if all(result.passed for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
