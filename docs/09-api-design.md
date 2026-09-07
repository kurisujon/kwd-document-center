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
Drive Service                        Registry Service
(Google Drive API)                   (Google Sheets API)
```

### Drive Service
Responsibilities:
- Upload file to Google Drive (to the correct folder based on document type)
- Retrieve file metadata from Drive
- Construct Drive view/download URLs
- Handle Drive API errors

### Registry Service
Responsibilities:
- Append a new document row to Google Sheets
- Read/search document rows from Google Sheets
- Update a document row in Google Sheets
- Archive (soft-delete) a document row
- Handle Sheets API errors

### Document Service
Responsibilities:
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
| Upload document | POST /api/documents | Upload file + create registry entry | Yes | STAFF |
| Update metadata | PATCH /api/documents/:id | Edit document metadata | Yes | STAFF |
| Archive document | DELETE /api/documents/:id | Soft-delete / archive | Yes | ADMIN |

### Users (Admin Only)
| Operation | Method | Purpose | Auth Required | Min Role |
|---|---|---|---|---|
| List users | GET /api/users | List authorized users | Yes | ADMIN |
| Add user | POST /api/users | Authorize a new user | Yes | ADMIN |
| Update user | PATCH /api/users/:id | Update role/status | Yes | ADMIN |

### Upload Flow (Detailed)
```
POST /api/documents
  Body: { file, metadata, idempotency_key }

  1. Validate session → 403 if unauthorized
  2. Validate role >= STAFF → 403 if insufficient
  3. Validate metadata (Zod) → 400 if invalid
  4. Validate file (type, size) → 400 if invalid
  5. Check idempotency_key in upload_attempts
     - If COMPLETE: return existing document
     - If PENDING_REGISTRY: skip to step 8
  6. Create upload_attempts record (status: UPLOADING)
  7. Upload file to Drive → get fileId
     - On failure: update upload_attempts (FAILED), return 500
  8. Update upload_attempts (status: PENDING_REGISTRY, drive_file_id: fileId)
  9. Write metadata row to Google Sheets
     - On failure: retry up to 3 times
     - If still failing: keep status as PENDING_REGISTRY, return 500 with message
  10. Update upload_attempts (status: COMPLETE)
  11. Return 201 with document data
```

## 4. Input Validation [CONFIRMED]
- All inputs validated with Zod schemas on the server.
- File type validated against allowlist.
- File size validated against maximum (25 MB default).
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
- REGISTRY_ERROR — Google Sheets operation failed
- UPLOAD_FAILED — upload could not complete
- INTERNAL_ERROR — unexpected server error

## 6. Search and Filtering [PROPOSED]
The Documents list endpoint supports:
- `q` — full-text search across subject, document_number, persons_involved
- `type` — filter by document_type
- `dateFrom` / `dateTo` — date range filter
- `page` / `pageSize` — pagination (default page size: 25)
- `sortBy` / `sortOrder` — sorting (default: created_at DESC)

For Google Sheets: The application reads all rows (or a cached subset) and performs filtering/sorting in the application layer. This is acceptable for < 2,000 documents.
