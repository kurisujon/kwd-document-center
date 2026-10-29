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

### audit_log [IMPLEMENTED, MILESTONE 1]
Append-only audit trail (`20261029010000_create_audit_log.sql`). Direct table access is revoked from all roles including `service_role`, and a `BEFORE UPDATE OR DELETE` trigger prevents mutations. All writes occur inside `SECURITY DEFINER` RPCs; client IP addresses are not stored.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, `default gen_random_uuid()` | Log entry identifier |
| `actor_id` | UUID | `NOT NULL`, FK → `users.id` | User who performed the action |
| `actor_email` | TEXT | `NOT NULL` | Canonical email of the actor at the time of the action |
| `action` | TEXT | `NOT NULL`, checked against allowed actions | `DOCUMENT_UPLOAD`, `DOCUMENT_OPEN`, `DOCUMENT_DOWNLOAD`, `DOCUMENT_CONFIDENTIALITY_CHANGE`, `DOCUMENT_DELETE`, `DOCUMENT_RESTORE`, `DOCUMENT_PURGE`, `USER_CREATE`, `USER_UPDATE`, `FOLDER_CREATE` |
| `entity_type` | TEXT | `NOT NULL`, `DOCUMENT`/`USER`/`FOLDER` | Entity category |
| `entity_id` | TEXT | `NOT NULL` | Entity identifier |
| `metadata` | JSONB | `NOT NULL DEFAULT '{}'::jsonb` | Safe structured context (never raw provider diagnostics or IP addresses) |
| `created_at` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` | Timestamp of the event |

### document_folders [CONFIRMED, PHASE 7C]

Tracks application-created folders and their durable creation operations. It is
not a general Drive browser. Each row has a unique idempotency key and unique
`(logical_parent_key, normalized_name)` pair, plus the reserved Drive folder
ID, server-derived creator, operation token/lease, safe failure category, and
`CREATING`/`ACTIVE`/`FAILED` lifecycle. Browser roles have no direct access;
service-role-only RPCs reauthorize the actor as an ACTIVE ADMIN.

### Phase 7C.1 hierarchy extension [IMPLEMENTED LOCALLY, UNAPPLIED]

The pending `20261002000000_extend_document_folders_hierarchy.sql` migration
extends `public.document_folders` with nullable transitional hierarchy fields:
`parent_folder_id`, `department_key`, `hierarchy_kind`, `filing_year`,
`category`, `subcategory`, `logical_key`, `source`, and `upload_enabled`.
`upload_enabled` defaults to `false`. Existing Phase 7C rows may legitimately
lack hierarchy metadata until a separately approved linking/bootstrap step.

`source` is `STATIC` or `DYNAMIC`. STATIC ACTIVE rows retain a known Drive ID
without an operation token or lease. DYNAMIC rows use the existing
`CREATING` → `ACTIVE` / `FAILED` lifecycle with a persisted provider ID,
operation token, and lease while ownership is active.

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
| `status` | TEXT | `DRAFT`/`UNDER_REVIEW`/`APPROVED`/`ACTIVE`/`SUPERSEDED`/`ARCHIVED`; **Milestone 3 (ADR-008)** | Document lifecycle status |
| `version_count` | INTEGER | `NOT NULL DEFAULT 1`; **Milestone 3 (ADR-008)** | Count of uploaded versions for this document |
| `confidential` | BOOLEAN | `NOT NULL DEFAULT false`; **Milestone 1** | Marks confidential records visible only to ACTIVE ADMIN users via `public.can_read_document` |
| `custom_metadata` | JSONB | `NOT NULL DEFAULT '{}'::jsonb`; **Milestone 2 (ADR-007)** | Type-specific structured fields defined in reviewed code configuration (`document-types-config.ts`), constrained to JSON objects. Indexed with GIN (`documents_custom_metadata_gin_idx`) |
| `file_sha256` | TEXT | Nullable; **Milestone 2 (ADR-007)** | Server-computed SHA-256 hash (64 hex characters) of uploaded file bytes for duplicate detection. Indexed with `documents_file_sha256_idx` |
| `expires_at` | TIMESTAMPTZ | Nullable; **Milestone 5 (ADR-010)** | Document expiration date (for contracts, permits, licenses) |
| `due_at` | TIMESTAMPTZ | Nullable; **Milestone 5 (ADR-010)** | Compliance or action deadline |
| `retention_period_months` | INTEGER | Nullable; **Milestone 5 (ADR-010)** | Optional custom retention period override (months); defaults to NAP RDS schedule |
| `retention_status` | TEXT | `ACTIVE`/`PENDING_REVIEW`/`ARCHIVED`/`DISPOSED`; **Milestone 5 (ADR-010)** | Records disposition status. Documents are flagged for review, never auto-disposed |
| `retention_flagged_at` | TIMESTAMPTZ | Nullable; **Milestone 5 (ADR-010)** | Timestamp when retention period expired and record was flagged for review |
| `retention_approved_at` / `retention_approved_by` | TIMESTAMPTZ / UUID | Nullable; **Milestone 5 (ADR-010)** | Administrative approval timestamp and actor for archive or disposal |
| `retention_notes` | TEXT | Nullable; **Milestone 5 (ADR-010)** | Recorded justification or notes for disposition |
| `deletion_state` | TEXT | `ACTIVE`/`DELETE_PENDING`/`DELETE_FAILED`/`DELETED`; Phase 7A | Separate soft-deletion lifecycle; not archival status |
| `delete_started_at` | TIMESTAMPTZ | Nullable | Start time for the current or most recent deletion attempt |
| `delete_operation_token` | UUID | Required only while pending | Server-generated ownership token for deletion finalization/failure updates |
| `delete_lease_expires_at` | TIMESTAMPTZ | Required only while pending | Short claim lease; expiry is evaluated transactionally, not by a time-dependent CHECK |
| `delete_error_category` | TEXT | Nullable bounded category | Safe retry/failure classification without provider diagnostics |
| `deleted_at` / `deleted_by` | TIMESTAMPTZ / UUID | Required when deleted | Server-controlled deletion audit information |
| `drive_trashed_at` | TIMESTAMPTZ | Nullable | Drive Trash confirmation (populated on Admin Purge per ADR-006) |
| `purged_at` / `purged_by` | TIMESTAMPTZ / UUID | Nullable; **Milestone 1 (ADR-006)** | Server-controlled Admin Purge timestamp and actor |
| `purge_reason` | TEXT | Nullable (1–500 chars when purged); **Milestone 1 (ADR-006)** | Required administrator reason recorded on Purge |
| `created_by` | TEXT | Nullable; **PENDING CONFIRMATION** for the final identifier convention | User or email associated with record creation; Phase 2 retains the already documented uploader-email representation |
| `created_at` | TIMESTAMPTZ | **PROPOSED** | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | **PROPOSED** | Last modification timestamp |

Drive-related fields are retained for Phase 3 extensibility but are not populated through Google APIs in Phase 2.

Phase 7A deletion uses service-role-only `SECURITY DEFINER` RPCs with a fixed
search path and independent ACTIVE ADMIN actor checks. Direct browser mutation
of deletion fields is not permitted. Deleted rows remain durable for audit and
future restore; they are excluded from ordinary document reads.

### document_links [IMPLEMENTED, MILESTONE 3]
Tracks directed relationships between documents (`RELATES_TO`, `SUPERSEDES`, `AMENDS`).
- `unique (from_id, to_id, relation)` and `from_id <> to_id`.
- Enforces acyclic graph traversal for `SUPERSEDES` links via `public.check_supersede_cycle`.
- RLS policy enforces `public.can_read_document` on **both** endpoints; links pointing to or from confidential documents are masked from non-admin viewers.

### document_versions [IMPLEMENTED, MILESTONE 3]
Maintains complete provenance of file versions for each document (`document_id`, `version_number`, `drive_file_id`, `file_name`, `file_type`, `file_size`, `file_sha256`, `change_summary`, `created_by`, `created_at`).
- `public.documents.drive_file_id`, `file_name`, `file_type`, `file_sha256` remains the canonical source for active file operations (ADR-008).
- RLS policy enforces `public.can_read_document` on `document_id`.

### tags & document_tags [IMPLEMENTED, MILESTONE 3]
Ad hoc categorization across categories. RLS enforces that tags on confidential documents are hidden from unauthorized users.

### saved_filters [IMPLEMENTED, MILESTONE 3]
User-scoped saved search queries (`user_id`, `name`, `query_params jsonb`). RLS restricts access to the owning user.

### document_text [IMPLEMENTED, MILESTONE 4]
Stores extracted plain text and full-text search tsvector (`document_id`, `extracted_text`, `tsv`, `ocr_status`, `last_processed_at`, `error_message`, `updated_at`).
- `tsv` generated always using `'simple'` configuration to preserve Filipino, Cebuano, and English proper nouns without stemming.
- GIN index on `tsv` for sub-millisecond search; trigram index (`pg_trgm`) on `extracted_text` for fuzzy name and number queries.
- RLS policy enforces `public.can_read_document` on `document_id`.

### ocr_jobs [IMPLEMENTED, MILESTONE 4]
Asynchronous job queue for background text extraction and Drive native OCR (`id`, `document_id`, `status`, `attempts`, `max_attempts`, `lock_token`, `lock_expires_at`, `error_category`).
- Statuses: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`.
- Leased execution via `claim_ocr_jobs` prevents duplicate processing and recovers stalled jobs. Accessible only to administrators and `service_role`.

