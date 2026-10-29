# ADR-007: Document Types and Custom Metadata

## Status
Accepted

## Context
KWD Document Center currently supports 15 fixed Admin document categories with a hardcoded set of core metadata columns (`document_type`, `document_number`, `document_date`, `subject`, `persons_involved`, `filing_year`, `filing_subcategory`). However:
1. Different document types (such as Board Resolutions, Memoranda, and Contracts) require specific structured metadata (e.g., resolution sponsor, session date, office of origin, contract amount, contractor name) to eliminate manual Google Sheets trackers.
2. A database-driven no-code form builder introduces excessive operational complexity, dynamic migrations, and schema drift for a small water district with rarely changing record types.
3. Uploads currently lack server-side duplicate detection, risking accidental duplicate uploads of identical files or duplicate document numbers.

## Decision
1. **Reviewed Code Configuration for Document Types:**
   - Define document types and their custom fields as reviewed TypeScript and Zod configuration in `src/lib/documents/document-types-config.ts`.
   - Each document type specifies its metadata schema, custom field definitions (key, label, type, required, options), and display properties.
   - An admin UI for dynamically adding types and fields without code is deferred to a future phase if KWD explicitly requires it.

2. **Metadata Storage:**
   - Store type-specific custom metadata in a `custom_metadata jsonb not null default '{}'::jsonb` column on `public.documents`.
   - PostgreSQL expression indexes are added on frequent filter keys (`(custom_metadata ->> 'series_year')`, `(custom_metadata ->> 'resolution_number')`, etc.).
   - Existing documents retain their `document_type` values without loss, with an empty object default for `custom_metadata`.

3. **Server-Computed Hash and Duplicate Detection:**
   - Compute a canonical SHA-256 hash (`file_sha256`) from the uploaded file bytes on the server.
   - Check for duplicates by exact `file_sha256` or duplicate `document_number` within the same `document_type`.
   - Rejections return `409 DUPLICATE_DOCUMENT`. Users can override duplicate warnings by providing an explicit, non-empty override reason, which is captured and audited in `public.audit_log`.
   - Duplicate detection queries enforce `can_read_document` to prevent leaking confidential document metadata to unauthorized users.

## Consequences
- **Positive:** Type safety and validation are enforced at runtime via Zod; existing documents remain intact; duplicate uploads are prevented while allowing reasoned overrides; and database schema remains simple and flat.
- **Negative:** Adding or modifying a document type requires a reviewed code deployment rather than a runtime admin UI toggle.
