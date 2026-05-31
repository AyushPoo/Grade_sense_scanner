# Mobile Smoke Test Report

- Generated: 2026-05-31T07:49:57.022746+00:00
- Overall: PASS

### Backend unit tests: PASS

- Command: `"F:\GradeSense\Scan\GradeSense-Scanner\backend\venv\Scripts\python.exe" -m unittest tests.test_review_settings_service tests.test_manage_analytics_service tests.test_runtime_readiness_service`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\backend`
- Exit code: `0`

```text
.............
----------------------------------------------------------------------
Ran 13 tests in 0.002s

OK
```

### Backend compile: PASS

- Command: `"F:\GradeSense\Scan\GradeSense-Scanner\backend\venv\Scripts\python.exe" -m py_compile server.py review_settings_service.py manage_analytics_service.py runtime_readiness_service.py`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\backend`
- Exit code: `0`

```text

```

### Frontend unit tests: PASS

- Command: `node --test tests\reviewFiles.test.cjs tests\manageData.test.cjs`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\frontend`
- Exit code: `0`

```text
✔ normalizeManagedExams maps API rows into display-ready exam records (2.6484ms)
✔ normalizeManagePerformance returns stable empty arrays for partial payloads (1.5929ms)
✔ buildReviewFileSlides orders document types and adds retry tokens to signed urls (4.3146ms)
✔ buildLocalReviewFiles maps local session question, model, and active student pages (1.7077ms)
✔ normalizeReviewScores preserves extracted student answer text from existing API fields (0.324ms)
✔ normalizeReviewSettings returns complete webapp review settings from partial API data (0.3358ms)
✔ buildReviewSettingsPayload trims instructions for API writes (0.1978ms)
✔ manage screen does not expose sandbox backdoor controls to teachers (0.912ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 648.0946
```

### Frontend TypeScript: PASS

- Command: `npx tsc --noEmit`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\frontend`
- Exit code: `0`

```text

```

### Frontend targeted lint: PASS

- Command: `npx eslint "app/(tabs)/manage.tsx" app/review-grading.tsx src/api/manage.ts src/api/reviewSettings.ts src/components/manage/AnalyticsPerformancePanel.tsx src/components/manage/ExamManagementPanel.tsx src/components/review/PaperFileViewer.tsx src/components/review/RubricReviewPanel.tsx src/components/review/GradingControlPanel.tsx src/components/review/VoiceDictationModal.tsx src/components/review/ReviewSettingsSheet.tsx src/utils/manageData.ts src/utils/reviewFiles.ts src/utils/reviewScores.ts src/utils/reviewSettings.ts src/types/review.ts`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\frontend`
- Exit code: `0`

```text

```

### Expo Android export: PASS

- Command: `powershell -NoProfile -ExecutionPolicy Bypass -Command "$out='C:\\Users\\ayush\\AppData\\Local\\Temp\\gradesense-expo-android-smoke'; if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }; npx expo export --platform android --output-dir $out; $exit=$LASTEXITCODE; if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }; exit $exit"`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\frontend`
- Exit code: `0`

```text
node_modules\@react-navigation\elements\lib\module\assets\back-icon-mask.png (653 B)
node_modules\@react-navigation\elements\lib\module\assets\back-icon.png (4 variations | 152 B)
node_modules\@react-navigation\elements\lib\module\assets\clear-icon.png (4 variations | 425 B)
node_modules\@react-navigation\elements\lib\module\assets\close-icon.png (4 variations | 235 B)
node_modules\@react-navigation\elements\lib\module\assets\search-icon.png (4 variations | 599 B)
node_modules\expo-router\assets\arrow_down.png (9.46 kB)
node_modules\expo-router\assets\error.png (469 B)
node_modules\expo-router\assets\file.png (138 B)
node_modules\expo-router\assets\forward.png (188 B)
node_modules\expo-router\assets\pkg.png (364 B)
node_modules\expo-router\assets\sitemap.png (465 B)
node_modules\expo-router\assets\unmatched.png (4.75 kB)

› android bundles (1):
_expo/static/js/android/entry-39995dbafa947316a79481a285ab2b9f.hbc (5.09 MB)

› Files (1):
metadata.json (3.03 kB)

Exported: C:\\Users\\ayush\\AppData\\Local\\Temp\\gradesense-expo-android-smoke
```
