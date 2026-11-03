# KWD Document Center: Upload Audit & Transport Analysis (Phase 0)

**Date:** 2026-10-30  
**Repository Branch:** `feature/kwd-fullstack-modernization` (Base Commit: `fa3b421`)  
**Deliverable:** Upload Experience Roadmap Phase 0 Audit Report  
**Target Milestone:** Drag-and-Drop Staging, In-Memory Queue, and Progress Toast  

---

## 1. Executive Summary

This audit assesses the current state of document upload infrastructure across the KWD Document Center codebase. The objective is to confirm the assumptions in Section 2 of the *Upload Experience Roadmap*, map the end-to-end file journey, evaluate host platform constraints (Vercel serverless limits), evaluate the testing environment, examine Google OAuth error handling, and recommend the transport architecture for Phase 2.

### Key Conclusions:
1. **Section 2 Assumptions Confirmed**:
   - Neither `batch-upload-review.tsx` nor `folder-upload-review.tsx` implement drag-and-drop event handlers. Dropping files onto the browser window triggers default browser navigation, causing the app to unload.
   - Cross-tab/window drags carrying plain text or URLs are not intercepted or filtered.
   - Folder uploads rely exclusively on `webkitdirectory` via native file input picker.
   - Batch limits (25 files) and concurrency (3 simultaneous uploads) are already established in client constants.
2. **Vercel Serverless Function Limit & File Sizes**:
   - Vercel enforces an unconfigurable **4.5 MB (4,718,592 bytes)** request body ceiling on Serverless Function invocations.
   - The application currently enforces `defaultAdminUploadMaxBytes = 4 * 1024 * 1024` (4 MiB), leaving ~500 KB headroom for multipart form boundary overhead.
   - As documented in `docs/02-requirements.md` and `docs/11-deployment.md`, 4 MiB is currently **[CONFIRMED]** for typical KWD office documents and scanned PDF records. If KWD staff require files exceeding 4.5 MB, an architectural pivot to direct browser-to-Google Drive resumable uploads (Option 2) will be required.
3. **Transport Recommendation for Phase 2**:
   - For uploads <= 4 MiB: Utilize **`XMLHttpRequest` (XHR)** against the Next.js API route (`/api/documents`) to stream native per-file upload progress (`upload.onprogress`), followed by an explicit `PROCESSING` state during Google Drive and Supabase registry finalization.
   - The shared queue architecture must decouple the transport adapter so that a direct-to-Drive resumable session adapter can be swapped in without modifying queue or toast UI components if higher limits are approved.
4. **Testing Infrastructure**:
   - The repository uses Node.js's native test runner (`tsx --test`) and JSDOM (`@testing-library/react`).
   - **Playwright is not installed** in the repository. Introducing Playwright would add external dependencies and browser binaries, which requires explicit owner approval under Rule 7. Drag events can be reliably simulated in existing JSDOM test suites using synthetic `DataTransfer` events.
5. **Google OAuth Expiry UX Vulnerability**:
   - When Google OAuth refresh tokens expire or are revoked, `classifyDriveError` maps HTTP 401/403 to `FORBIDDEN`, which the upload service wraps as `"Google Drive upload recovery is pending. Retry this submission with the same idempotency key."` (HTTP 502/503).
   - This masks the true root cause, leading staff into infinite futile retry loops instead of alerting an administrator that re-authorization is required at `/admin`.

---

## 2. Verification of Section 2 Roadmap Assumptions

