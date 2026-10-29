# API Design

## 1. Architecture Pattern [PROPOSED]
The KWD Document Center should primarily use Next.js Server Actions for data mutations and Route Handlers for data fetching, rather than traditional REST API routes. This is the modern Next.js App Router pattern and reduces boilerplate.

However, the conceptual API surface is documented below for clarity.

## 2. Service Layer Architecture [PROPOSED]

```
Server Actions / Route Handlers
        │
        │  Thin layer: auth check, input validation, error handling
        │
        ▼
Document Service (orchestration)
        │
        ├────────────────────────────────────┐
        │                                    │
        ▼                                    ▼
Document Registry Service             Drive Service [PHASE 3]
(Supabase/PostgreSQL)                 (Google Drive API)
```

### Document Registry Service [PHASE 2]
- Read document records from Supabase/PostgreSQL
- Search, filter, sort, and paginate document records
- Retrieve document detail metadata
- Apply server-side authorization and validation boundaries

### Drive Service [PHASE 3]
Responsibilities:
- Upload file to Google Drive (to the correct folder based on document type)
- Retrieve file metadata from Drive
- Construct Drive view/download URLs
- Handle Drive API errors

### Google Sheets Service [OUT OF SCOPE]
No Google Sheets service is implemented. Supabase/PostgreSQL remains the sole application metadata registry.

### Document Service [PHASE 2 / PHASE 3 EXTENSION]
Responsibilities:
- Coordinate Phase 2 document registry operations through Supabase/PostgreSQL
- Orchestrate the upload flow (Drive upload → Registry write)
- Handle idempotency (check upload_attempts)
- Handle failure recovery
- Combine Drive and Registry data for document retrieval

### Auth Service
Responsibilities:
- Verify Supabase session
- Look up user and role
- Enforce authorization

## 3. Conceptual API Surface [PROPOSED]

### Documents
| Operation | Method | Purpose | Auth Required | Min Role |
|---|---|---|---|---|
| List/Search documents | GET /api/documents | Search registry with filters | Yes | VIEWER |
| Get document detail | GET /api/documents/:id | Get single document metadata | Yes | VIEWER |
| Update document confidentiality | PATCH /api/documents/:id | Toggle `confidential` flag on an active document | Yes | ADMIN |
| Upload document | POST /api/documents | Upload file + create registry entry | Yes | STAFF |
| Open file | GET /api/documents/:id/open | Validate Drive availability, record `DOCUMENT_OPEN` audit entry, and redirect | Yes | VIEWER |
| Download file | GET /api/documents/:id/download | Stream through the server (records `DOCUMENT_DOWNLOAD` unless `?inline=1` preview) | Yes | VIEWER |
| Soft-delete document | DELETE /api/documents/:id | Mark `deletion_state = 'DELETED'` in registry without touching Google Drive (ADR-006) | Yes | ADMIN |
| Restore document | POST /api/documents/:id/restore | Restore soft-deleted record from Trash to `ACTIVE` (ADR-006) | Yes | ADMIN |
| Purge document | POST /api/documents/:id/purge | Move Drive file to Google Drive Trash and mark record purged with a required `reason` (ADR-006) | Yes | ADMIN |
| List Trash | GET /api/admin/trash | List soft-deleted documents awaiting restore or purge | Yes | ADMIN |
| List Audit Log | GET /api/admin/audit-log | Query append-only audit log with filters (`actor`, `action`, `entityType`, `entityId`, `dateFrom`, `dateTo`) | Yes | ADMIN |

### Users (Admin Only) [CONFIRMED PHASE 4]
| Operation | Method | Purpose | Auth Required | Min Role |
|---|---|---|---|---|
| List users | GET /api/admin/users | List authorized users | Yes | ADMIN |
| Add user | POST /api/admin/users | Authorize a new ACTIVE user from email, name, and role | Yes | ADMIN |
| Update user | PATCH /api/admin/users/[id] | Update another user's role and/or status | Yes | ADMIN |

User-management mutations accept JSON only, require same-origin requests, derive the actor ID from server authorization, and use the server-only `service_role` client to call the Phase 4 PostgreSQL RPC boundary. Browser input cannot select the actor. Email and name are not editable. Responses containing administration data use `Cache-Control: private, no-store`.

### Document deletion [CONFIRMED, PHASE 7A]

`DELETE /api/documents/:id` requires an authenticated ACTIVE ADMIN, a valid
document UUID, and a same-origin request. The server derives the actor from
the session and uses only the registry's stored `drive_file_id`; the request
cannot select a Drive target. It coordinates a leased registry claim, Drive
Trash, and token-guarded finalization. Repeated deletion of an already deleted
record returns idempotent success. An active claim returns a safe conflict;
provider and registry failures return safe retryable errors without provider
diagnostics. Deleted documents return normal not-found behavior for detail,
Open in Drive, and Download.

### Controlled folder creation [CONFIRMED, PHASE 7C]

`POST /api/folders` accepts JSON logical destination metadata, a validated
folder name, and an idempotency UUID. It requires an ACTIVE ADMIN and a
same-origin request. The server resolves an explicitly mapped parent without
root fallback, reserves a Drive ID before creating one folder, and returns
only a safe name/destination result. Unknown fields and client Drive IDs are
rejected. The route performs no folder listing, recursion, move, rename, or
permission mutation.

