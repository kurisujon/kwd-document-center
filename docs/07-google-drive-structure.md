# Google Drive Structure

## 1. Configurable Folder Mapping [CONFIRMED]

The application must NOT discover folders by name or hard-code folder IDs. Phase 3 Admin uses a configurable logical destination mapping:

```
ADMIN + optional YEAR + CATEGORY + optional SUBCATEGORY → DRIVE_FOLDER_ID
```

Example logical keys in `GOOGLE_DRIVE_ADMIN_FOLDER_MAP`:

```
ADMIN|2026|BACTI TEST
ADMIN|2026|BAC|AGENDAS
ADMIN|2026|ATTENDANCE|DTR SUMMARY
ADMIN|REFERENCE & TEMPLATES
```

This allows KWD to reorganize Drive folders without code changes.

**Future:** If the number of document types grows, consider moving this mapping to a Supabase configuration table with an admin UI.

## 2. KWD Official Account OAuth Strategy [CONFIRMED PHASE 3]

The application performs Drive operations through OAuth credentials delegated to the KWD official account `kiblawanwaterdistrict@gmail.com`.

- The dedicated `KWD Document Center - Drive Storage` OAuth client uses the approved `drive.file` scope.
- The application uses the configured `GOOGLE_DRIVE_ROOT_FOLDER_ID` and logical folder mapping.
- The application does not use a service account, Shared Drive, or legacy-file import in this phase.
- The one-time refresh-token setup is restricted to authorized administrators and is separate from Supabase Google login.

## 3. File Naming Convention [PENDING CONFIRMATION]

Proposed convention (requires KWD approval):

```
[YYYY-MM-DD]-[TYPE]-[NUMBER]-[SUBJECT_SLUG].[ext]
```

Example: `2026-09-07-MEMORANDUM-2026-001-Water-Rate-Adjustment.pdf`

If KWD prefers to keep original file names, the application stores the original name in the registry but may optionally prepend a date prefix for Drive organization.

## 4. File ID and URL Handling [CONFIRMED]

- After upload, Google Drive returns a unique `fileId`.
- The application stores this `fileId` in the registry.
- URLs are constructed at runtime:
  - **View:** `https://drive.google.com/file/d/{fileId}/view`
  - **Download:** `https://drive.google.com/uc?export=download&id={fileId}`
- **Always store the `fileId`.** Never store just a URL — URLs may change; file IDs are permanent.

## 5. File Access Control [PROPOSED]

- Files uploaded through the Drive OAuth client are stored in the KWD official account's My Drive.
- **Application-mediated access:** The server fetches/serves files through the Drive API using the server-side refresh token.
- **Direct Drive access:** Native Drive access depends on the KWD account's sharing and folder permissions. This is separate from application authorization.
- **"Open in Drive" button:** The constructed Drive URL works when the user has native Drive access. The server-proxied "Download" operation remains available for authorized application users.

## 6. Handling External Modifications [PROPOSED]

| Scenario | Impact | Application Behavior |
|---|---|---|
| File moved outside app | `fileId` still valid (Drive tracks by ID, not path) | No impact unless moved to trash |
| File deleted outside app | `fileId` returns 404 | Show: "This file may have been moved or deleted from Google Drive." |
| File renamed outside app | No impact | App tracks by `fileId`, not name |
| File added directly to Drive | Not in registry | Won't appear in the app. App only tracks documents uploaded through its interface. |

## 7. Pending Decisions [PENDING CONFIRMATION]

- Drive root folder ID
- KWD root folder ID
- Desired folder hierarchy (by type, by year, or flat)
- File naming convention approval
- Whether staff should have direct Drive access alongside application access
- Archive/retention policy for old documents
