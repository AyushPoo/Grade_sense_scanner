# GradeSense Mobile Handoff: Auto Crop Accuracy + Sync Reliability

Date: 2026-06-12

This handoff is for continuing work on the GradeSense mobile scanner. There are two active tracks:

1. P0: mobile app sync/auth is failing and must be fixed before more scanner releases.
2. P1: auto crop accuracy still needs a serious quality pass to approach ML Kit / Adobe Scan behavior.

The sync problem is release-blocking. No future mobile update should ship unless sign-in, synced exams, roster, upload, review, and webapp visibility are verified end to end.

## Current Critical Issue: Sync/Auth Failure

Latest user screenshots show the mobile app is not reliably connecting to the backend/webapp:

- Manage > Exams shows `Could not load synced exams` with `Network request failed`.
- Google sign-in can get stuck on `Completing sign in` while verifying the Google account.
- Mobile manage/roster data has repeatedly diverged from the webapp:
  - Webapp showed students that mobile did not show.
  - Mobile showed students/batches differently from webapp.
  - User expects any mobile change to reflect in webapp and any webapp change to reflect in mobile.

This must be treated as a P0 production reliability issue, not a UI polish issue.

## Sync Non-Negotiables

Every mobile release must prove these before upload:

- Google sign-in completes from a fresh install and from an upgraded install.
- Manage > Exams loads synced exams from the backend/webapp.
- Manage > Roster loads the same batches and students as the webapp.
- Adding/editing/deleting/archive actions in mobile either sync to webapp or are clearly disabled until supported.
- Webapp-created batches/students/exams appear in mobile after refresh.
- Mobile-created scans/uploads appear in the webapp.
- Review tab only shows relevant review-ready or pending work, not stale already-finished upload drafts.
- Backend/network failures show useful retry states and never leave the app stuck indefinitely.

If any of these fail, do not ship the AAB.

## Sync Files To Inspect First

Frontend:

- `frontend/src/config.ts`
- `frontend/app/(auth)/login.tsx`
- `frontend/app/(auth)/oauthredirect.tsx`
- `frontend/app/(auth)/callback.tsx`
- `frontend/app/(tabs)/home.tsx`
- `frontend/app/(tabs)/manage.tsx`
- `frontend/app/(tabs)/sessions.tsx`
- `frontend/src/api/manage.ts`
- `frontend/src/api/export.ts`
- `frontend/src/api/portalApi.ts`
- `frontend/src/utils/fetchWithTimeout.ts`
- `frontend/src/services/sync/syncKeys.ts`
- `frontend/src/store/scanStore.ts`
- `frontend/src/components/manage/ExamManagementPanel.tsx`

Backend:

- `backend/server.py`
- `backend/tests/test_webapp_proxy_service.py`

Useful search:

```powershell
rg -n "getBackendUrl|getWebappUrl|fetchWithTimeout|api/v1/exams|api/batches|google-idtoken|oauthredirect|Network request failed|Could not load synced exams" frontend/app frontend/src backend
```

## Sync Diagnosis Checklist

Start here before changing scanner behavior:

1. Confirm the release bundle has the correct production URLs:
   - `EXPO_PUBLIC_BACKEND_URL=https://gradesense-scanner-backend.onrender.com`
   - `EXPO_PUBLIC_WEBAPP_URL=https://app.gradesense.in`
2. Check `frontend/src/config.ts` for unsafe fallbacks. A suspicious fallback seen earlier was `http://8.231.83.249:8000`; make sure that never leaks into release behavior.
3. Verify the mobile device can reach backend health/API endpoints outside the app.
4. Verify Google sign-in returns a valid backend auth token and stores it.
5. Verify every synced request sends `Authorization: Bearer <token>`.
6. Compare mobile API paths against webapp/backend contracts:
   - Mobile uses `/api/v1/exams`
   - Mobile uses `/api/batches`
   - Mobile uses `/api/batches/{batchId}/students`
   - Mobile uses `/api/v1/analytics/overview`
7. Confirm backend proxy routes map mobile calls to the same source of truth as the webapp.
8. Add better logging/error details for `Network request failed`; currently it hides whether this is DNS, TLS, timeout, auth, proxy, or server failure.
9. Test fresh install, upgraded install, sign-out/sign-in, and expired-token recovery.

## Sync Acceptance Test Before Every AAB

Run this on a real device build, not only local TypeScript:

1. Fresh install app.
2. Sign in with Google.
3. Confirm sign-in leaves the `Completing sign in` screen.
4. Open Home and verify synced exam counts/cards load.
5. Open Manage > Exams and verify no `Network request failed`.
6. Open Manage > Roster and compare with webapp Manage Students.
7. Create a batch/student in webapp, refresh mobile, verify it appears.
8. Create or edit supported batch/student data in mobile, refresh webapp, verify it appears.
9. Start scan/upload, upload to GradeSense, verify webapp receives the exam/submission.
10. Confirm Review tab opens the correct review-ready/pending items.
11. Confirm the app handles backend down/unreachable with retry and no stuck auth loop.

## Auto Crop Current State

Auto crop has improved from the earliest broken behavior, but it is still not ML Kit / Adobe Scan quality.

Known remaining issues:

