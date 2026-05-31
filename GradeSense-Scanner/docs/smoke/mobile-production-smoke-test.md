# GradeSense Mobile Production Smoke Test

## Purpose

This smoke test verifies that the installed mobile app, scanner backend, and synced webapp data path are ready for teacher UAT. It covers the high-risk flows introduced in Phases 1-4: synced review settings, extracted student answers, Manage analytics, exam actions, and Android bundle integrity.

## Automated Local Smoke

Run from the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m tools.mobile_smoke --report docs/smoke/mobile-smoke-report.md
```

For a faster check that skips Expo Android export:

```powershell
.\backend\venv\Scripts\python.exe -m tools.mobile_smoke --skip-android-export --report docs/smoke/mobile-smoke-report-fast.md
```

To include deployed Render checks:

```powershell
$env:SMOKE_BACKEND_URL="https://gradesense-scanner-backend.onrender.com"
.\backend\venv\Scripts\python.exe -m tools.mobile_smoke --report docs/smoke/mobile-smoke-report.md
```

Required pass criteria:

- Backend unit tests pass.
- Backend compile check passes.
- Frontend utility tests pass.
- TypeScript passes.
- Targeted ESLint has zero errors.
- Expo Android export succeeds.
- Deployed `/api/health` returns healthy when `SMOKE_BACKEND_URL` is set.
- Deployed `/api/v1/system/readiness` returns `status: ready` when Render env vars are complete.

## Manual Installed-App Smoke

Use an Expo.dev installed build, not Expo Go.

### 1. Authentication

- Open the installed app.
- Log in with a real teacher account that has webapp exams.
- Expected: login succeeds and app lands on the main scanner experience.
- Expected edge: invalid credentials show a clear error and do not enter the app.

### 2. Manage Insights

- Open Manage > Insights.
- Expected: overview metrics load from the deployed scanner backend.
- Expected: synced performance cards show subject performance, top students, needs-attention students, and weak questions when data exists.
- Expected edge: if no data exists, empty states render with spacing and no overlapping text.

### 3. Manage Exams

- Open Manage > Exams.
- Expected: webapp exams appear with batch, subject, submissions, average, marks, status, and action buttons.
- Tap Review on an exam.
- Expected: review screen opens for that exam.
- Tap Publish on an unpublished exam.
- Expected: confirmation appears; after confirm, status changes to Published.
- Tap Close on an open exam.
- Expected: confirmation appears; after confirm, status changes to Closed.
- Tap Archive on a disposable test exam only.
- Expected: confirmation appears; after confirm, exam disappears from active roster.

### 4. Review Grading

- Open a graded exam/submission.
- Expected: student paper renders.
- Expected: question paper and model answer render when returned by API or available from local saved scan session.
- Expected: question rubric panel has spacing between question text, student answer, AI feedback, and score controls.
- Expected: extracted student answer appears under Student Answer when the backend has extracted text.
- Change marks and add a correction comment.
- Expected: save succeeds and values remain after reopening.

### 5. Review Settings

- Open review settings on an exam.
- Change grading mode, difficulty, feedback toggle, and custom instructions.
- Save settings.
- Reopen the same exam on mobile.
- Expected: settings persist.
- Open the webapp for the same exam.
- Expected: settings match the mobile values.

### 6. Re-Evaluations

- Open Manage > Re-evals.
- Expected: pending requests load from the backend.
- Resolve a test request with a teacher response.
- Expected: status changes after refresh and the response is visible.

### 7. Scanner Flow Regression

- Create a new exam/session.
- Capture question paper, model answer, and at least one student answer sheet.
- Upload/sync.
- Expected: sync completes and the created exam appears in Manage > Exams.
- Expected edge: blurry page warning still works.
- Expected edge: cancelling during capture does not crash or corrupt the current session.

### 8. Offline And Network Recovery

- Start the app with network disabled.
- Expected: local sessions remain visible where supported and server-only screens show retry/empty states.
- Re-enable network and pull to refresh.
- Expected: synced screens recover without restarting the app.

## Release Blockers

Do not call the mobile app production ready if any of these fail:

- Installed app cannot authenticate against deployed backend.
- Render readiness is degraded because `WEBAPP_DB_URL` or `WEBAPP_JWT_SECRET` is missing.
- Review settings do not stay synced with the webapp.
- Extracted student answers are not visible where backend data exists.
- Publish/close/archive actions mutate the wrong exam or fail silently.
- Android export or installed build fails.
- Any screen has overlapping text, clipped buttons, or inaccessible touch targets on the test phone.
