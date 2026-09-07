# Google Drive Structure

## 1. Configurable Folder Mapping [CONFIRMED]

The application must NOT hard-code a folder hierarchy. Instead, it must use a configurable mapping:

```
DOCUMENT_TYPE → DRIVE_FOLDER_ID
```

Example configuration (stored as environment variables):

```
DRIVE_FOLDER_MEMORANDUM=1abc123def456
DRIVE_FOLDER_BOARD_RESOLUTION=2abc123def456
DRIVE_FOLDER_BAC_RESOLUTION=3abc123def456
DRIVE_FOLDER_OFFICE_ORDER=4abc123def456
DRIVE_FOLDER_OTHER=5abc123def456
```

This allows KWD to reorganize Drive folders without code changes.

**Future:** If the number of document types grows, consider moving this mapping to a Supabase configuration table with an admin UI.

## 2. Service Account Strategy [PROPOSED]

A Google Cloud service account performs all Drive operations on behalf of the application.

- The service account must be granted **Editor** access to the target Drive folder(s).
- **Shared Drive (recommended):** If KWD has Google Workspace, use a Shared Drive for organizational ownership. Files survive if an individual leaves.
- **My Drive (fallback):** If no Workspace, use a dedicated Google account's My Drive and share the root folder with the service account.

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

- Files uploaded by the service account are owned by the service account.
- **Application-mediated access:** The server fetches/serves files via the Drive API. Users do not need individual Drive permissions.
- **Direct Drive access:** If KWD wants staff to also browse files in Drive directly, the folder must be shared with those users separately. This is a KWD operational decision.
- **"Open in Drive" button:** The constructed Drive URL will work only if the user has native Drive access to the file. Otherwise, the application should provide a "Download" option that proxies through the server.

## 6. Handling External Modifications [PROPOSED]

| Scenario | Impact | Application Behavior |
|---|---|---|
| File moved outside app | `fileId` still valid (Drive tracks by ID, not path) | No impact unless moved to trash |
| File deleted outside app | `fileId` returns 404 | Show: "This file may have been moved or deleted from Google Drive." |
| File renamed outside app | No impact | App tracks by `fileId`, not name |
| File added directly to Drive | Not in registry | Won't appear in the app. App only tracks documents uploaded through its interface. |

## 7. Pending Decisions [PENDING CONFIRMATION]

- Drive root folder ID
- My Drive vs Shared Drive
- Which Google account owns the Drive
- Desired folder hierarchy (by type, by year, or flat)
- File naming convention approval
- Whether staff should have direct Drive access alongside application access
- Archive/retention policy for old documents
