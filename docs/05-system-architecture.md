# System Architecture

## 1. High-Level Architecture [CONFIRMED]

The application acts as a controlled, secure interface between KWD staff and KWD's existing Google infrastructure.

```
    KWD STAFF (Browser)
           ↓
    Next.js App (Vercel)
           ↓
    ┌──────────────────────────────────┐
    │        Server Actions /          │
    │        Route Handlers            │
    ↓                                  ↓
 Supabase                        Google APIs
    │                                  │
    ├── Authentication                 ├── Google Drive (File Storage)
    ├── Users Table                    │
    ├── Roles                          └── Google Sheets (Document Registry)
    ├── Upload Tracking
    └── Audit Logs [PENDING CONFIRMATION]
```

## 2. Core Component Responsibilities [CONFIRMED]

- **Google Drive:** Actual document file storage. Do NOT use Supabase Storage.
- **Google Sheets:** Initial document registry / metadata store.
- **Supabase:** Authentication, authorized users, roles, upload tracking, audit (if approved).
- **Vercel:** Application hosting and deployment.
- **GitHub:** Source control.

## 3. Server-Side Service Boundary [PROPOSED]

All Google API interactions are isolated behind a service layer. The UI never calls Google APIs directly.

```mermaid
graph LR
    Client["Client (Browser)"] -->|"Fetch / Form Submit"| SA["Server Actions / Route Handlers"]
    SA -->|"Verify Session"| Auth["Auth Service (Supabase)"]
    SA -->|"Orchestrate"| DocSvc["Document Service"]
    DocSvc -->|"Upload / Retrieve Files"| DriveSvc["Drive Service (Google Drive API)"]
    DocSvc -->|"Read / Write Metadata"| RegSvc["Registry Service (Google Sheets API)"]
    DocSvc -->|"Track Uploads"| DB["Supabase (upload_attempts)"]
```

### Drive Service
- Upload file to the correct Drive folder based on document type
- Retrieve file metadata from Drive
- Construct Drive view/download URLs
- Handle Drive API errors

### Registry Service
- Append new document rows to Google Sheets
- Read/search document rows
- Update document rows
- Archive (soft-delete) document rows
- Handle Sheets API errors

### Document Service
- Orchestrate the upload flow (Drive upload → Registry write)
- Handle idempotency (check upload_attempts table)
- Handle failure recovery
- Combine Drive and Registry data for document retrieval

### Auth Service
- Verify Supabase session
- Look up user and role from users table
- Enforce authorization on every request

## 4. Service Account Strategy [PROPOSED]

All Google API operations use a Google Cloud service account — NOT per-user OAuth.

- Service account credentials stored server-side only (environment variables)
- Service account granted Editor access on the target Drive folder and Sheet
- All uploaded files are owned by the service account, ensuring consistent access
- Never exposed to the client

## 5. Upload Consistency [PROPOSED]

The upload follows a strict ordered two-phase process:

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Google Drive
    participant G as Google Sheets
    participant DB as Supabase

    C->>S: Upload (file + metadata + idempotency_key)
    S->>DB: Check idempotency_key
    alt Key exists (COMPLETE)
        S-->>C: Return existing document
    else Key exists (PENDING_REGISTRY)
        S->>G: Retry registry write
    else New upload
        S->>DB: Create record (UPLOADING)
        S->>D: 1. Upload file
        alt Drive fails
            S->>DB: Update (FAILED)
            S-->>C: Error — safe state
        else Drive succeeds
            D-->>S: File ID
            S->>DB: Update (PENDING_REGISTRY)
            S->>G: 2. Write metadata row
            alt Sheets fails (after 3 retries)
                S-->>C: Error — admin intervention needed
            else Sheets succeeds
                S->>DB: Update (COMPLETE)
                S-->>C: 201 Success
            end
        end
    end
```

**Failure scenarios:**

| Failure Point | System State | Recovery |
|---|---|---|
| Drive upload fails | No file exists, no registry entry | Safe. User retries. |
| Sheets write fails | Orphaned Drive file | Retry 3×. If still failing: mark PENDING_REGISTRY. Admin reconciliation UI. |
| Response lost to client | Upload may be complete | Idempotency key prevents duplicate on retry. |

## 6. Upload Idempotency [PROPOSED]

1. Client generates a UUID idempotency key when the upload form mounts
2. Key is sent with the upload request
3. Server checks `upload_attempts` table for this key:
   - `COMPLETE` → return existing document (no re-upload)
   - `PENDING_REGISTRY` → retry the Sheets write only
   - Not found → proceed with new upload
4. This handles: browser retries, double-clicks, Vercel request retries, lost responses

## 7. Concurrency [ASSUMPTION]

For a small team MVP, the following strategies are acceptable:

| Scenario | Strategy | Justification |
|---|---|---|
| Two users uploading simultaneously | Safe by default | Drive handles parallel uploads; Sheets appends rows atomically |
| Two users editing the same metadata | Last-write-wins | Small team; concurrent edits on the same document are rare |
| Duplicate document numbers | Client-side warning, no hard constraint | Numbering schemes vary by document type |

## 8. Architectural Simplicity [CONFIRMED]

The project intentionally avoids enterprise complexity. No Kubernetes, Redis, Kafka, Elasticsearch, microservices, message brokers, or complex event-driven architectures. The system must remain understandable to one or two developers.
