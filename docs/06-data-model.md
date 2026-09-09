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

**Pre-Phase-4 requirement:** Phase 1 sets `public.users.updated_at` on insertion only and implements no user updates. Before enabling user mutations, add and verify a database update trigger to maintain `updated_at` on every update. The trigger is intentionally deferred from Phase 1.

### upload_attempts [PROPOSED, PHASE 3]
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
| `drive_file_id` | TEXT | Nullable; Phase 3 | Google Drive file ID when Drive integration exists |
| `drive_url` | TEXT | Nullable; Phase 3 | Drive URL constructed from the file ID |
| `file_name` | TEXT | Nullable until Phase 3; **PROPOSED** | Original uploaded file name |
| `file_type` | TEXT | Nullable until Phase 3; **PROPOSED** | File MIME type |
| `status` | TEXT | `ACTIVE`/`ARCHIVED`; **PROPOSED** | Registry record status |
| `created_by` | TEXT | Nullable; **PENDING CONFIRMATION** for the final identifier convention | User or email associated with record creation; Phase 2 retains the already documented uploader-email representation |
| `created_at` | TIMESTAMPTZ | **PROPOSED** | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | **PROPOSED** | Last modification timestamp |

Drive-related fields are retained for Phase 3 extensibility but are not populated through Google APIs in Phase 2.

## 4. Google Sheets Registry [PHASE 3, DEFERRED]

Any future Google Sheets role, including synchronization or migration, requires an explicit architectural decision. It must not become a competing source of truth for the document registry without that decision.

## 5. Responsibility Separation [CONFIRMED]

| System | Owns | Does NOT Own |
|---|---|---|
| Supabase/PostgreSQL | Users, roles, Phase 2 document registry, upload tracking when implemented, audit log if approved | Actual document files |
| Google Sheets | No Phase 2 responsibility; future role requires explicit decision | Phase 2 registry, files, users |
| Google Drive | Actual document files beginning in Phase 3 | Phase 2 registry, users |

These three systems must NOT duplicate each other's responsibilities.

## 6. Design Guidelines [CONFIRMED]

- Do not create unnecessary entities. Keep the model flat and simple for MVP.
- A single, unified Document Registry is strongly recommended over multiple fragmented tracker schemas.
- Do not prematurely normalize the database.

## 7. Future Registry Decisions [PROPOSED]

Any future migration, synchronization, or secondary registry involving Google Sheets must be approved explicitly. The Phase 2 application registry is already Supabase/PostgreSQL; no competing source of truth is introduced by this phase.

Potential future decision factors include existing tracker migration, synchronization requirements, staff access to raw Sheets, registry ownership, performance, and maintenance cost.