| Assumption in Section 2 | Code Verification Status | Evidence in Codebase |
|---|---|---|
| **Dropzone missing drag handlers** | **CONFIRMED** | [`src/components/documents/batch-upload-review.tsx`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/components/documents/batch-upload-review.tsx#L125-L136) wraps `<input type="file" multiple>` in `<label className="upload-dropzone">` without `onDragEnter`, `onDragOver`, `onDragLeave`, or `onDrop`. |
| **Window drops navigate away** | **CONFIRMED** | Without a window-level `dragover`/`drop` handler calling `event.preventDefault()`, dropping any file outside a raw input causes the browser to open the file in-place. |
| **Folder drop unsupported** | **CONFIRMED** | [`src/components/documents/folder-upload-review.tsx`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/components/documents/folder-upload-review.tsx#L335) applies `{ webkitdirectory: "" }` to an `<input type="file">`. No FileSystem directory entry drop listener (`webkitGetAsEntry`) exists. |
| **Cross-tab text/URL drags unfiltered** | **CONFIRMED** | No validation of `dataTransfer.items[i].kind === 'file'`. Drops containing URLs or text would trigger default browser drop behavior or runtime errors. |
| **Folder upload features reusable** | **CONFIRMED** | [`src/lib/documents/folder-upload-retry.ts`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/lib/documents/folder-upload-retry.ts), [`folder-upload-csv.ts`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/lib/documents/folder-upload-csv.ts), and [`folder-upload-bulk.ts`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/lib/documents/folder-upload-bulk.ts) implement tested idempotency, retry classification, and CSV preview/apply logic. |
| **Batch limit is 25 files** | **CONFIRMED** | [`src/lib/documents/batch-upload-types.ts`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/lib/documents/batch-upload-types.ts#L5) declares `export const maximumBatchUploadFiles = 25;`. [`folder-upload-validation.ts`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/lib/documents/folder-upload-validation.ts#L6) sets `maxFiles: 25`. |
| **Google Drive OAuth scope** | **CONFIRMED** | [`src/lib/google/drive-oauth.ts`](file:///home/cjk/orca/workspaces/kwd-document-center/kwd-fullstack-modernization/src/lib/google/drive-oauth.ts#L5) defines `driveOAuthScope = "https://www.googleapis.com/auth/drive.file"` using offline refresh token credentials. |

---

## 3. End-to-End File Journey (Current Flow)

```
[Browser / Client]
  1. User selects files via <input type="file" multiple>
  2. Batch review stages files: creates localId, suggestedSubject, and crypto.randomUUID() idempotencyKey
  3. User reviews/edits metadata (category, date, subject, persons)
  4. User clicks "Upload ready files"
  5. runBatchUploadQueue() spawns up to 3 concurrent workers calling submitOne():
     fetch("/api/documents", { method: "POST", body: formData })
        ↓
[Next.js API Route: /api/documents (POST)]
  6. Runtime: Node.js (src/app/api/documents/route.ts)
  7. Auth & Authorization: getAuthorization() validates Supabase JWT, checks active status, requires STAFF or ADMIN
  8. CSRF Protection: isSameOrigin() verifies Origin or Referer header matches Host
  9. Form Parsing: request.formData() extracts file & metadata fields
 10. Server Validation: validateAdminUploadForm()
     - Max size: <= 4 MiB (getAdminUploadMaxBytes)
     - Extension & MIME: matches controlled allowlist
     - Magic Bytes: inspects binary signatures (PDF %PDF, Word OLE/ZIP, JPEG, PNG, etc.)
     - SHA-256 Hash: calculates fileSha256
     - Duplicate Check: checks repository.checkDuplicate() for matching hash or number
        ↓
[State Machine: UploadAttemptRepository (Supabase)]
 11. Idempotency Check: queries upload_attempts by idempotency_key
     - If COMPLETE: returns existing document record (reused: true)
     - If PENDING_REGISTRY: attempts finalization
     - If new: creates upload_attempts row with status = 'PENDING_UPLOAD'
 12. Id Reservation: claims operation_token, calls drive.generateFileId() to pre-allocate Drive ID
 13. Persists drive_file_id in upload_attempts and transitions status to 'UPLOADING'
        ↓
[Google Drive API Service]
 14. Calls drive.files.create({ requestBody: { id: driveFileId, ... }, media: { body: stream }, uploadType: "resumable" })
 15. If network drops: recoverCreatedFile() checks for eventual-consistency same-ID 409
 16. On success: transitions upload_attempts status to 'PENDING_REGISTRY'
        ↓
[Registry Finalization]
 17. Inserts canonical record into documents table in Supabase
 18. Transitions upload_attempts status to 'COMPLETE'
 19. Returns HTTP 201 Created with { document, reused: false }
        ↓
[Client UI Response]
 20. Row updates: status = 'UPLOADED', documentId assigned
 21. Row errors: status = 'FAILED', displays error message, activates "Retry" button
```

---

## 4. Payload Size Limits & Transport Options Analysis

### The Constraint
- **Vercel Serverless Function Payload Limit**: Hard cap at **4.5 MB (4,718,592 bytes)**. Requests exceeding 4.5 MB receive an immediate `413 Payload Too Large` from Vercel's edge proxy before hitting application code.
- **Current App Ceiling**: `defaultAdminUploadMaxBytes = 4 * 1024 * 1024` (4 MiB = 4,194,304 bytes).
- **Multipart Form Overhead**: Adding boundary headers, field names, and disposition adds approximately 1.5–3 KB, totaling ~4,197,000 bytes. This safely clears the 4.5 MB edge ceiling by ~520 KB.

### Comparison of Transport Architectures for Phase 2

| Metric / Requirement | Option A: In-Server via XMLHttpRequest (Recommended) | Option B: Direct Browser-to-Drive Resumable Upload | Option C: Chunked Upload through Server |
|---|---|---|---|
| **Max File Size** | 4.0 MiB (current confirmed limit) | Up to 100+ MB (limited by Drive quota) | Up to 50 MB |
| **Vercel Limit Risk** | Zero (guaranteed <= 4 MiB) | Zero (payload bypasses Vercel) | Low (chunks <= 3 MB) |
| **Upload Progress** | Native `xhr.upload.onprogress` | Native `xhr.upload.onprogress` | Synthetic chunk progression |
| **Security & Validation** | Server verifies MIME, magic bytes, hash, and duplicates before Drive creation | Client receives authenticated session URI; server can only validate after upload completes | Server validates chunk fragments; complex server assembly |
| **Drive Credentials** | 100% server-side; client never touches Google endpoints | Server mints short-lived resumable session URI; client communicates directly with `googleapis.com` | 100% server-side |
| **Architecture Complexity** | Low (drop-in replacement for `fetch`) | High (two-step handshake, CORS configuration on Drive, post-upload registry RPC) | High (temporary chunk storage, reassembly, orphan cleanup) |
| **Recommendation** | **Adopt for Phase 2** | Defer until KWD explicitly requires files > 4.5 MB | Not recommended |

**Phase 2 Decision**: Implement the queue and progress engine using **Option A (XMLHttpRequest to `/api/documents`)**. Structure the `UploadTransport` interface so that if KWD answers Open Question 1 with a requirement for > 4.5 MB files, an Option B direct-drive adapter can be introduced seamlessly.

---

## 5. Testing Environment & Drag Simulation Analysis

1. **Current Test Framework**:
   - Test runner: Native Node.js test runner (`tsx --test`) invoked via `npm test`.
   - DOM simulation: JSDOM (`jsdom`) combined with `@testing-library/react`.
   - Existing suite: **362 tests** (357 passing, 5 skipped for local destructive DB runs, 0 failures).
2. **Playwright Status**:
   - **Playwright is not installed** in `package.json`.
   - Rule 7 states: *"New dependencies need owner approval."*
   - Installing `@playwright/test` would introduce large browser binaries and external dependencies.
3. **Simulating Drag Events in the Existing Stack**:
   - In JSDOM, HTML5 drag-and-drop can be tested with full fidelity using `@testing-library/react`'s `fireEvent`:
     ```ts
     const file = new File(["dummy content"], "test.pdf", { type: "application/pdf" });
     const dataTransfer = {
       files: [file],
       items: [
         {
           kind: "file",
           type: "application/pdf",
           getAsFile: () => file,
           webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, file: (cb) => cb(file) }),
         },
       ],
       types: ["Files"],
     };
     fireEvent.dragEnter(dropzone, { dataTransfer });
     fireEvent.dragOver(dropzone, { dataTransfer });
     fireEvent.drop(dropzone, { dataTransfer });
     ```
   - This approach tests:
     - Drag counter increments/decrements (preventing flicker across child elements).
     - Filtering non-file drags (text, URLs).
     - Dropping duplicate files, over-limit files, and unsupported types.
     - Folder hierarchy traversal via `webkitGetAsEntry()`.
   - **Recommendation**: Write Phase 1–5 unit and component tests using JSDOM and `@testing-library/react`. If the owner specifically requests end-to-end browser verification, request approval to add Playwright in a subsequent phase.

---

## 6. Device & Browser Landscape

1. **Desktop Browsers**:
   - **Google Chrome & Microsoft Edge (Chromium)**: Full native support for HTML5 Drag and Drop, `dataTransfer.items`, `webkitGetAsEntry()`, and `webkitdirectory`.
   - **Mozilla Firefox**: Full support for Drag and Drop and folder dropping (`webkitGetAsEntry` supported in modern Firefox).
   - **Apple Safari**: Full support for Drag and Drop; directory traversal supported in Safari 11.1+.
2. **Mobile & Tablet Devices (iOS / Android)**:
   - **Physical Constraint**: Mobile touch operating systems do not provide desktop file explorer windowing or drag-to-browser interactions.
   - **Keyboard & Mobile Path**: The roadmap's decision to preserve `<input type="file">` wrapped in the accessible label ensures that mobile users can seamlessly trigger their native system document picker, photo library, or camera.
   - **Accessibility**: Meeting WCAG 2.1 AA and WCAG 2.2 (Success Criterion 2.5.7 Dragging Movements) requires that any action achievable by dragging must have a single-pointer / click alternative.

---

## 7. Google OAuth Token Expiry UX Analysis

1. **Failure Pathway**:
   - If the refresh token in `GOOGLE_DRIVE_REFRESH_TOKEN` expires, is revoked, or has invalid scopes:
     - Google OAuth client throws an error with HTTP status 401/403.
     - `classifyDriveError()` in `src/lib/google/drive-types.ts` classifies it as `FORBIDDEN`.
     - `uploadAdminDocument()` maps `FORBIDDEN` to:
       ```ts
       throw new DocumentUploadError(
         "DRIVE_ERROR",
         "Google Drive upload recovery is pending. Retry this submission with the same idempotency key.",
         502
       );
       ```
     - The client receives HTTP 502 with code `DRIVE_ERROR`.
2. **User Experience Defect**:
   - The user is shown: *"Google Drive upload recovery is pending. Retry this submission with the same idempotency key."*
   - This encourages repeated retries that will never succeed.
   - Neither the staff member nor an administrator is alerted that the Google OAuth connection is severed.
3. **Phase 2 Adjustment**:
   - When `classifyDriveError()` detects 401/403 on Google OAuth token refresh:
     - Differentiate between file permissions (`FORBIDDEN_FILE`) and token expiration (`OAUTH_TOKEN_EXPIRED`).
     - Return an actionable message: *"Google Drive connection expired. An administrator must re-authorize the Drive connection in Admin settings."*
     - If the user has the `ADMIN` role, display a direct link to `/admin/drive-setup/authorize`.

---

## 8. Summary of Adjustments to the Roadmap Plan

1. **Phase 1 (Drop Foundation)**:
   - Build a shared `<UploadDropzone>` component with a nested drag-event counter to prevent visual flickering when hovering over icons or typography inside the dropzone.
   - Use `window.addEventListener('dragover', preventDefault)` and `window.addEventListener('drop', preventDefault)` inside a custom hook to guarantee that files dropped outside the dropzone never navigate away.
   - Simulate drag events in JSDOM tests using synthetic `DataTransfer` objects to test both valid drops and invalid text/URL drags.
2. **Phase 2 (Upload Queue & Progress Transport)**:
   - Implement the in-memory queue using an `XMLHttpRequest` transport adapter to report real byte progress (`upload.onprogress`).
   - Introduce an explicit `PROCESSING` state between 100% bytes transferred and final server confirmation.
   - Provide clear distinctions in error messaging for Google OAuth token failures versus network timeouts.
3. **Phase 3 (Progress Toast)**:
   - Position toast at bottom-right (`bottom: 1.5rem; right: 1.5rem`), switching to full width on mobile screens (`max-width: 100%`).
   - Implement polite screen reader announcements (`aria-live="polite"`) that announce milestone events (started, completed, failed) rather than continuous percentage ticks.
4. **Phase 4 (Folder Drop)**:
   - Traverse directories synchronously inside the `drop` event handler before yielding execution, preserving entry availability across browsers.
   - Reuse `parseFolderSelection` to enforce the 25-file limit, 8-level depth limit, and 64 MiB total batch limit.

---

## 9. Open Questions for KWD Stakeholders

1. **File Size Ceiling**: What is the largest file size KWD staff need to upload? Is the current 4.0 MiB limit sufficient, or are multi-page high-DPI scans (> 4.5 MB) required?
2. **Mobile / Tablet Usage**: Do staff upload official records from phones or tablets, or strictly from office desktop workstations?
3. **Primary Browsers**: Which browsers are standardized across KWD office computers (e.g. Chrome, Edge)?
4. **Drop on Documents Page**: Should dropping files anywhere on `/documents` automatically redirect to the Upload Center with files pre-staged for review? (Recommended: Yes).
5. **Toast Dismissal Behavior**: Should the progress toast stay docked until explicitly dismissed by the user, or automatically fade after all uploads complete? (Recommended: Stay docked until dismissed, allowing review of links and retry actions).