- Crop can include background, scan stand, desk, bedsheet, or adjacent notebook page.
- Tilted/diagonal pages are often missed or cropped poorly.
- Two-page mode can fail to split or crop properly, especially with landscape phone orientation.
- Some pages still rotate sideways/upside down despite rotation handling.
- High contrast can look like grayscale or overly harsh OCR binarization instead of ML Kit-style clean document enhancement.
- Manual crop preview sometimes shows a broad region rather than the true page boundary.
- The saved crop must match the preview crop. If not, users lose trust quickly.

## Auto Crop Guardrails

- Auto crop must stay optional and off by default until proven reliable.
- Auto crop must never block scanning.
- If crop confidence is low, keep the original image and allow the user to proceed.
- Do not change backend upload/finalize/grading payload contracts for crop work.
- Do not create duplicate sessions or extra drafts.
- Do not break auto capture. Continuous fast scanning is more important than forcing ML Kit's slow per-page approval UX.
- Keep original image locally when possible for fallback/debug.

## Auto Crop Files To Inspect

Likely frontend scanner/image-processing areas:

```powershell
rg -n "auto.?crop|crop|document|edge|contour|perspective|scan|capture|split|orientation|rotate|contrast|binar" frontend
```

Known active files from recent work:

- `frontend/app/scanner.tsx`
- `frontend/app/page-preview.tsx`
- `frontend/app/session-setup.tsx`
- `frontend/src/store/scanStore.ts`
- Any native modules or image-processing utilities referenced by scanner/page preview.

## Auto Crop Technical Direction

The current pipeline should not be treated as final. It is still mostly classical CV plus experimental document detection/refinement, not a trained ML Kit-level detector.

Next serious steps:

1. Add crop diagnostics in development builds:
   - detector name
   - confidence
   - crop applied true/false
   - rejection reason
   - quad coordinates
   - output size/aspect ratio
2. Build a golden test set from the user's real photos/screenshots:
   - white paper on dark desk
   - white paper on light bedsheet
   - notebook spiral pages
   - stand-mounted overhead captures
   - diagonal/tilted pages
   - shadows/folds/wrinkles
   - landscape two-page scans
   - single page accidentally captured in two-page mode
3. Add a live crop preview that reflects the actual crop that will be saved.
4. Improve detector selection:
   - page segmentation/document boundary model if a suitable on-device model is found
   - line/edge fitting as fallback
   - contour-based detection only when confidence is high
5. Improve two-page mode:
   - normalize landscape orientation before split
   - decide whether the image really contains one page or two pages
   - allow switching one-page/two-page mode while scanning
   - crop/refine each split half after splitting
6. Improve orientation:
   - use OCR/text orientation where available
   - rotate to readable orientation before review
   - if uncertain, mark page for review instead of silently saving sideways
7. Improve enhancement separately from crop:
   - mild white balance
   - shadow correction
   - local contrast normalization
   - avoid making default high contrast look like harsh OCR binary output

## Auto Crop Acceptance Test

Before saying auto crop is fixed, verify:

1. Auto crop off by default on fresh install.
2. Manual scanning and auto capture still work smoothly with auto crop off.
3. Auto crop on captures a page and produces a sane cropped result.
4. Bad detection falls back to original image.
5. Tilted/diagonal page is cropped or clearly left unchanged, never badly cropped.
6. Stand-mounted overhead scans do not include stand/background when a clear page exists.
7. Two-page mode can produce two readable individual pages when two pages are present.
8. Two-page mode does not forcibly split a single page.
9. Multi-page scan creates one session, not duplicates.
10. Upload/finalize works after cropped scans.
11. Upload/finalize works after uncropped scans.
12. Backend receives the same expected fields as before.

## Recent Build Context

Latest local AAB from the previous pass:

```text
frontend/builds/GradeSense-1.0.30-38-review-zoom-postsplit-crop.aab
```

Version:

```text
versionName 1.0.30
versionCode 38
```

Recent changes in that build included:

- Bottom navigation second tab renamed to `Review`.
- Home CTA changed to `New Scan/Upload`.
- Some review/preview zoom crash hardening.
- Two-page split path refined so each split half can be post-cropped when auto crop is enabled.

Important limitation: that build does not make the detector ML Kit quality. It only improves a specific failure path where two-page split halves were keeping background because crop refinement was not run after splitting.

## Build Notes

Use the local build script rather than raw Gradle, because signing/env setup is handled there:

```powershell
cd F:\GradeSense\Scan\GradeSense-Scanner\frontend
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-local.ps1
```

Type check:

```powershell
cd F:\GradeSense\Scan\GradeSense-Scanner\frontend
npm.cmd exec -- tsc --noEmit
```

## Current Worktree Note

At handoff time, the worktree had existing uncommitted frontend changes. Do not revert them unless the user explicitly asks.

Observed modified files:

```text
frontend/android/app/build.gradle
frontend/app.json
frontend/app/(tabs)/_layout.tsx
frontend/app/(tabs)/home.tsx
frontend/app/(tabs)/profile.tsx
frontend/app/(tabs)/sessions.tsx
frontend/app/page-preview.tsx
frontend/app/scanner.tsx
frontend/app/session-setup.tsx
frontend/src/components/manage/AnalyticsPerformancePanel.tsx
```

## Recommended Next Action

Do not start with another crop tweak. Start with sync/auth triage:

1. Reproduce `Network request failed` on the same AAB.
2. Inspect runtime resolved backend/webapp URLs.
3. Inspect auth token storage and request headers.
4. Compare mobile manage endpoints with webapp data source.
5. Add a mandatory mobile sync smoke test checklist to the release process.
6. Only after sync is green, continue auto crop model/detector work.

