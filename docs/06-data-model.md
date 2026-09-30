# Data Model

## 1. Entity Classification
Entities listed here are **[PROPOSED]** unless otherwise marked. Final schemas depend on existing KWD trackers and must be validated.

## 2. Supabase Tables (PostgreSQL)

### public.users [PROPOSED]
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

**Phase 4 database contract [CONFIRMED]:** `public.users.updated_at` is maintained by a `BEFORE UPDATE` database trigger. Email is canonical (`lower(btrim(email))`), unique, and immutable because it is the application authorization identity. Names are non-empty after trimming and limited to 120 characters; email is limited to 254 characters. Privileged user creation and role/status updates use server-only `SECURITY DEFINER` RPCs. Direct `INSERT`, `UPDATE`, and `DELETE` privileges are revoked from application roles, while the existing authenticated self-read policy remains unchanged.

Phase 4 user-management mutations share one PostgreSQL transaction advisory lock. Each RPC acquires that lock before reauthorizing the actor as an ACTIVE ADMIN. This serializes concurrent administrative mutations and prevents two cross-target requests from jointly removing every ACTIVE ADMIN. Email and name are not updateable in Phase 4.

### upload_attempts [PROPOSED, PHASE 3]
Tracks upload operations for idempotency and orphan recovery. This is NOT a replacement for the document registry.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | Record identifier |
| `idempotency_key` | UUID | UNIQUE, NOT NULL | Client-generated UUID |
| `status` | TEXT | NOT NULL, CHECK: PENDING_UPLOAD/UPLOADING/PENDING_REGISTRY/COMPLETE/FAILED | Upload state |
| `drive_file_id` | TEXT | nullable only while `PENDING_UPLOAD` | Persisted before media transfer; at most one per attempt |
| `operation_token` | UUID | nullable initially | Execution ownership token; assigned on claim/retry and required for subsequent mutations |
| `reservation_expires_at` | TIMESTAMPTZ | nullable | Lease expiration timestamp for atomic PENDING_UPLOAD reservation |
| `metadata_snapshot` | JSONB | NOT NULL | Snapshot of submitted metadata |
| `document_id` | UUID | nullable, unique, FK → documents | Completed registry linkage |
| `safe_error_code` | TEXT | nullable | Safe application error classification |
| `created_by` | UUID | FK → users.id | Uploader |
| `created_at` | TIMESTAMPTZ | default now() | Record creation time |
| `updated_at` | TIMESTAMPTZ | default now() | Last update time |

**Upload Invariant & Operation Token Lifecycle:**
Each upload attempt has at most one persisted Drive file ID and at most one Drive file. The lifecycle of `operation_token` is:
- **Initial state:** `operation_token` is `NULL` when an attempt is first created in `PENDING_UPLOAD`.
- **Claim / Reservation:** An atomic claim assigns a fresh `operation_token` and sets `reservation_expires_at > now()`.
- **Active execution:** The current token is retained while ownership-sensitive transitions occur (`UPLOADING`, `PENDING_REGISTRY`, `FAILED`).
- **Mutation authorization:** Later mutations (`persistDriveFileId`, `markPendingRegistry`, `markFailed`) strictly require the current `operation_token`. Stale tokens from superseded operations are rejected (0 rows updated).
- **Retry / Resume:** A resume of a `FAILED` attempt assigns a fresh `operation_token`, invalidating any stale in-flight requests from prior executions.
- **Crash Recovery:** If a process crashes in `PENDING_UPLOAD` before persisting a Drive ID, the lease expires (`reservation_expires_at <= now()`), allowing a subsequent retry to safely reclaim the reservation with a new token without blocking permanently.

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

## 3. Phase 2 Supabase/PostgreSQL Document Registry [PROPOSED]

Supabase/PostgreSQL is the application's document metadata registry for Phase 2. The registry supports document search, filtering, sorting, pagination, and detail retrieval. The model uses only fields already described in the project documentation; final field requirements remain subject to the classifications below.

