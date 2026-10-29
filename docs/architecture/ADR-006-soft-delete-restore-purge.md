# Architecture Decision Record: Soft Delete, Restore, and Admin Purge

## Status
Accepted

## Context
In Phase 7A (`20260930000000_add_document_deletion_state.sql`), `DELETE /api/documents/[id]` claimed a deletion lease, called Google Drive `files.update({ trashed: true })`, and finalized the registry record to `deletion_state = 'DELETED'`. However:
1. There was no Restore action, no Admin Trash view, and no separation between reversible soft deletion in the Document Center and trashing the underlying file in Google Drive.
2. Calling Google Drive on ordinary soft delete coupled every registry soft-delete to external network availability and risked premature Drive Trash auto-expiration before an administrator decided to purge a record.

## Decision
Per owner confirmation (Decision 1 of the Enhancement Roadmap):

1. **Soft Delete (`DELETE /api/documents/[id]`):**
   - Soft delete is a database-only transition (`ACTIVE` or `DELETE_FAILED` -> `DELETED`).
   - It **does not touch Google Drive** (`drive_trashed_at` remains `NULL`).
   - It executes atomically inside `public.admin_soft_delete_document(p_document_id, p_actor_id)` and writes a `DOCUMENT_DELETE` entry to `public.audit_log`.
   - Soft-deleted records remain excluded from ordinary registry reads, detail views, Open in Drive, and Download via `public.can_read_document`.

2. **Restore (`POST /api/documents/[id]/restore`):**
   - Restricted to `ACTIVE` `ADMIN` users on the Admin Trash page (`/admin/trash`).
   - Returns a non-purged `DELETED` document (`purged_at IS NULL`) to `deletion_state = 'ACTIVE'`, clearing deletion timestamps/errors (`deleted_at`, `deleted_by`, `delete_started_at`, `drive_trashed_at`, `delete_error_category`) and writing a `DOCUMENT_RESTORE` entry to `public.audit_log`.
   - For backward compatibility with pre-ADR-006 rows that already have `drive_trashed_at IS NOT NULL`, Restore untrashes the file in Google Drive (`files.update({ trashed: false })`) before restoring the registry record to `ACTIVE`.

3. **Admin Purge (`POST /api/documents/[id]/purge`):**
   - Restricted to `ACTIVE` `ADMIN` users and requires a non-empty `reason` (1–500 characters).
   - Repurposes the Phase 7A leased Drive Trash workflow (`admin_claim_document_purge` -> Google Drive `files.update({ trashed: true })` -> `admin_finalize_document_purge`).
   - Moves the stored Google Drive file to Google Drive Trash (never `files.delete`), records `purged_at = now()`, `purged_by = actor_id`, `purge_reason = reason`, and `drive_trashed_at`, and appends a `DOCUMENT_PURGE` entry (including `reason`) to `public.audit_log`.
   - Purged records remain durable in `public.documents` (`deletion_state = 'DELETED'`, `purged_at IS NOT NULL`) for audit trail integrity and cannot be restored through the application.

## Consequences
- **Positive:** Soft delete is instantaneous, atomic, and resilient to transient Google Drive outages; accidental deletions can be restored cleanly by an administrator; Drive Trash is touched only on explicit, reason-audited Admin Purge.
- **Negative:** Legacy soft-deleted records that were trashed in Drive before ADR-006 require an untrash call on Restore, which is handled transparently by the Restore service.
