# Document Workflow

## 1. Primary Upload Workflow [CONFIRMED]
The expected standard workflow for adding a document to the system:

1. **Staff logs in** via Google.
2. Selects **"Upload Document"**.
3. Selects the **Document Type**.
4. Enters necessary **metadata** (e.g., number, date, subject, persons involved).
5. Selects the **file** from their local system.
6. Clicks Upload.
7. Application validates file and metadata.
8. Application determines the correct Google Drive destination.
9. **Upload to Google Drive** executes.
10. Application receives the new Drive File ID.
11. **Save registry record** executes in Supabase/PostgreSQL.
12. UI displays success.
13. User can now open/view the document in the system.

## 2. Edge Cases and Error Handling [PROPOSED]

### Edge Case 1: Drive upload succeeds, but registry write fails
The system must not silently claim complete success if the metadata wasn't saved.
**Proposed Recovery Strategies:**
- Attempt automatic retry for the registry write.
- Mark the upload as incomplete in a temporary state if possible.
- Provide administrator recovery tools to reconcile orphaned Drive files with missing registry entries.

### Edge Case 2: Registry write succeeds, but Drive upload fails
The system must not create a valid document record pointing to a nonexistent file. The Drive upload must be confirmed successful *before* the registry record is finalized, or the transaction must be rolled back.

### Error Display [CONFIRMED]
Users must receive friendly error states:
- **Upload failure:** Tell the user it failed, if they can retry, and if the document might already exist.
- Do not expose raw stack traces.

## 3. Document Deletion Workflow [CONFIRMED, PHASE 7A]

Only an authenticated, ACTIVE ADMIN may delete a document. Deletion is a
controlled soft-delete workflow: the application claims a short-lived
deletion operation, moves the registry's stored Google Drive file to Drive
Trash, then marks the registry record deleted. It never permanently deletes a
Drive file or hard-deletes the registry row.

The registry keeps a separate deletion lifecycle (`ACTIVE`, `DELETE_PENDING`,
`DELETE_FAILED`, `DELETED`) so archival status is not repurposed. A retry uses
an operation token and lease; stale operations cannot finalize a newer claim.
If Drive reports the stored file missing or already trashed, the record may be
finalized as deleted. Provider failures retain a safe retryable failure state.
Normal lists and file access exclude deleted records. A future restore feature
can untrash the Drive file and return the record to `ACTIVE`.

## 4. Multi-file upload workflow [CONFIRMED, PHASE 7B]

STAFF and ADMIN users may select up to 25 approved files in one browser review
session. The batch is browser-only: each file keeps its own metadata,
idempotency key, result, and call to `POST /api/documents`. The application
uploads at most three files concurrently and does not create a batch database
record or send one giant multipart request.

Common destination/date/person defaults are convenience values only; document
number, subject, date, persons, and destination remain editable per file.
Only ready rows upload. A failed file is retried with its original idempotency
key without resubmitting successful rows. Folder upload and CSV metadata
import remain future work.
