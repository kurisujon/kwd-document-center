# ADR-008: Document Lifecycle, Relationships, Version History, and Tags

## Status
Accepted

## Context
Following Milestone 1 (safety foundation: audit log, soft-delete, trash/restore/purge, and confidentiality) and Milestone 2 (reviewed code configuration for document types, JSONB custom metadata, and duplicate detection):
1. **Lifecycle Status:** Documents currently only support `ACTIVE` and `ARCHIVED` status. Real water district records (Board Resolutions, Memoranda, Contracts, etc.) transition through explicit lifecycle stages (e.g., `DRAFT` → `UNDER_REVIEW` → `APPROVED` → `ACTIVE` → `SUPERSEDED` / `ARCHIVED`). Uncontrolled status transitions risk skipping mandatory administrative approvals.
2. **Document Relationships:** Documents frequently relate to, amend, or supersede one another (e.g., Board Resolution 2026-05 supersedes Board Resolution 2024-12; a Memorandum amends an earlier Memorandum). Without formal relationship tracking and cycle detection, records officers cannot trace document lineage, and cyclic supersede chains could compromise records integrity.
3. **Version History:** When a document is corrected or amended with a new file, replacing the file without version tracking loses provenance. A clear decision is required on the canonical source of truth for the active file.
4. **Tags & Saved Filters:** Staff need ad hoc categorization across categories and personal saved query filters.
5. **Legacy Importer:** KWD requires a one-time migration path for legacy Google Sheets trackers (e.g., Memorandum and Board Resolution trackers). Because Google Drive OAuth uses the restricted `drive.file` scope (Decision #2), files must be re-uploaded through the application alongside the metadata CSV.

## Decision

### 1. Document Lifecycle Status per Type
- Define standard lifecycle states: `DRAFT`, `UNDER_REVIEW`, `APPROVED`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED`.
- Configure allowed state transitions and required roles in `src/lib/documents/document-types-config.ts`.
- Status transitions are executed through a `SECURITY DEFINER` RPC (`public.change_document_status`) that validates current state, target state, actor role, and records a `DOCUMENT_STATUS_CHANGE` entry in `public.audit_log`.

### 2. Document Relationships (`document_links`)
- Create `public.document_links` storing directed edges: `(from_id, to_id, relation)` where `relation IN ('RELATES_TO', 'SUPERSEDES', 'AMENDS')`.
- Enforce `from_id <> to_id` (no self-links) and a unique constraint on `(from_id, to_id, relation)`.
- Prevent supersede cycles: before inserting or updating a `SUPERSEDES` link, a graph traversal checks if a path already exists from `to_id` to `from_id`. If so, the operation is rejected with `SUPERSEDE_CYCLE_DETECTED`.
- **Confidentiality Protection:** Row Level Security (RLS) on `document_links` uses `public.can_read_document` on **both** endpoints (`from_id` and `to_id`). If an unauthorized viewer lacks access to either document, the link is hidden so confidential document existence and metadata are never leaked.

### 3. Canonical File vs. Version History (`document_versions`)
- **Canonical File Storage Decision:**
  - `public.documents.drive_file_id`, `file_name`, `file_type`, `file_sha256` represents the **current active version**. This ensures high performance for registry search, file streaming, and detail views without multi-table joins.
  - Every file upload (initial creation v1 and subsequent updates v2, v3, etc.) is recorded in `public.document_versions`.
  - Adding a new version uploads the file to Drive, inserts a new `document_versions` row, updates `documents` current file fields, increments `version_count`, and writes `DOCUMENT_VERSION_UPLOAD` to `public.audit_log`.
- **Confidentiality:** RLS on `document_versions` enforces `public.can_read_document` on the parent `document_id`.

### 4. Tags and Saved Filters
- `public.tags` defines global tags, and `public.document_tags` associates tags with documents.
- RLS on `document_tags` ensures tags on confidential documents are only visible to authorized administrators.
- `public.saved_filters` stores user-scoped query parameter snapshots (`user_id = auth.uid()`).

### 5. Importer Strategy (CSV + Re-Upload)
- Extend folder upload CSV schema to support type-specific `meta_*` headers.
- Provide a dedicated dry-run validator (`src/lib/documents/importer.ts`) that verifies file-to-row matching, schema constraints, and duplicate checks (`file_sha256` and `document_number`) without mutating storage or registry.
- Duplicate detection guarantees that re-running an import is idempotent and will not create duplicate records.

## Consequences
- **Positive:** Full audit provenance for document updates, guaranteed acyclic supersede relationships, leak-proof relationship queries for confidential records, and a structured migration path for legacy trackers.
- **Negative:** Uploading a new version requires dual writes (`document_versions` insert + `documents` update), handled within a single transactional RPC.
