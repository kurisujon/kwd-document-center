# Phase 3 Admin Documents

## Scope [CONFIRMED]

This implementation covers Admin documents only. Supabase/PostgreSQL remains the sole application metadata registry, and Google Drive My Drive stores the files under the KWD official account. Accounting, Google Sheets, media management, folder creation, file migration, replacement, deletion, and versioning are not implemented.

## Server flow [CONFIRMED]

`Authorized user → Next.js Node.js route → server authorization → validation → Drive service → configured folder ID → Supabase registry finalization`

The Google client uses the dedicated `KWD Document Center - Drive Storage` OAuth client and the `drive.file` scope on behalf of `kiblawanwaterdistrict@gmail.com`. Client credentials and the refresh token are server-only. The one-time Admin setup flow uses `/api/admin/drive-setup/authorize` and `/api/admin/drive-setup/callback`; it is separate from the Supabase login callback. Historical files not created by the application are outside this phase and are not imported.

## Admin destination mapping [CONFIRMED]

`GOOGLE_DRIVE_ROOT_FOLDER_ID` identifies the KWD My Drive root for application storage. `GOOGLE_DRIVE_ADMIN_FOLDER_MAP` is a JSON object whose keys describe the logical destination and whose values are exact folder IDs. The application never searches folders by name and never exposes IDs in the UI.

Key forms:

```text
ADMIN|2026|BACTI TEST
ADMIN|2026|BAC|AGENDAS
ADMIN|2026|BAC|MEETING MINUTES
ADMIN|2026|BAC|RESOLUTIONS
ADMIN|2026|ATTENDANCE|REGULAR & CASUAL
ADMIN|REFERENCE & TEMPLATES
```

Year is required except for `REFERENCE & TEMPLATES`. Subcategory is required only for BAC and Attendance. No month folder is introduced. The actual folder IDs remain a provisioning dependency and must be supplied after KWD approves and prepares the physical My Drive structure.

## Metadata [CONFIRMED]

`document_type` is the Admin category. Phase 3 adds only `filing_year` and `filing_subcategory`; it does not duplicate the category in another column. `drive_file_id` is canonical. `drive_url` is stored for convenience but is not trusted for file lookup.

Filename and filing subcategory are included in registry text search, so month-bearing filenames remain searchable without month folders.

## Upload validation [CONFIRMED]

The Node.js route validates metadata, extension, declared MIME type, file signature, non-empty content, and size. Supported formats are PDF, DOC/DOCX, XLS/XLSX, PNG, and JPG/JPEG. MP4 is excluded. This is format plausibility validation, not a complete parser or malware scanner for every document format.

The default maximum is 4 MiB (`4194304` bytes), resolving the earlier 4 MB versus 25 MB conflict in favor of the documented Vercel request-body constraint. `ADMIN_UPLOAD_MAX_BYTES` makes the limit explicit and configurable for a deployment that supports a different request size.

## Upload lifecycle and recovery [CONFIRMED]

```text
PENDING_UPLOAD
  → atomically claim reservation lease (operation_token + reservation_expires_at)
  → ONLY reservation owner calls generateFileId()
  → persist Drive file ID (requires matching operation_token and NULL drive_file_id)
UPLOADING (resumable upload using the persisted Drive ID)
  → Drive succeeds or bounded recovery finds that same ID
PENDING_REGISTRY (persisted Drive file ID preserved)
  → transactional documents insert + attempt linkage
COMPLETE
```

### Invariants and Lease Ownership
The core guarantee of the system is:
> **Each upload attempt has at most one persisted Drive file ID and at most one Drive file.**

The system does not claim that exactly one provider-level candidate ID is ever allocated by Google, because an ambiguous provider timeout during `files.generateIds` may allocate a candidate ID that is never returned. However, no database record or Drive file is ever created for an unknown or unpersisted candidate ID.

### Order of Operations
The required order of operations is strictly:
`claim reservation → generate ID → persist ID → upload/create Drive file`
The application must never create a file in Google Drive before its `drive_file_id` is successfully persisted in PostgreSQL.