### notifications [IMPLEMENTED, MILESTONE 5]
In-app user notifications (`id`, `user_id`, `kind`, `document_id`, `title`, `body`, `read_at`, `created_at`).
- Kinds: `REMINDER_90`, `REMINDER_30`, `REMINDER_7`, `RETENTION_FLAGGED`, `COMMENT`, `STATUS_CHANGE`, `GENERAL`.
- RLS policy restricts reading and updating (`read_at`) to the recipient user.
- Confidential document notifications are sent strictly to active administrators and sanitized to prevent leaking confidential subjects.

### reminders_sent [IMPLEMENTED, MILESTONE 5]
Tracks exactly-once delivery of milestone reminders (`id`, `document_id`, `kind`, `threshold_days`, `sent_at`).
- Unique constraint: `unique (document_id, kind, threshold_days)` with thresholds 90, 30, and 7 days.
- Prevents duplicate alerts across daily cron executions. Service-role only access.

### document_comments [IMPLEMENTED, MILESTONE 5]
Chronological discussion and compliance notes attached to documents (`id`, `document_id`, `user_id`, `content`, `created_at`, `updated_at`).
- Content bounded to 1–2000 characters.
- RLS enforces `can_read_document` for reading comments and active STAFF/ADMIN authorization for creating comments.
- Comment additions create an immutable `DOCUMENT_COMMENT_CREATE` audit log entry.

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
