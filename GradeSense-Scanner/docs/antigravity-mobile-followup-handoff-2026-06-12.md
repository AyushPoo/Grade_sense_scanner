# Antigravity Handoff: Mobile Follow-Up After Auth Fix

Date: 2026-06-12

This handoff is for continuing the remaining GradeSense mobile work in Antigravity after the immediate auth hardening patch.

## What Was Fixed In Codex

Auth-only changes were made before this handoff:

- Production builds now ignore persisted custom backend/webapp URLs and use the real GradeSense endpoints.
- The OAuth redirect route is explicitly registered in the auth stack.
- The `Completing sign in` screen now has a timeout and a visible `Back to sign in` escape path.
- Login displays a retryable error if OAuth return does not finish.
- Support/contact email in login was changed to `hello@gradesense.in`.

Files touched for auth:

- `frontend/src/config.ts`
- `frontend/app/(auth)/_layout.tsx`
- `frontend/app/(auth)/oauthredirect.tsx`
- `frontend/app/(auth)/login.tsx`

## Remaining P0: Real Sync Verification

The auth patch prevents the app from getting stuck and avoids stale release URLs, but it does not prove full webapp/mobile sync correctness.

Antigravity should continue with real-device/API verification:

1. Fresh install the new build.
2. Sign in with Google.
3. Confirm it leaves `Completing sign in`.
4. Open Manage > Exams.
5. Confirm `/api/v1/exams` loads with the authenticated token.
6. Open Manage > Roster.
7. Compare batches/students with webapp Manage Students.
8. Make a webapp roster change and verify mobile updates after refresh.
9. Make a supported mobile roster/batch change and verify webapp updates.
10. Upload a scan and verify it appears in webapp review.

If any of this fails, inspect:

- `frontend/src/api/manage.ts`
- `frontend/app/(tabs)/manage.tsx`
- `frontend/app/(tabs)/home.tsx`
- `frontend/app/(tabs)/sessions.tsx`
- `backend/server.py`
- `backend/batch_sync_service.py` if present/used

Useful command:

```powershell
rg -n "api/v1/exams|api/batches|students|fetchManaged|fetchBatchStudents|WEBAPP_DB_URL|WEBAPP_URL|proxy_webapp_json" frontend backend
```

## Remaining Scanner Issues

The user still wants these fixed:

1. Auto crop quality is still far below ML Kit / Adobe Scan in hard cases.
2. Crop can include scan stand/background/adjacent notebook page.
3. High contrast still does not look like ML Kit document enhancement.
4. Two-page mode behaves poorly:
   - landscape phone captures may not split properly
   - single page in two-page mode can be split incorrectly
   - auto crop can break two-page output
   - user wants to switch one-page/two-page mode during scanning
5. Orientation is not reliable:
   - sideways pages still occur
   - upside-down pages still occur
   - readable orientation should be corrected automatically where possible
6. Review image zoom/swipe needs ongoing regression testing:
   - zoom must not crash
   - zoom should stay bounded
   - page swiping must still work when not zoomed

## Auto Crop Direction

Do not keep blindly tuning the current classical CV detector as if it will become ML Kit. The likely next useful step is a better on-device detector or segmentation-like model, plus live preview diagnostics.

Recommended work:

- Add dev-only crop diagnostics overlay/logs:
  - detector used
  - confidence
  - accepted/rejected reason
  - crop quad
  - output size
- Build a golden real-photo test set from the user's examples.
- Evaluate whether an on-device document boundary model can run fast enough.
- Keep auto crop optional and off by default.
- Never block capture if crop is uncertain.
- Always preserve original image for fallback.

## Double-Page Requirements

Target behavior:

- If two pages are visible, split into two readable pages.
- If only one page is visible, do not split just because two-page mode is selected.
- User should be able to switch between one-page and two-page mode during scanning.
- In landscape capture, normalize image orientation before deciding split direction.
- After splitting, crop/refine each half independently.
- If confidence is low, save original/split fallback and flag page for review.

## Release Guardrail

No future AAB should be uploaded until this smoke test passes on a real device:

1. Google sign-in completes.
2. Manage > Exams loads synced exams.
3. Manage > Roster matches the webapp.
4. New Scan/Upload starts.
5. Auto capture still works.
6. Auto crop off path still works.
7. Auto crop on path does not block scanning.
8. Upload to GradeSense completes.
9. Webapp sees the uploaded exam/submissions.
10. Review tab opens without crash.