### Drive OAuth Setup (Admin Only)
| Operation | Method | Purpose | Auth Required | Min Role |
|---|---|---|---|---|
| Start Drive setup | GET /api/admin/drive-setup/authorize | Start the one-time Drive Storage OAuth flow | Yes | ADMIN |
| Complete Drive setup | GET /api/admin/drive-setup/callback | Validate state and exchange the code for a refresh token | Yes | ADMIN |

The Drive setup callback is separate from `/auth/callback`, which exchanges the Supabase Google login code. The refresh token is displayed only in the one-time administrator setup response for manual Vercel configuration.

### Upload Flow (Detailed) [PHASE 3]
```
POST /api/documents
  Body: { file, metadata, idempotency_key }

  1. Validate session → 401 if unauthenticated; 403 if unauthorized
  2. Validate role >= STAFF → 403 if insufficient
  3. Validate metadata (Zod) → 400 if invalid
  4. Validate file (type, size) → 400 if invalid
  5. Check idempotency_key in upload_attempts
     - If COMPLETE: return existing document
     - If PENDING_REGISTRY: skip to step 8
  6. Create or find upload_attempts record (status: PENDING_UPLOAD)
     - Atomically claim Drive ID reservation lease (sets operation_token and reservation_expires_at)
     - Only the reservation winner calls generateFileId()
     - Persist the Drive file ID and transition attempt to UPLOADING
  7. Resumable upload file to Drive using that exact persisted file ID
     - On failure: conditionally mark attempt as FAILED using current operation_token, return 500/503
  8. Update upload_attempts (status: PENDING_REGISTRY with matching operation_token; persisted drive_file_id remains unchanged)
  9. Transactionally insert the Supabase document and link the attempt
     - On failure: keep status as PENDING_REGISTRY and retry with the same key
  10. Return 201 with document data
```

### Multi-file upload [CONFIRMED, PHASE 7B]

The upload page may select up to 25 files, but it does not introduce a batch
endpoint. The browser sends one existing `POST /api/documents` request per
ready file, with a distinct idempotency key and no more than three active
requests. Per-file validation, Drive upload, routing, upload-attempt recovery,
and registry finalization remain server-authoritative. Partial success is
expected: successful rows are not resent and only failed rows may be retried.

## 4. Input Validation [CONFIRMED]
- All inputs validated with Zod schemas on the server.
- File type validated against allowlist.
- File size validated against the 4 MiB deployment-safe default or explicit `ADMIN_UPLOAD_MAX_BYTES` value.
- Metadata fields validated: document_type (required, from enum), document_date (required, valid date), subject (required, non-empty).
- Document number format validation depends on document type.

## 5. Error Response Format [PROPOSED]
Standardized JSON error responses:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Document date is required.",
    "field": "document_date"
  }
}
```

Error codes:
- VALIDATION_ERROR — invalid input
- UNAUTHORIZED — not logged in
- FORBIDDEN — insufficient role
- NOT_FOUND — document/user not found
- DRIVE_ERROR — Google Drive operation failed
- REGISTRY_ERROR — Supabase/PostgreSQL registry operation failed
- UPLOAD_FAILED — upload could not complete
- INTERNAL_ERROR — unexpected server error

## 6. Search and Filtering [PROPOSED]
The Documents list endpoint supports:
- `q` — full-text search across subject, document_number, persons_involved, file_name, and filing_subcategory
- `type` — filter by document_type
- `dateFrom` / `dateTo` — date range filter
- `page` / `pageSize` — pagination (default page size: 25)
- `sortBy` / `sortOrder` — sorting (default: created_at DESC)

For Phase 2, Supabase/PostgreSQL performs the registry queries, filtering, sorting, and pagination. Google Sheets is not queried or synchronized in Phase 2.

## 7. Controlled hierarchy endpoints [IMPLEMENTED LOCALLY, PHASE 7C.1]

`GET /api/folders/parents?department=ADMIN&childKind=YEAR|CATEGORY|SUBCATEGORY|WORKING_FOLDER`
is ACTIVE-ADMIN-only and returns browser-safe parent references. YEAR returns
the fixed `department:ADMIN` reference; dynamic parents expose application UUIDs
and safe labels only. Drive IDs and operation ownership data are never returned.

`POST /api/folders` retains the Phase 7C legacy request path. A body containing
`childKind` selects the Phase 7C.1 hierarchy branch. Its browser inputs are
`departmentKey`, `parentRef`, `childKind`, `idempotencyKey`, and exactly one
requested value: `requestedFilingYear`, `requestedCategory`,
`requestedSubcategory`, or `requestedName`.

Hierarchy results are browser-safe: `ACTIVE` is 201, `ACTIVE_EXISTING` is 200,
`IN_PROGRESS` is 202, duplicate conflict is 409, invalid hierarchy/input is
400, controlled terminal failure is non-success, and operational failure is a
safe 500. The response whitelists application folder identity and safe
hierarchy metadata; it never serializes provider IDs, tokens, leases, or raw
diagnostics.