| Column | Type | Constraints / status | Description |
|---|---|---|---|
| `document_id` | UUID | Primary key; **PROPOSED** | Application-generated unique identifier |
| `document_type` | TEXT | Required validation **CONFIRMED**; category list **PROPOSED** | Document category |
| `document_number` | TEXT | May be empty; **PROPOSED** | Official document number |
| `document_date` | DATE | Required validation **CONFIRMED** | Official date of the document |
| `subject` | TEXT | Required validation **CONFIRMED** | Brief description or subject line |
| `persons_involved` | TEXT | **PROPOSED** | Names or relevant parties |
| `drive_file_id` | TEXT | Nullable; Phase 3 | Google Drive file ID. Database-enforced immutable via trigger once non-NULL; unique partial index |
| `drive_url` | TEXT | Nullable; Phase 3 | Drive URL constructed from the file ID |
| `file_name` | TEXT | Nullable until Phase 3; **PROPOSED** | Original uploaded file name |
| `file_type` | TEXT | Nullable until Phase 3; **PROPOSED** | File MIME type |
| `filing_year` | INTEGER | Nullable; **CONFIRMED Phase 3 Admin** | Logical Admin filing year |
| `filing_subcategory` | TEXT | Nullable; **CONFIRMED Phase 3 Admin** | BAC or Attendance subcategory |
| `status` | TEXT | `ACTIVE`/`ARCHIVED`; **PROPOSED** | Registry record status |
| `deletion_state` | TEXT | `ACTIVE`/`DELETE_PENDING`/`DELETE_FAILED`/`DELETED`; Phase 7A | Separate soft-deletion lifecycle; not archival status |
| `delete_started_at` | TIMESTAMPTZ | Nullable | Start time for the current or most recent deletion attempt |
| `delete_operation_token` | UUID | Required only while pending | Server-generated ownership token for deletion finalization/failure updates |
| `delete_lease_expires_at` | TIMESTAMPTZ | Required only while pending | Short claim lease; expiry is evaluated transactionally, not by a time-dependent CHECK |
| `delete_error_category` | TEXT | Nullable bounded category | Safe retry/failure classification without provider diagnostics |
| `deleted_at` / `deleted_by` | TIMESTAMPTZ / UUID | Required when deleted | Server-controlled deletion audit information |
| `drive_trashed_at` | TIMESTAMPTZ | Nullable | Drive Trash confirmation; nullable when the stored file was already absent |
| `created_by` | TEXT | Nullable; **PENDING CONFIRMATION** for the final identifier convention | User or email associated with record creation; Phase 2 retains the already documented uploader-email representation |
| `created_at` | TIMESTAMPTZ | **PROPOSED** | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | **PROPOSED** | Last modification timestamp |

Drive-related fields are retained for Phase 3 extensibility but are not populated through Google APIs in Phase 2.

Phase 7A deletion uses service-role-only `SECURITY DEFINER` RPCs with a fixed
search path and independent ACTIVE ADMIN actor checks. Direct browser mutation
of deletion fields is not permitted. Deleted rows remain durable for audit and
future restore; they are excluded from ordinary document reads.

## 4. Google Sheets Registry [OUT OF SCOPE]

Google Sheets is not used by the Phase 3 Admin implementation. Supabase/PostgreSQL remains the sole application registry.

## 5. Responsibility Separation [CONFIRMED]

| System | Owns | Does NOT Own |
|---|---|---|
| Supabase/PostgreSQL | Users, roles, Phase 2 document registry, upload tracking when implemented, audit log if approved | Actual document files |
| Google Sheets | No Phase 3 Admin responsibility | Registry, files, users |
| Google Drive | Actual document files beginning in Phase 3 | Phase 2 registry, users |

These three systems must NOT duplicate each other's responsibilities.

## 6. Design Guidelines [CONFIRMED]

- Do not create unnecessary entities. Keep the model flat and simple for MVP.
- A single, unified Document Registry is strongly recommended over multiple fragmented tracker schemas.
- Do not prematurely normalize the database.

## 7. Future Registry Decisions [PROPOSED]

Any future migration, synchronization, or secondary registry involving Google Sheets must be approved explicitly. The Phase 2 application registry is already Supabase/PostgreSQL; no competing source of truth is introduced by this phase.

Potential future decision factors include existing tracker migration, synchronization requirements, staff access to raw Sheets, registry ownership, performance, and maintenance cost.
