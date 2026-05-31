# GradeSense Mobile UAT Plan

## Goal

Validate that GradeSense Scanner is production-ready as a synced teacher mobile client for the webapp. The mobile app should let teachers scan, review, inspect extracted answers, manage exams, and use analytics without relying on local-only data for webapp-owned workflows.

## Test Environment

- Mobile build: Expo.dev installed build.
- Backend: deployed scanner backend on Render.
- Webapp database: Neon configured through `WEBAPP_DB_URL`.
- Authentication: real teacher account from the webapp.
- Required backend readiness: `/api/v1/system/readiness` returns `status: ready`.

## Test Data

Create or identify:

- One teacher account with at least two classes/batches.
- One subject with multiple graded exams.
- One exam with question paper, model answer, and at least two student submissions.
- One submission with extracted student-answer text.
- One unpublished exam for publish testing.
- One disposable exam for archive testing.
- One student re-evaluation request.

## Acceptance Criteria

- Mobile login works using real teacher credentials.
- Manage screens reflect webapp data after refresh.
- Review settings update the shared webapp source of truth.
- Review screen shows student paper, available QP/model files, rubric, extracted student answer, marks, and feedback with readable spacing.
- Exam publish, close, and archive actions succeed with confirmation and refresh correctly.
- Scanner upload creates/syncs a webapp exam and appears in Manage.
- App handles empty states, network loss, invalid tokens, and retry without crashing.
- Android installed build has no production-blocking visual defects.

## UAT Scenarios

### UAT-01: Login And Session Restore

Steps:

1. Install the Expo.dev Android build.
2. Open the app.
3. Log in with a valid teacher account.
4. Kill and reopen the app.

Expected:

- Login succeeds.
- Teacher stays signed in after restart.
- If token is invalid or expired, the app returns to login and does not show private data.

### UAT-02: Insights Dashboard

Steps:

1. Open Manage > Insights.
2. Pull to refresh.
3. Compare exam count, submissions, reviewed count, and average with webapp data.

Expected:

- Metrics match the webapp-backed data.
- Subject, top-student, weak-student, and weak-question sections render.
- Empty data renders clean empty states.

### UAT-03: Exam Management

Steps:

1. Open Manage > Exams.
2. Review an exam.
3. Publish an unpublished exam.
4. Close a test exam.
5. Archive a disposable exam.
6. Refresh and compare with the webapp.

Expected:

- Review opens the correct exam.
- Publish changes result visibility.
- Close marks the exam as closed without deleting submissions.
- Archive removes the exam from the active mobile roster without destroying historical records.
- Webapp reflects the changed state.

### UAT-04: Review Grading

Steps:

1. Open a submission from Manage > Exams.
2. Swipe through available paper files.
3. Inspect the rubric panel.
4. Change a score and add a teacher correction.
5. Save and reopen the same submission.

Expected:

- Student answer sheet renders.
- QP/model render when API or local saved files are available.
- Extracted Student Answer is visible when present.
- Layout has comfortable spacing and no congested text.
- Score/comment changes persist.

### UAT-05: Synced Review Settings

Steps:

1. Open review settings for an exam.
2. Change grading mode, difficulty, feedback toggle, and custom instructions.
3. Save.
4. Reopen settings in mobile.
5. Open the same exam in the webapp.

Expected:

- Settings persist on mobile.
- Webapp reflects the same settings.
- A failed save shows an error and does not pretend success.

### UAT-06: Scanner Upload Sync

Steps:

1. Start a new scan session.
2. Capture question paper pages.
3. Capture model answer pages.
4. Capture two student answer sheets.
5. Upload/sync.
6. Open Manage > Exams.

Expected:

- Capture flow remains stable.
- Blurry pages warn the user.
- Upload completes.
- The synced exam appears in Manage and can be reviewed.

### UAT-07: Re-Evaluation Handling

Steps:

1. Open Manage > Re-evals.
2. Select a pending request.
3. Approve or reject with a teacher response.
4. Refresh.

Expected:

- Request resolves successfully.
- Status and teacher response remain visible after refresh.

### UAT-08: Network And Error Recovery

Steps:

1. Disable network.
2. Open Manage > Insights and Manage > Exams.
3. Re-enable network.
4. Pull to refresh.

Expected:

- App does not crash.
- Server-backed screens show clear recovery states.
- Data refreshes once network returns.

### UAT-09: Visual And Accessibility Pass

Steps:

1. Check login, scanner, sessions, Manage, review, settings, and modal screens.
2. Use a small Android phone viewport and a larger Android viewport if available.
3. Check long exam names, long student names, and long extracted answers.

Expected:

- Text does not overlap or clip.
- Buttons have adequate spacing and touch targets.
- Modals are readable and dismissible.
- Empty/loading/error states look intentional.

## Edge Case Matrix

| Area | Edge Case | Expected Result |
| --- | --- | --- |
| Auth | Expired token | App requires login and does not show private data |
| Auth | Wrong teacher opens another teacher exam | Backend returns 404/401; mobile shows failure |
| Manage | No exams | Empty state with Create Exam action |
| Manage | Very long exam name | Text wraps/clamps without overlap |
| Manage | Publish already published exam | Publish action is disabled |
| Manage | Close already closed exam | Close action is disabled |
| Review | Missing QP/model files | Student paper still works; missing files show readable state |
| Review | No extracted answer | Student Answer block is hidden |
| Review | Very long extracted answer | Text wraps with spacing |
| Review | Save fails | Error is shown; UI does not claim success |
| Scanner | Blurry page | Warning appears before upload |
| Scanner | Upload interruption | Session remains recoverable |
| Network | Offline startup | No crash; retry works after reconnect |

## Sign-Off Checklist

- Automated smoke test report is attached.
- Render backend readiness is `ready`.
- UAT scenarios UAT-01 through UAT-09 pass.
- No release blockers remain.
- Secrets pasted during development have been rotated.
- Tester signs off with device model, Android version, build URL, backend URL, and date.
