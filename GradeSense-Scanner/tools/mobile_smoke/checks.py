from __future__ import annotations

import os
import tempfile
from pathlib import Path

from .commands import CommandResult, run_command


def build_checks(repo_root: Path, include_android_export: bool) -> list[tuple[str, str, Path, int]]:
    backend = repo_root / "backend"
    frontend = repo_root / "frontend"
    python_bin = backend / "venv" / "Scripts" / "python.exe"
    if not python_bin.exists():
        python_bin = Path("python")

    checks: list[tuple[str, str, Path, int]] = [
        (
            "Backend unit tests",
            f'"{python_bin}" -m unittest tests.test_review_settings_service tests.test_manage_analytics_service tests.test_runtime_readiness_service',
            backend,
            60,
        ),
        (
            "Backend compile",
            f'"{python_bin}" -m py_compile server.py review_settings_service.py manage_analytics_service.py runtime_readiness_service.py',
            backend,
            60,
        ),
        (
            "Frontend unit tests",
            "node --test tests\\reviewFiles.test.cjs tests\\manageData.test.cjs",
            frontend,
            60,
        ),
        (
            "Frontend TypeScript",
            "npx tsc --noEmit",
            frontend,
            180,
        ),
        (
            "Frontend targeted lint",
            (
                'npx eslint "app/(tabs)/manage.tsx" app/review-grading.tsx '
                "src/api/manage.ts src/api/reviewSettings.ts "
                "src/components/manage/AnalyticsPerformancePanel.tsx "
                "src/components/manage/ExamManagementPanel.tsx "
                "src/components/review/PaperFileViewer.tsx "
                "src/components/review/RubricReviewPanel.tsx "
                "src/components/review/GradingControlPanel.tsx "
                "src/components/review/VoiceDictationModal.tsx "
                "src/components/review/ReviewSettingsSheet.tsx "
                "src/utils/manageData.ts src/utils/reviewFiles.ts "
                "src/utils/reviewScores.ts src/utils/reviewSettings.ts src/types/review.ts"
            ),
            frontend,
            180,
        ),
    ]

    if include_android_export:
        export_dir = Path(tempfile.gettempdir()) / "gradesense-expo-android-smoke"
        export_dir_text = str(export_dir).replace("\\", "\\\\")
        checks.append(
            (
                "Expo Android export",
                (
                    "powershell -NoProfile -ExecutionPolicy Bypass -Command "
                    f"\"$out='{export_dir_text}'; "
                    "if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }; "
                    "npx expo export --platform android --output-dir $out; "
                    "$exit=$LASTEXITCODE; "
                    "if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }; "
                    "exit $exit\""
                ),
                frontend,
                240,
            )
        )

    backend_url = os.environ.get("SMOKE_BACKEND_URL")
    if backend_url:
        checks.append(
            (
                "Deployed backend health",
                f'"{python_bin}" -c "import json, urllib.request; print(urllib.request.urlopen(\\"{backend_url.rstrip("/")}/api/health\\", timeout=20).read().decode())"',
                backend,
                45,
            )
        )
        checks.append(
            (
                "Deployed backend readiness",
                f'"{python_bin}" -c "import json, urllib.request; print(urllib.request.urlopen(\\"{backend_url.rstrip("/")}/api/v1/system/readiness\\", timeout=20).read().decode())"',
                backend,
                45,
            )
        )

    return checks


def run_checks(repo_root: Path, include_android_export: bool) -> list[CommandResult]:
    results: list[CommandResult] = []
    for name, command, cwd, timeout_seconds in build_checks(repo_root, include_android_export):
        results.append(run_command(name, command, cwd, timeout_seconds))
    return results
