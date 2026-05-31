# Mobile Smoke Test Report

- Generated: 2026-05-31T07:49:30.909643+00:00
- Overall: FAIL

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
✔ normalizeManagedExams maps API rows into display-ready exam records (1.4718ms)
✔ normalizeManagePerformance returns stable empty arrays for partial payloads (1.2519ms)
✔ buildReviewFileSlides orders document types and adds retry tokens to signed urls (4.9138ms)
✔ buildLocalReviewFiles maps local session question, model, and active student pages (0.6834ms)
✔ normalizeReviewScores preserves extracted student answer text from existing API fields (0.3029ms)
✔ normalizeReviewSettings returns complete webapp review settings from partial API data (0.3229ms)
✔ buildReviewSettingsPayload trims instructions for API writes (0.1978ms)
✔ manage screen does not expose sandbox backdoor controls to teachers (0.7608ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 688.5583
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

### Deployed backend health: PASS

- Command: `"F:\GradeSense\Scan\GradeSense-Scanner\backend\venv\Scripts\python.exe" -c "import json, urllib.request; print(urllib.request.urlopen(\"https://gradesense-scanner-backend.onrender.com/api/health\", timeout=20).read().decode())"`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\backend`
- Exit code: `0`

```text
{"status":"healthy","timestamp":"2026-05-31T07:49:30.020442+00:00","webapp_url":"http://8.231.83.249:8000"}
```

### Deployed backend readiness: FAIL

- Command: `"F:\GradeSense\Scan\GradeSense-Scanner\backend\venv\Scripts\python.exe" -c "import json, urllib.request; print(urllib.request.urlopen(\"https://gradesense-scanner-backend.onrender.com/api/v1/system/readiness\", timeout=20).read().decode())"`
- CWD: `F:\GradeSense\Scan\GradeSense-Scanner\backend`
- Exit code: `1`

```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import json, urllib.request; print(urllib.request.urlopen("https://gradesense-scanner-backend.onrender.com/api/v1/system/readiness", timeout=20).read().decode())
                                       ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\ayush\.agents\skills\pptx\Python\pythoncore-3.14-64\Lib\urllib\request.py", line 187, in urlopen
    return opener.open(url, data, timeout)
           ~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\ayush\.agents\skills\pptx\Python\pythoncore-3.14-64\Lib\urllib\request.py", line 493, in open
    response = meth(req, response)
  File "C:\Users\ayush\.agents\skills\pptx\Python\pythoncore-3.14-64\Lib\urllib\request.py", line 602, in http_response
    response = self.parent.error(
        'http', request, response, code, msg, hdrs)
  File "C:\Users\ayush\.agents\skills\pptx\Python\pythoncore-3.14-64\Lib\urllib\request.py", line 531, in error
    return self._call_chain(*args)
           ~~~~~~~~~~~~~~~~^^^^^^^
  File "C:\Users\ayush\.agents\skills\pptx\Python\pythoncore-3.14-64\Lib\urllib\request.py", line 464, in _call_chain
    result = func(*args)
  File "C:\Users\ayush\.agents\skills\pptx\Python\pythoncore-3.14-64\Lib\urllib\request.py", line 611, in http_error_default
    raise HTTPError(req.full_url, code, msg, hdrs, fp)
urllib.error.HTTPError: HTTP Error 404: Not Found
```