### Reservation Lease and Crash Recovery
To prevent concurrent generation and avoid permanent lockups if a process crashes before persisting an ID, reservation uses an atomic lease:
1. When an attempt is in `PENDING_UPLOAD` with `drive_file_id IS NULL`, a caller can claim ownership only if `operation_token IS NULL` or `reservation_expires_at <= now()`.
2. A successful claim generates a fresh `operation_token` and sets `reservation_expires_at` (default lease: 60 seconds).
3. Only the winning caller may call `generateFileId()`. Concurrent callers observe the active lease and receive a `409 UPLOAD_IN_PROGRESS` conflict without calling Google Drive.
4. If a process crashes after claiming reservation but before persisting the Drive ID, the lease expires after 60 seconds. A subsequent retry can then safely reclaim ownership and proceed.
5. If `generateFileId()` fails ambiguously, the error handler explicitly clears the reservation (`operation_token = null`, `reservation_expires_at = null`), making the attempt immediately retriable without waiting for lease expiration.

### Persistence and Stale Owner Rejection
`persistDriveFileId` conditionally updates the record `WHERE id = attempt_id AND operation_token = expected_token AND status = 'PENDING_UPLOAD' AND drive_file_id IS NULL`. If a caller's lease expired and another caller reclaimed the reservation, the stale caller's persistence updates zero rows and fails safely, preventing any stale candidate ID from overwriting the attempt. If persistence experiences a transient network error while ownership remains valid, it is retried under the same token and lease without generating a second ID.

### Stale Request Protection
Every transition into `UPLOADING` (initial reservation or resume from `FAILED`) assigns a fresh UUID `operation_token`. All subsequent state mutations (`markPendingRegistry`, `markFailed`) strictly require this exact token. Any delayed response from Google Drive or stale concurrent request holding an old token is rejected, ensuring that `PENDING_REGISTRY` and `COMPLETE` states are never regressed.

`public.finalize_admin_upload` locks the attempt row with `FOR UPDATE`, inserts the document, and marks the attempt complete in one PostgreSQL transaction. A partial unique index prevents two documents from referencing the same non-null Drive ID. Furthermore, a database trigger (`documents_drive_file_id_immutable_trg`) enforces `drive_file_id` immutability at the database boundary: a `NULL` value may be set on initial document insertion or linking, but once non-NULL, attempting to modify or clear the Drive ID raises a database exception. Safe error codes are stored; raw provider diagnostics and file content are not logged or returned.

## Migration Preflight [CONFIRMED]

The `documents_drive_file_id_unique_idx` unique partial index ensures no two documents share the same `drive_file_id`. Because this enforces strict uniqueness, applying the migration to a populated database containing duplicate non-null Drive IDs will fail.
**Preflight Check:** Run this query to detect duplicate `drive_file_id` values before deployment:
```sql
SELECT drive_file_id, COUNT(*)
FROM public.documents
WHERE drive_file_id IS NOT NULL
GROUP BY drive_file_id
HAVING COUNT(*) > 1;
```
If duplicates exist, they must be resolved manually (not automatically merged or deleted) before applying the migration.

## Open and download [CONFIRMED]

Both operations authorize through the application before accessing Drive. Open validates availability and redirects to a URL constructed from `drive_file_id`. Download retrieves the file through the server and returns it with private/no-store and nosniff headers. Missing, trashed, malformed, inaccessible, or provider-failed files return safe application errors.

## Role boundary [CONFIRMED]

- VIEWER: registry read and approved open/download operations; no upload.
- STAFF: Viewer capabilities plus Admin document upload.
- ADMIN: Staff capabilities. No destructive document operation is introduced in this phase.

## Required server configuration [CONFIRMED]

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_DRIVE_ADMIN_FOLDER_MAP`
- `ADMIN_UPLOAD_MAX_BYTES` (optional; default 4 MiB)

Google Sign-In uses the existing Supabase OAuth client and remains unchanged. Drive setup uses a separate OAuth client and the approved `drive.file` scope. The refresh token is shown only in the one-time Admin setup response for manual Vercel configuration and is never logged or stored in application data.
