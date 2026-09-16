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
 Supabase/PostgreSQL              Google APIs [PHASE 3]
    │                                  │
    ├── Authentication                 ├── Google Drive (File Storage)
    ├── Users Table                    │
    ├── Roles
    ├── Document Registry
    ├── Upload Tracking [PHASE 3]
    └── Audit Logs [PENDING CONFIRMATION]
```

## 2. Core Component Responsibilities [CONFIRMED]

- **Google Drive:** Actual document file storage. Do NOT use Supabase Storage.
- **Google Sheets:** Out of scope for Phase 3 Admin documents.
- **Supabase/PostgreSQL:** Authentication, authorized users, roles, the sole application document registry, and upload tracking.
- **Vercel:** Application hosting and deployment.
- **GitHub:** Source control.

## 3. Server-Side Service Boundary [PROPOSED]

All future Google API interactions are isolated behind a service layer. The UI never calls Google APIs directly. Phase 2 registry operations use a server-side Supabase/PostgreSQL document registry service.

```mermaid
graph LR
    Client["Client (Browser)"] -->|"Fetch / Form Submit"| SA["Server Actions / Route Handlers"]
    SA -->|"Verify Session"| Auth["Auth Service (Supabase)"]
    SA -->|"Orchestrate"| DocSvc["Document Service"]
    DocSvc -->|"Read / Write Registry"| RegSvc["Registry Service (Supabase/PostgreSQL)"]
    DocSvc -.->|"Phase 3: Upload / Retrieve Files"| DriveSvc["Drive Service (Google Drive API)"]
    DocSvc -.->|"Phase 3: Track Uploads"| DB["Supabase (upload_attempts)"]
```

### Phase 2 Registry Service
- Read document metadata from the Supabase/PostgreSQL registry
- Search, filter, sort, and paginate document records
- Retrieve a single document record
- Update or archive records only when the relevant requirements are approved

### Drive Service [PHASE 3]
- Upload file to the correct Drive folder based on document type
- Retrieve file metadata from Drive
- Construct Drive view/download URLs
- Handle Drive API errors

### Google Sheets Service [OUT OF SCOPE]
- No Phase 3 Admin implementation
- Supabase/PostgreSQL remains the sole application metadata registry

### Document Service [PHASE 2 / PHASE 3 EXTENSION]
- Coordinate Phase 2 registry reads through Supabase/PostgreSQL
- Orchestrate the upload flow (Drive upload → Registry write)
- Handle idempotency (check upload_attempts table)
- Handle failure recovery
- Combine Drive and Registry data for document retrieval

### Auth Service
- Verify Supabase session
- Look up user and role from users table
- Enforce authorization on every request

## 4. Google Drive OAuth Strategy [CONFIRMED PHASE 3]

Google Drive operations use a dedicated OAuth client for the KWD official storage account, `kiblawanwaterdistrict@gmail.com`. This client is separate from the existing Supabase Google authentication client.

- The Drive client uses the approved `drive.file` scope.
- The one-time Admin setup flow is `/api/admin/drive-setup/authorize` → Google → `/api/admin/drive-setup/callback`.
- The callback is separate from `src/app/auth/callback/route.ts`, which belongs to Supabase login.
- The resulting refresh token is configured only as the server-side `GOOGLE_DRIVE_REFRESH_TOKEN` Vercel environment variable.
- Client ID, client secret, refresh token, and access tokens are never exposed to normal application users or logged.
- Files are stored in the KWD official account's My Drive under the configured root and mapped destination folders.
- The root folder ID and logical destination mapping remain configuration; the application does not import legacy files.

## 5. Upload Consistency [PROPOSED]

The upload follows a strict ordered two-phase process in Phase 3. It is not part of the Phase 2 registry implementation:

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Google Drive
    participant DB as Supabase

    C->>S: Upload (file + metadata + idempotency_key)
    S->>DB: Check idempotency_key
    alt Key exists (COMPLETE)
        S-->>C: Return existing document
    else Key exists (PENDING_REGISTRY)
        S->>DB: Retry registry finalization
    else New upload
        S->>DB: Create PENDING_UPLOAD attempt and reserve Drive file ID
        S->>D: 1. Resumable upload using reserved file ID
        alt Drive fails
            S->>DB: Update (FAILED)
            S-->>C: Error — safe state
        else Drive succeeds
            D-->>S: File ID
            S->>DB: Update (PENDING_REGISTRY)
            S->>DB: 2. Transactionally insert document and complete attempt
            alt Registry finalization fails
                S-->>C: Error — retry with same key
            else Registry succeeds
                S-->>C: 201 Success
            end
        end
    end
```

**Failure scenarios:**

| Failure Point | System State | Recovery |
|---|---|---|
| Drive upload fails | No file exists, no registry entry | Safe. User retries. |
| Registry finalization fails | Drive file retained in PENDING_REGISTRY | Retry with the same idempotency key without another Drive upload. |
| Response lost to client | Upload may be complete | Idempotency key prevents duplicate on retry. |

## 6. Upload Idempotency [PROPOSED]

1. Client generates a UUID idempotency key when the upload form mounts
2. Key is sent with the upload request
3. Server checks `upload_attempts` table for this key:
   - `COMPLETE` → return existing document (no re-upload)
   - `PENDING_REGISTRY` → retry the Supabase registry finalization only
   - Not found → proceed with new upload
4. This handles: browser retries, double-clicks, Vercel request retries, lost responses

## 7. Concurrency [ASSUMPTION]

For a small team MVP, the following strategies are acceptable:

| Scenario | Strategy | Justification |
|---|---|---|
| Two users uploading simultaneously | Phase 3 concern | Upload concurrency depends on the approved Drive/registry integration design |
| Two users editing the same metadata | Last-write-wins | Small team; concurrent edits on the same document are rare |
| Duplicate document numbers | Client-side warning, no hard constraint | Numbering schemes vary by document type |

## 8. Architectural Simplicity [CONFIRMED]

The project intentionally avoids enterprise complexity. No Kubernetes, Redis, Kafka, Elasticsearch, microservices, message brokers, or complex event-driven architectures. The system must remain understandable to one or two developers.
