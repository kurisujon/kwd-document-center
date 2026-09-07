# Data Model

## 1. Entity Classification
Entities listed here are **[PROPOSED]** unless otherwise marked. Final schemas depend on existing KWD trackers and must be validated.

## 2. Supabase Tables (PostgreSQL)

### users [PROPOSED]
Manages application access and authorization. Stored in Supabase.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | User identifier |
| `email` | TEXT | UNIQUE, NOT NULL | Google email address |
| `name` | TEXT | NOT NULL | Display name |
| `role` | TEXT | NOT NULL, CHECK: ADMIN/STAFF/VIEWER | Application role |
| `status` | TEXT | NOT NULL, CHECK: ACTIVE/INACTIVE, default ACTIVE | Account status |
| `created_at` | TIMESTAMPTZ | default now() | Record creation time |
| `updated_at` | TIMESTAMPTZ | default now() | Last update time |

### upload_attempts [PROPOSED]
Tracks upload operations for idempotency and orphan recovery. This is NOT a replacement for the document registry.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | Record identifier |
| `idempotency_key` | TEXT | UNIQUE, NOT NULL | Client-generated UUID |
| `status` | TEXT | NOT NULL, CHECK: UPLOADING/PENDING_REGISTRY/COMPLETE/FAILED | Upload state |
| `drive_file_id` | TEXT | nullable | Populated after successful Drive upload |
| `document_type` | TEXT | NOT NULL | Document type submitted |
| `metadata_snapshot` | JSONB | NOT NULL | Snapshot of submitted metadata |
| `error_message` | TEXT | nullable | Error details if failed |
| `created_by` | UUID | FK → users.id | Uploader |
| `created_at` | TIMESTAMPTZ | default now() | Record creation time |
| `updated_at` | TIMESTAMPTZ | default now() | Last update time |

### audit_log [PENDING CONFIRMATION]
Only implement if KWD confirms the need.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | Log entry identifier |
| `user_id` | UUID | FK → users.id | Who performed the action |
| `action` | TEXT | NOT NULL | Action type (e.g., DOCUMENT_UPLOAD, USER_CREATE) |
| `target_type` | TEXT | | Entity type (e.g., DOCUMENT, USER) |
| `target_id` | TEXT | | Entity identifier |
| `details` | JSONB | nullable | Additional context |
| `created_at` | TIMESTAMPTZ | default now() | When the action occurred |

## 3. Google Sheets Registry (Document Entity) [PROPOSED]

A single unified Google Sheet with one row per document. The application reads/writes this sheet through the Registry Service.

| Column | Type (all stored as text in Sheets) | Description |
|---|---|---|
| `document_id` | TEXT (UUID) | Application-generated unique identifier |
| `document_type` | TEXT | e.g., Memorandum, Board Resolution |
| `document_number` | TEXT | Official document number (may be empty) |
| `document_date` | DATE (ISO 8601) | Official date of the document |
| `subject` | TEXT | Brief description or subject line |
| `persons_involved` | TEXT | Comma-separated names or relevant parties |
| `drive_file_id` | TEXT | Google Drive file ID |
| `drive_url` | TEXT | Constructed from file ID |
| `file_name` | TEXT | Original uploaded file name |
| `file_type` | TEXT | MIME type (e.g., application/pdf) |
| `status` | TEXT | ACTIVE or ARCHIVED (default ACTIVE) |
| `created_by` | TEXT | Email of the uploader |
| `created_at` | TEXT (ISO 8601) | Upload timestamp |
| `updated_at` | TEXT (ISO 8601) | Last modification timestamp |

**Note:** Google Sheets stores everything as text. The application must handle type parsing and validation.

## 4. Responsibility Separation [CONFIRMED]

| System | Owns | Does NOT Own |
|---|---|---|
| Supabase | Users, roles, upload tracking, audit log | Document metadata, files |
| Google Sheets | Document registry (metadata) | Files, users |
| Google Drive | Actual document files | Metadata, users |

These three systems must NOT duplicate each other's responsibilities.

## 5. Design Guidelines [CONFIRMED]

- Do not create unnecessary entities. Keep the model flat and simple for MVP.
- A single, unified Document Registry is strongly recommended over multiple fragmented tracker schemas.
- Do not prematurely normalize the database.

## 6. Migration Threshold [PROPOSED]

Migrate the document registry from Google Sheets to Supabase PostgreSQL if **any** of these conditions occur:

- Registry exceeds ~2,000 rows and search performance becomes noticeably slow
- Concurrent editing conflicts become frequent
- Complex queries (multi-field filtering with date ranges, joins) are needed
- Google Sheets API rate limits are regularly hit (300 req/min/project)

The Registry Service abstraction makes this migration straightforward — only the service implementation changes, not the rest of the application.
