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
11. **Save registry record** executes (saving to Sheets/Supabase).
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
