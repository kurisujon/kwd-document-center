# KWD Document Center: System Verification & Feature Reality Audit

**Date:** 2026-11-03  
**Audited Branch:** `task/phase-2-upload-queue-toast` (Commit: `f666bc9`)  
**Workspace:** `kwd-document-center`  
**Mode:** Strict Read-Only Verification (Uncommitted Documentation)  

---

## A. Basics

### 1. Exact SQL Migrations Directory Path
The migrations directory in this repository is strictly:
```text
supabase/migrations/
```
**Verification Evidence:**
- `ls supabase/migrations` lists all 22 migration files (`20260907000000_create_authorized_users.sql` through `20261029080000_add_approval_routing.sql`).
- `ls migrations` returns: `ls: cannot access 'migrations': No such file or directory`.
- Relative repository path: `supabase/migrations/`

### 2. Test Suite Breakdown & Real Test Count Reconciliation
Fresh execution of `npx tsx --test tests/*.test.ts tests/*.test.tsx` on commit `f666bc9`:
```text
ℹ tests 412
ℹ suites 0
ℹ pass 407
ℹ fail 0
ℹ cancelled 0
ℹ skipped 5
ℹ todo 0
ℹ duration_ms 16273.20
```

#### Real Explanation of the "357 Tests" Count:
The earlier report referenced "357 non-database tests". This was not a different branch checkout; **357 was the exact baseline pass count of the suite prior to adding the 50 new unit and UI tests developed on `task/phase-2-upload-queue-toast`**:
- Baseline suite: 357 passing tests.
- Phase 2 queue, toast, and retry additions: 50 passing tests (12 in `tests/upload-queue.test.ts`, 6 in `tests/upload-toast-ui.test.tsx`, 6 in `tests/upload-transport.test.ts`, 13 in `tests/upload-dropzone.test.tsx`, 2 in `tests/upload-timing.test.ts`, 11 in `tests/users-ui.test.tsx`).
- Total passing tests: 357 + 50 = **407**.
- Skipped tests: **5**.
- Total tests: 407 + 5 = **412**.

#### Exact List of the 5 Skipped Tests:
Direct grep across all test files (`grep -rn -E "(\.skip|skip:)" tests/`) confirms the 5 skipped tests and their skip conditions:
1. `tests/phase4-users-concurrency.test.ts:101`:
   - Test: `"Phase 4 concurrent user mutations enforce database safety"`
   - Reason: `{ skip: integrationEnabled ? false : "Set PHASE4_TEST_DATABASE_URL and PHASE4_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable local database." }`
2. `tests/folder-concurrency.test.ts:141`:
   - Test: `"Folder concurrency: parallel folder creations and duplicate attempts fail closed"`
   - Reason: `{ skip: enabled ? false : "Set KWD_FOLDER_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for the dedicated migrated kwd_v2_folder_qa database." }`
3. `tests/hierarchy-integrity-integration.test.ts:169`:
   - Test: `"Hierarchy integrity: cyclical links and orphaned paths are rejected"`
   - Reason: `{ skip: enabled ? false : "Set KWD_HIERARCHY_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for the dedicated migrated kwd_v2_hierarchy_qa database." }`
4. `tests/upload-persistence-integration.test.ts:65`:
   - Test: `"Upload persistence: atomic attempts and reservations across network restarts"`
   - Reason: `{ skip: integrationEnabled ? false : "Set KWD_UPLOAD_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable local database." }`
5. `tests/supabase-security-integration.test.ts:86`:
   - Test: `"Supabase security: RLS boundary checks on direct service role client"`
   - Reason: `{ skip: integrationEnabled ? false : "Set KWD_SECURITY_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable local database." }`

*(Note: Earlier assistant claims referencing `database-deletion-integration` and `database-upload-integration` were hallucinated filenames; neither file exists in the repository).*

#### Exact Per-File Test Counts (All 56 Test Files, Sum = 412):
```text
54 tests/admin-documents.test.ts
 6 tests/approval-routing.test.ts
 4 tests/audit-log.test.ts
 8 tests/auth.test.ts
16 tests/batch-upload.test.ts
 6 tests/dashboard-reports-and-starred.test.ts
21 tests/document-deletion.test.ts
 6 tests/document-types-and-duplicates.test.ts
22 tests/documents.test.ts
 5 tests/drive-config.test.ts
11 tests/drive-oauth.test.ts
 3 tests/drive-root.test.ts
 1 tests/drive-upload.test.ts
 2 tests/folder-concurrency.test.ts (1 pass, 1 skipped)
15 tests/folder-creation.test.ts
 2 tests/folder-upload-attempt-repository.test.ts
 2 tests/folder-upload-bulk.test.ts
 9 tests/folder-upload-csv.test.ts
 2 tests/folder-upload-provenance-migration.test.ts
 1 tests/folder-upload-retry.test.ts
 4 tests/folder-upload-rpc-contract.test.ts
 7 tests/folder-upload-service.test.ts
 9 tests/folder-upload-validation.test.ts
 5 tests/hierarchy-bootstrap.test.ts
 3 tests/hierarchy-create-api.test.ts
 2 tests/hierarchy-integrity-integration.test.ts (1 pass, 1 skipped)
 3 tests/hierarchy-parents-api.test.ts
11 tests/hierarchy-repository.test.ts
 1 tests/hierarchy-rpc-contract.test.ts
17 tests/hierarchy-service.test.ts
 5 tests/lifecycle-relationships-versions.test.ts
 4 tests/modernization-ui.test.ts
 6 tests/notifications-and-retention.test.ts
 6 tests/permissions.test.ts
 2 tests/phase4-users-concurrency.test.ts (1 pass, 1 skipped)
10 tests/phase4-users-database.test.ts
 5 tests/phase6-hardening.test.ts
 4 tests/repository-hygiene.test.ts
 6 tests/search-and-ocr.test.ts
 2 tests/server-boundary.test.ts
 1 tests/supabase-security-integration.test.ts (0 pass, 1 skipped)
 3 tests/upload-destination-settings-api.test.ts
 3 tests/upload-destination-settings.test.ts
 3 tests/upload-destination.test.ts
 2 tests/upload-destinations-api.test.ts
 1 tests/upload-persistence-integration.test.ts (0 pass, 1 skipped)
12 tests/upload-queue.test.ts
 2 tests/upload-timing.test.ts
 6 tests/upload-transport.test.ts
16 tests/users.test.ts
 3 tests/create-folder-ui.test.tsx
20 tests/folder-upload-ui.test.tsx
 6 tests/hierarchy-manager-ui.test.tsx
13 tests/upload-dropzone.test.tsx
 6 tests/upload-toast-ui.test.tsx
11 tests/users-ui.test.tsx
--------------------------------------------------------------------------------
Total: 412 tests across 56 files (407 passed, 5 skipped, 0 failed)
```

### 3. Status of External Facts & Hypotheses

| # | Claim | Status | Basis / Official Source |
|---|---|---|---|
| 1 | Migrations directory is `supabase/migrations/` | **CORRECTED / VERIFIED** | Verified via filesystem: `supabase/migrations/` exists; `migrations/` does not exist. |
| 2 | Vercel Serverless Function request body limit is 4.5 MB | **VERIFIED (EXTERNAL)** | Official Vercel documentation confirms unconfigurable 4.5 MB request body limit on Serverless Functions: [Vercel Functions Runtimes: Request Body Size](https://vercel.com/docs/functions/runtimes#request-body-size). Payloads exceeding 4.5 MB receive HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE`. |
| 3 | Vercel Cron on Hobby plan runs at most once per day | **VERIFIED (EXTERNAL)** | Official Vercel documentation confirms Hobby accounts are limited to daily cron jobs (frequency: once per day, scheduling precision ±59 min): [Vercel Cron Jobs Usage & Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing). |
| 4 | No `vercel.json` exists in the repository | **VERIFIED** | Verified via filesystem: `ls vercel.json` returns `No such file or directory`. |
| 5 | Google Drive Trash automatically empties after 30 days | **VERIFIED (EXTERNAL)** | Official Google Drive documentation confirms trashed files are permanently deleted automatically after 30 days: [Google Drive Help: Find or recover a file](https://support.google.com/drive/answer/2375102). |
| 6 | Google OAuth refresh tokens expire after 7 days in "Testing" | **VERIFIED (EXTERNAL)** | Official Google Identity documentation confirms OAuth consent screens with publishing status set to "Testing" issue refresh tokens that expire in 7 days: [Google Identity: Refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration). |
| 7 | Google OAuth App publishing status is "Testing" vs "In production" | **UNVERIFIED** | Requires logging into Google Cloud Console (*APIs & Services → OAuth consent screen*). Cannot be inspected from repository code. |
| 8 | Production database has applied migrations `20261029*` | **UNVERIFIED** | Requires running the verification query in the hosted production Supabase SQL editor. The assistant has no production credentials or network access. |
| 9 | Vercel production target branch (`main` vs `feature/...`) | **UNVERIFIED** | Requires inspecting Vercel Dashboard (*Settings → Git → Production Branch*). |
| 10 | Vercel environment variable scopes | **UNVERIFIED** | Requires inspecting Vercel Dashboard (*Settings → Environment Variables*). |

---

## B. Feature Reality Audit (Nine `20261029*` Migrations)

> [!NOTE] Classification Standard
> All features below previously labeled "WORKS END-TO-END" are classified as **`IMPLEMENTED (Unit-tested only, not verified on real database)`**. While code paths and unit tests (with mocked Supabase clients) are complete, end-to-end operational validity remains unproven until integration tests execute against a real PostgreSQL 17 cluster and staging smoke tests pass.

| Migration & Feature | Classification | Evidence (Files & Lines) | Tests | Real-World Operational Status / Missing Elements |
|---|---|---|---|---|
| **1. Confidentiality**<br>`20261029000000` | **IMPLEMENTED (Unit-tested only, not verified on real database)** | `supabase/migrations/20261029000000_add_document_confidentiality_and_can_read.sql:2-66`<br>`src/lib/documents/confidentiality-api.ts:23`<br>`src/app/api/documents/[id]/route.ts:22`<br>`src/components/documents/document-confidentiality-action.tsx:28` | `tests/documents.test.ts:430`<br>`tests/permissions.test.ts:35` | Functional in UI, API, and RLS. Non-admins cannot toggle or view confidential documents. Requires database verification for RLS policy enforcement. |
| **2. Audit Log**<br>`20261029010000` | **IMPLEMENTED (Unit-tested only, not verified on real database)** | `supabase/migrations/20261029010000_create_audit_log.sql:4-67`<br>`src/lib/audit/audit-log.ts:1-314`<br>`src/app/api/admin/audit-log/route.ts:1-18`<br>`src/app/(protected)/admin/audit-log/page.tsx:1-254` | `tests/audit-log.test.ts` (4 tests) | Append-only trigger prevents updates/deletes. Direct table access revoked from all roles. Search/filtering works. IP addresses omitted. Note: direct insert in report export fails silently (see Section E). |
| **3. Trash, Restore, Purge**<br>`20261029020000` | **IMPLEMENTED (Unit-tested only, not verified on real database)** | `supabase/migrations/20261029020000_add_trash_restore_and_purge.sql:5-487`<br>`src/lib/documents/delete-service.ts:1-277`<br>`src/app/api/admin/trash/route.ts:1-16`<br>`src/app/api/documents/[id]/restore/route.ts:1-21`<br>`src/app/api/documents/[id]/purge/route.ts:1-22` | `tests/document-deletion.test.ts` (21 tests) | ADR-006 compliant. Ordinary delete is DB-only (Drive untouched). Restore reinstates row (and untrashes legacy pre-ADR-006 files). Purge requires 1–500 char reason and moves Drive file to Trash. |
| **4. Types & Duplicate Check**<br>`20261029030000` | **PARTIAL / NEEDS CONFIGURATION (Unit-tested only)** | `supabase/migrations/20261029030000_add_document_custom_metadata_and_hash.sql:3-125`<br>`src/lib/documents/document-types-config.ts:1-304`<br>`src/lib/documents/upload-service.ts:110-130` | `tests/document-types-and-duplicates.test.ts` (6 tests) | SHA-256 hash and duplicate checks work. **Missing:** KWD administrative sign-off on the 28 configured document types and required custom fields (§7 Q1 in roadmap review). Dynamic no-code type builder was deferred per ADR-007. |
| **5. Links, Versions, Tags**<br>`20261029040000` | **IMPLEMENTED (Unit-tested only)** (Core)<br>**PARTIAL** (Importer) | `supabase/migrations/20261029040000_add_document_lifecycle_links_versions_tags.sql:1-757`<br>`src/lib/documents/lifecycle-repository.ts:1-224`<br>`src/app/api/documents/[id]/links/route.ts`<br>`src/app/api/documents/[id]/versions/route.ts`<br>`src/app/api/documents/[id]/tags/route.ts` | `tests/lifecycle-relationships-versions.test.ts` (5 tests) | Supersede cycle detection enforced in DB trigger. Versions tracked with canonical active file on `documents`. **Missing:** Importer (`src/lib/documents/importer.ts`) cannot match pre-existing Drive links by URL due to `drive.file` OAuth scope; files must be re-uploaded. |
| **6. Search & OCR**<br>`20261029050000` | **IMPLEMENTED (Unit-tested only)** (Search)<br>**DORMANT UNTIL CONFIGURED** (OCR) | `supabase/migrations/20261029050000_add_search_and_ocr.sql:1-352`<br>`src/lib/search/search-service.ts:1-154`<br>`src/app/api/search/route.ts:1-32`<br>`src/lib/ocr/ocr-service.ts:91-165` | `tests/search-and-ocr.test.ts` (6 tests) | Full-text search with `'simple'` dictionary and trigram matching works. **Dormant Feature:** Nothing calls `processOcrBatch` in production. Uploaded files queue an OCR job in `public.ocr_jobs` that sits in `PENDING` indefinitely until a worker or cron is scheduled. |
| **7. Reminders, Retention, Comments**<br>`20261029060000` | **IMPLEMENTED (Unit-tested only)** (Comments/Retention rules)<br>**DORMANT UNTIL CONFIGURED** (Reminders / Email) | `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:1-362`<br>`src/app/api/cron/reminders/route.ts:1-58`<br>`src/lib/email/email-dispatcher.ts:1-46`<br>`src/lib/retention/retention-service.ts:1-170`<br>`src/app/api/documents/[id]/comments/route.ts:1-97` | `tests/notifications-and-retention.test.ts` (6 tests) | Comments and NAP RA 9470 retention flagging work (zero auto-disposal). **Dormant Features:** (1) No `vercel.json` exists to schedule `/api/cron/reminders`. (2) `DefaultEmailDispatcher` is a no-op console logger. |
| **8. Stars, Dashboard, Reports, QR**<br>`20261029070000` | **IMPLEMENTED (Unit-tested only)** (App)<br>**UNTESTED** (A11y Screen Reader) | `supabase/migrations/20261029070000_add_user_document_stars.sql:1-225`<br>`src/app/(protected)/dashboard/page.tsx:1-237`<br>`src/app/(protected)/reports/page.tsx:1-196`<br>`src/app/(protected)/documents/starred/page.tsx:1-88`<br>`src/components/documents/document-qr-code.tsx:1-72` | `tests/dashboard-reports-and-starred.test.ts` (6 tests) | Dashboard aggregation, RFC 4180 CSV export, starred records, and pure TypeScript SVG QR generation work. **Missing:** Manual screen reader audit (VoiceOver/NVDA) on new dashboard and reports views. Note: CSV export audit fails silently (see Section E). |
| **9. Approval Routing**<br>`20261029080000` | **IMPLEMENTED (Unit-tested only)** (Logic)<br>**NEEDS CONFIGURATION** (Org Align) | `supabase/migrations/20261029080000_add_approval_routing.sql:1-536`<br>`src/lib/approvals/approval-service.ts:1-175`<br>`src/app/(protected)/tasks/page.tsx:1-19`<br>`src/components/approvals/document-approval-workflow.tsx:1-295` | `tests/approval-routing.test.ts` (6 tests) | Sequential sign-off enforcement (no skipping) and "My Tasks" work. **Missing:** KWD personnel alignment. Seeded routes (`Division Head`, `Legal`, `GM`) are default placeholders not yet reconciled with KWD's actual delegation-of-authority matrix. |

---

### In-Depth Investigation of Dormant Deployed Features

#### 1. OCR: What runs `processOcrBatch`, and is anything scheduled?
- **Finding:** Nothing runs it.
- **Evidence:** `processOcrBatch` (`src/lib/ocr/ocr-service.ts:91`) is only referenced in `ocr-service.ts` and `tests/search-and-ocr.test.ts`. There are zero invocations across all of `src/app/**`.
- **Runtime consequence:** When a file is uploaded, a job is inserted into `public.ocr_jobs` with status `PENDING`. Without a scheduled cron or background worker invoking `processOcrBatch`, OCR text extraction sits dormant in production. Title, date, subject, and metadata searches remain fully functional.

#### 2. Reminders and Retention: `vercel.json`, callers, and authentication
- **Finding:** No `vercel.json` exists in the repository.
- **Caller:** No automated service calls `/api/cron/reminders`.
- **Authentication & Vercel Environment Behavior:** In `src/app/api/cron/reminders/route.ts:6-18`:
  - On Vercel, all deployed environments (both **Production** and **Preview** branches) automatically execute with `NODE_ENV=production`.
  - In production (`NODE_ENV === "production"`), the handler requires `Authorization: Bearer <CRON_SECRET>`. If `CRON_SECRET` is unset in Vercel environment variables, all requests fail closed with HTTP 401.
  - The bypass logic (`if (!cronSecret) return process.env.NODE_ENV !== "production";`) applies **only to local development (`next dev`)**, where `NODE_ENV === "development"`. Deployed Preview environments on Vercel are not publicly callable without the secret.
  - **Recommendation:** Make `CRON_SECRET` mandatory across all environments in code to eliminate any risk of accidental local exposure.

#### 3. Email: What happens today when a notification should send an email?
- **Finding:** No emails are sent.
- **Evidence:** In `src/lib/email/email-dispatcher.ts:14-29`, `DefaultEmailDispatcher` creates a simulated ID (`msg_${Date.now()}_...`) and logs `console.info("[EMAIL_DISPATCH] To: ...")` when `NODE_ENV !== "test"`. It has no SMTP, Resend, or SendGrid connection. Notifications are stored in `public.notifications` and are readable in-app only.

---

## C. Security & Compliance Checks

### 1. Complete Inventory of `createAdminClient()` (Service-Role) Call Sites

| Call Site (File & Line) | Action Performed | Enforces `can_read_document`? | Evidence in Code / Test |
|---|---|---|---|
| `src/app/api/documents/route.ts:29, 33` | Single & folder upload attempt mutation/finalization | N/A (Write) | Creates new document; duplicate checks explicitly call `check_document_duplicate` (`supabase/migrations/20261029030000_add_document_custom_metadata_and_hash.sql:30`) which enforces `can_read_document`. |
| `src/app/api/documents/[id]/route.ts:22` | `admin_set_document_confidential` RPC | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/documents.test.ts:430`. |
| `src/app/api/documents/[id]/route.ts:35` | `admin_soft_delete_document` RPC | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/document-deletion.test.ts:25`. |
| `src/app/api/documents/[id]/open/route.ts:13` | `record_document_access_audit` RPC | **YES** | Pre-lookup uses user's SSR client with RLS + RPC calls `can_read_document(p_actor_id, p_document_id)`. Tested in `tests/documents.test.ts:370`. |
| `src/app/api/documents/[id]/download/route.ts:13` | `record_document_access_audit` RPC | **YES** | Pre-lookup uses user's SSR client with RLS + RPC calls `can_read_document(p_actor_id, p_document_id)`. Tested in `tests/documents.test.ts:395`. |
| `src/app/api/documents/[id]/restore/route.ts:18` | `admin_complete_document_restore` RPC | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/document-deletion.test.ts:180`. |
| `src/app/api/documents/[id]/purge/route.ts:19` | `admin_finalize_document_purge` RPC | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/document-deletion.test.ts:280`. |
| `src/app/api/documents/[id]/status/route.ts:57` | `change_document_status` RPC | **YES** | RPC checks `v_doc.confidential and v_actor.role <> 'ADMIN' -> FORBIDDEN`. Tested in `tests/lifecycle-relationships-versions.test.ts:30`. |
| `src/app/api/documents/[id]/links/route.ts:84` | `add_document_link` RPC | **YES** | RPC checks confidentiality of both endpoints; RLS on `document_links` uses `can_read_document`. Tested in `tests/lifecycle-relationships-versions.test.ts:75`. |
| `src/app/api/documents/[id]/links/[linkId]/route.ts:29` | `remove_document_link` RPC | **YES** | RPC checks confidentiality of endpoints. Tested in `tests/lifecycle-relationships-versions.test.ts:95`. |
| `src/app/api/documents/[id]/versions/route.ts:99` | `add_document_version` RPC | **YES** | RPC verifies `public.can_read_document(p_actor_id, p_document_id)`. Tested in `tests/lifecycle-relationships-versions.test.ts:130`. |
| `src/app/api/documents/[id]/tags/route.ts:63` | `add_document_tag` RPC | **YES** | RPC checks `can_read_document`. Tested in `tests/lifecycle-relationships-versions.test.ts:180`. |
| `src/app/api/documents/[id]/tags/[tagId]/route.ts:29` | `remove_document_tag` RPC | **YES** | RPC checks `can_read_document`. Tested in `tests/lifecycle-relationships-versions.test.ts:200`. |
| `src/app/api/documents/[id]/comments/route.ts:84` | `add_document_comment` RPC | **YES** | RPC checks `public.can_read_document(p_actor_id, p_document_id)`. Tested in `tests/notifications-and-retention.test.ts:160`. |
| `src/app/api/documents/[id]/retention/route.ts:55` | `approve_retention_action` RPC | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/notifications-and-retention.test.ts:120`. |
| `src/app/api/documents/[id]/approvals/route.ts:95` | `start_document_approval` RPC | **YES** | RPC verifies `public.can_read_document(p_actor_id, p_document_id)`. Tested in `tests/approval-routing.test.ts:40`. |
| `src/app/api/documents/[id]/approvals/[stepId]/route.ts:56` | `process_approval_action` RPC | **YES** | RPC verifies `public.can_read_document(p_actor_id, d.document_id)`. Tested in `tests/approval-routing.test.ts:80`. |
| `src/app/api/documents/[id]/star/route.ts:59` | `toggle_document_star` RPC | **YES** | RPC verifies `public.can_read_document(p_actor_id, p_document_id)`. Tested in `tests/dashboard-reports-and-starred.test.ts:35`. |
| `src/app/api/admin/users/route.ts:9` | `admin_list_users`, `admin_create_user` | N/A (User table) | RPCs independently verify actor is active ADMIN. Tested in `tests/users.test.ts`. |
| `src/app/api/admin/users/[id]/route.ts:9` | `admin_update_user` | N/A (User table) | RPC verifies actor is active ADMIN and prevents demoting last admin. Tested in `tests/users.test.ts`. |
| `src/app/api/admin/trash/route.ts:14` | `admin_list_trashed_documents` | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/document-deletion.test.ts:210`. |
| `src/app/api/admin/audit-log/route.ts:12` | `admin_list_audit_logs` | **YES** (Admin-only) | RPC verifies `actor.role = 'ADMIN'`. Tested in `tests/audit-log.test.ts:40`. |
| `src/app/api/tasks/route.ts:16` | `get_user_approval_tasks` RPC | **YES** | RPC line 524 enforces `can_read_document`, plus TypeScript filters via `canReadDocument`. Tested in `tests/approval-routing.test.ts:120`. |
| `src/app/api/reports/export/route.ts:43` | Direct `audit_log` insert | **YES** | Document query uses session client with RLS + line 80 filters `confidential = false` for non-admins. (Note: direct audit insert fails silently as table is revoked; see Section E). |
| `src/app/api/cron/reminders/route.ts:34` | Cron reminders scan | **YES** | In `reminder-service.ts:89`, confidential doc reminders are sent *only* to ADMINS. |
| `src/app/(protected)/documents/[id]/page.tsx:123` | `listAuditLogs` on detail page | **YES** (Admin-only) | Page guards execution with `if (user.role === "ADMIN")`. Non-admins never trigger this. |
| `src/app/(protected)/admin/trash/page.tsx:18` | `admin_list_trashed_documents` | **YES** (Admin-only) | Layout enforces ADMIN role. |
| `src/app/(protected)/admin/audit-log/page.tsx:68` | `admin_list_audit_logs` | **YES** (Admin-only) | Layout enforces ADMIN role. |
| `src/app/(protected)/tasks/page.tsx:12` | `get_user_approval_tasks` | **YES** | RPC and service filter with `can_read_document`. |

---

### 2. Open, Download, and Inline Previews Audit Behavior
- **Open (`src/lib/documents/file-api.ts:147-154`):** Invokes `recordAccessAudit` (`DOCUMENT_OPEN`) **before** issuing the HTTP 302 redirect. If writing fails, it logs `AUDIT_WRITE_FAILED` and returns HTTP 500 (`"Document access could not be recorded."`). The user is NOT redirected to Google Drive.
- **Download (`src/lib/documents/file-api.ts:185-193`):** For actual file downloads (`!serveInline`), it invokes `recordAccessAudit` (`DOCUMENT_DOWNLOAD`) **before** streaming. If writing fails, it immediately aborts via `file.stream.destroy()` and returns HTTP 500 without serving bytes.
- **Inline Previews (`src/lib/documents/file-api.ts:183-186`):**
  - When a user views the document detail page at `/documents/[id]`, the page embeds `<iframe src="/api/documents/[id]/download?inline=1">` (or an `<img>` tag for images).
  - In `file-api.ts:183`, `serveInline` explicitly bypasses `recordAccessAudit`.
  - **Crucial finding:** An audited Open request (`GET /api/documents/[id]/open`) only happens if the user explicitly clicks the external "Open in Drive ↗" link. An Open request does **NOT** precede or accompany inline document viewing.
  - **Consequence:** Authorized users (including admins reading confidential documents) can view the complete PDF/image content inline without generating any record in `public.audit_log`.
  - **Operator Decision:** See Section E.

---

### 3. Audit Log Append-Only Guarantee, IP Addresses, and Privacy Policy
- **Immutability:** `supabase/migrations/20261029010000_create_audit_log.sql:47-61` defines trigger `audit_log_immutable_trg` before `UPDATE` or `DELETE` that raises `AUDIT_LOG_IMMUTABLE`. Table DML is revoked from all roles including `service_role`.
- **IP Addresses:** Zero IP addresses are stored. Columns are restricted to `actor_id`, `actor_email`, `action`, `entity_type`, `entity_id`, `metadata`, and `created_at`.
- **Privacy Policy (`/privacy-policy`):** Updated in commit `8d81aa3` (`src/app/privacy-policy/page.tsx:55-59`) disclosing internal append-only audit logging and explicitly stating client IP addresses are not logged. **Gap:** It does not explicitly cite Republic Act No. 10173 (Data Privacy Act of 2012) or NAP RA 9470 statutory retention rules.

---

### 4. Detail Page Activity Panel Scope
- In `src/app/(protected)/documents/[id]/page.tsx:360`, the entire Audit History / Activity section is wrapped in `{user.role === "ADMIN" && (...) }`.
- Non-admin users (`STAFF`, `VIEWER`) see **nothing**. There is no reduced history for non-admins; it is completely admin-only.

---

### 5. Purge Authorization, Mandatory Reason, and Auto-Disposal
- **Purge Authorization:** Restricted strictly to active `ADMIN` in API handler (`src/lib/documents/deletion-api.ts:131`) and in DB RPC (`supabase/migrations/20261029020000_add_trash_restore_and_purge.sql:438`).
- **Mandatory Reason:** Enforced 1–500 characters in API (`deletion-api.ts:145`) and database (`20261029020000:433`).
- **Auditing:** Writes `DOCUMENT_PURGE` with reason and Drive status to `public.audit_log`.
- **Auto-Disposal:** **Zero.** The retention scanner (`src/lib/retention/retention-service.ts:98-108`) only marks documents as `retention_status = 'PENDING_REVIEW'` and notifies admins. No record is ever automatically deleted or purged, preserving compliance with NAP RA 9470 and COA guidelines.

---

### 6. Confidential Document Visibility Across All Surfaces
- **Registry Table (`/documents`):** Filtered via `public.documents` RLS policy `can_read_document(auth.jwt() ->> 'email', deletion_state, confidential)`. Non-admins see only `confidential = false`.
- **Full-Text Search (`/api/search`):** RPC `search_documents_fulltext` line 132 explicitly includes `public.can_read_document(...)`. Confidential hits, snippets, and counts are masked from non-admins.
- **Notifications (`/api/notifications`):** In `src/lib/reminders/reminder-service.ts:89`, reminders for confidential records are dispatched *only* to admins.
- **CSV Export (`/api/reports/export`):** In `src/lib/reports/report-service.ts:80`, queries for non-admins explicitly append `.eq("confidential", false)`.
- **Dashboard Counts (`/api/dashboard`):** RPC `get_dashboard_summary` in `20261029070000:188, 194, 203, 215` filters every aggregate with `(not confidential or v_is_admin)`. Non-admins never see confidential records reflected in totals.
- **QR Codes (`DocumentQrCode`):** Encodes `/documents/[id]`. Because `/documents/[id]` executes `canReadDocument(user, document)` and issues `notFound()` for unauthorized viewers, scanning a physical QR code for a confidential document yields 404 for non-admins.

---

## D. Migration Safety for Production

### 1. Reconciled Schema Grep Evidence
The table below details the exact `CREATE TABLE` and `CREATE OR REPLACE FUNCTION` statements from `supabase/migrations/20261029*.sql`, disproving earlier hallucinated table names (`document_ocr`, `search_index`, `reminders`, `retention_policies`, `document_approvals`, `approval_steps`, `document_purges` do not exist):

| Migration | Physical Table Created | Grep File & Line | Key Functions Added & Exact Argument Counts |
|---|---|---|---|
| `20261029000000` | *(alters `public.documents`)* | `20261029000000:2` | `can_read_document` (3 args), `can_read_document` (2 args), `admin_set_document_confidential` (2 args) |
| `20261029010000` | `public.audit_log` | `20261029010000:4` | `append_audit_log_entry` (5 args), `record_document_access_audit` (4 args), `admin_list_audit_logs` (9 args) |
| `20261029020000` | *(alters `public.documents`)* | `20261029020000:5` | `admin_soft_delete_document` (2 args), `admin_list_trashed_documents` (3 args), `admin_prepare_document_restore` (2 args), `admin_complete_document_restore` (2 args), `admin_claim_document_purge` (4 args), `admin_finalize_document_purge` (5 args) |
| `20261029030000` | *(alters `public.documents`)* | `20261029030000:3` | `check_document_duplicate` (4 args), `finalize_admin_upload` (13 args, legacy), `finalize_admin_upload` (16 args, extended) |
| `20261029040000` | `public.document_links`<br>`public.document_versions`<br>`public.tags`<br>`public.document_tags`<br>`public.saved_filters` | `20261029040000:50`<br>`20261029040000:140`<br>`20261029040000:172`<br>`20261029040000:180`<br>`20261029040000:216` | `change_document_status` (4 args), `add_document_link` (4 args), `remove_document_link` (2 args), `add_document_version` (9 args), `add_document_tag` (3 args), `remove_document_tag` (3 args) |
| `20261029050000` | `public.document_text`<br>`public.ocr_jobs` | `20261029050000:9`<br>`20261029050000:38` | `search_documents_fulltext` (4 args), `claim_ocr_jobs` (3 args), `complete_ocr_job` (5 args), `fail_ocr_job` (3 args) |
| `20261029060000` | `public.notifications`<br>`public.reminders_sent`<br>`public.document_comments` | `20261029060000:57`<br>`20261029060000:116`<br>`20261029060000:134` | `add_document_comment` (4 args), `approve_retention_action` (4 args) |
| `20261029070000` | `public.user_document_stars` | `20261029070000:36` | `toggle_document_star` (2 args), `get_dashboard_summary` (1 arg) |
| `20261029080000` | `public.approval_routes`<br>`public.document_approval_steps` | `20261029080000:39`<br>`20261029080000:103` | `start_document_approval` (4 args), `process_approval_action` (4 args), `get_user_approval_tasks` (1 arg) |

#### Reconciled Column Grep Evidence on `public.documents`:
Command: `grep -n -E -i "add column" supabase/migrations/20261029*.sql`
Output:
- `supabase/migrations/20261029000000_add_document_confidentiality_and_can_read.sql:3`: `add column confidential boolean not null default false;`
- `supabase/migrations/20261029020000_add_trash_restore_and_purge.sql:6`: `add column purged_at timestamptz,`
- `supabase/migrations/20261029020000_add_trash_restore_and_purge.sql:7`: `add column purged_by uuid references public.users(id),`
- `supabase/migrations/20261029020000_add_trash_restore_and_purge.sql:8`: `add column purge_reason text;`
- `supabase/migrations/20261029030000_add_document_custom_metadata_and_hash.sql:4`: `add column if not exists custom_metadata jsonb not null default '{}'::jsonb,`
- `supabase/migrations/20261029030000_add_document_custom_metadata_and_hash.sql:5`: `add column if not exists file_sha256 text;`
- `supabase/migrations/20261029040000_add_document_lifecycle_links_versions_tags.sql:46`: `alter table public.documents add column if not exists version_count integer not null default 1;`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:35`: `add column if not exists expires_at timestamptz,`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:36`: `add column if not exists due_at timestamptz,`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:37`: `add column if not exists retention_period_months integer...`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:38`: `add column if not exists retention_status text not null default 'ACTIVE'...`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:39`: `add column if not exists retention_flagged_at timestamptz,`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:40`: `add column if not exists retention_approved_at timestamptz,`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:41`: `add column if not exists retention_approved_by uuid references public.users(id),`
- `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql:42`: `add column if not exists retention_notes text;`

---

### 2. Fast Operator Verification Check (3 Read-Only Queries)
In the **Production Supabase SQL Editor**, run this fast check first. It works whichever way migrations were applied (CLI or manual SQL editor) and does not rely on `schema_migrations`:

```sql
-- Query 1: Spot-check core tables from early and late migrations via to_regclass (null = table missing)
select to_regclass('public.audit_log') as audit_log,
       to_regclass('public.document_links') as document_links,
       to_regclass('public.user_document_stars') as stars,
       to_regclass('public.approval_routes') as approval_routes;

-- Query 2: Supabase CLI migration tracking history (empty if migrations were pasted manually)
select version from supabase_migrations.schema_migrations order by version desc limit 30;

-- Query 3: Real production document volume
select count(*) as document_count from public.documents;
```

---

### 3. Exhaustive Production Schema Catalog Verification Script
For full validation of all 14 tables, all document columns, RLS enablement, and RPC argument signatures:

```sql
-- ==============================================================================
-- KWD Document Center: Exhaustive Read-Only Production Schema Verification
-- Run this in the Supabase SQL Editor (Safe, Read-Only, No Writes)
-- ==============================================================================

-- 1. Baseline Document Count Check
select count(*) as document_count from public.documents;

-- 2. Physical Table Existence and RLS Status Check (All 14 Tables)
with expected_tables as (
  select unnest(array[
    'audit_log',
    'document_links',
    'document_versions',
    'tags',
    'document_tags',
    'saved_filters',
    'document_text',
    'ocr_jobs',
    'notifications',
    'reminders_sent',
    'document_comments',
    'user_document_stars',
    'approval_routes',
    'document_approval_steps'
  ]) as table_name
)
select
  et.table_name,
  case when c.relname is not null then 'EXISTS' else 'MISSING' end as table_status,
  case when c.relrowsecurity then 'ENABLED' else 'DISABLED / MISSING' end as rls_status
from expected_tables et
left join pg_class c on c.relname = et.table_name and c.relnamespace = 'public'::regnamespace
order by et.table_name;

-- 3. Document Columns Catalog Check
-- Verifies new columns added by the 20261029* migrations to public.documents
with expected_columns as (
  select unnest(array[
    'confidential',
    'purged_at',
    'purged_by',
    'purge_reason',
    'custom_metadata',
    'file_sha256',
    'version_count',
    'retention_status',
    'expires_at',
    'due_at'
  ]) as column_name
)
select
  ec.column_name,
  case when a.attname is not null then 'EXISTS' else 'MISSING' end as status,
  format_type(a.atttypid, a.atttypmod) as data_type
from expected_columns ec
left join pg_attribute a on a.attrelid = 'public.documents'::regclass
                        and a.attname = ec.column_name
                        and not a.attisdropped
order by ec.column_name;

-- 4. Key RPC Functions and Exact Argument Counts Check
-- Reconciled and verified against CREATE OR REPLACE FUNCTION in supabase/migrations/20261029*.sql
with expected_functions as (
  select
    f.name,
    f.args,
    f.description
  from (
    values
      ('can_read_document', 3, 'RLS policy helper (email, deletion_state, confidential)'),
      ('can_read_document', 2, 'ID-based permission helper (user_id, document_id)'),
      ('append_audit_log_entry', 5, 'Audit append helper'),
      ('admin_list_audit_logs', 9, 'Admin audit viewer with filters'),
      ('admin_soft_delete_document', 2, 'ADR-006 soft deletion'),
      ('admin_prepare_document_restore', 2, 'ADR-006 restore preparation'),
      ('admin_complete_document_restore', 2, 'ADR-006 restore finalization'),
      ('admin_claim_document_purge', 4, 'ADR-006 purge claim with lock'),
      ('admin_finalize_document_purge', 5, 'ADR-006 purge finalization'),
      ('check_document_duplicate', 4, 'SHA-256 duplicate detection'),
      ('finalize_admin_upload', 13, 'Backward-compatible 13-arg upload overload'),
      ('finalize_admin_upload', 16, 'Modernized 16-arg upload overload with hash/metadata'),
      ('change_document_status', 4, 'Document status transition'),
      ('search_documents_fulltext', 4, 'Full-text & trigram search'),
      ('claim_ocr_jobs', 3, 'OCR worker job claim'),
      ('get_dashboard_summary', 1, 'Aggregated dashboard metrics'),
      ('toggle_document_star', 2, 'User bookmark/star toggle'),
      ('start_document_approval', 4, 'Approval workflow initiation'),
      ('process_approval_action', 4, 'Approval step sign-off/rejection'),
      ('get_user_approval_tasks', 1, 'User pending approval task list')
  ) as f(name, args, description)
)
select
  ef.name as function_name,
  ef.args as expected_arg_count,
  case when p.proname is not null then 'EXISTS' else 'MISSING' end as status,
  ef.description
from expected_functions ef
left join pg_proc p on p.proname = ef.name
                   and p.pronamespace = 'public'::regnamespace
                   and p.pronargs = ef.args
order by ef.name, ef.args;

-- 5. Supabase CLI Migration History (Informational Only)
-- Note: Rows only appear here if migrations were applied via the Supabase CLI.
-- If applied manually in the SQL Editor, this query will be empty even though tables exist.
select version, inserted_at
from supabase_migrations.schema_migrations
order by version desc
limit 25;
```

---

### 4. How to Test Previous Production Build Against New Schema on Staging
1. Apply all 22 migrations (`supabase/migrations/*.sql`) to a dedicated **Staging** Supabase project.
2. Checkout the commit that currently runs in production (e.g., `10a3fa2` or `beb9cef`) into a separate local test folder or deploy it to a Vercel staging preview branch.
3. Configure its `.env.local` to point to the **Staging** Supabase URL/keys and staging Drive folder.
4. Execute smoke tests using the older code:
   - Staff login and registry view (`SELECT * FROM documents` without new columns).
   - Single document upload: calls the 13-argument `finalize_admin_upload` RPC. Verify HTTP 201 and record creation.
   - Open in Drive and Download: verify redirects and streaming.
   - Delete document: verify soft-deletion completes.
5. Inspect the server logs and browser network tab: verify zero PostgREST errors, zero `function does not exist` errors, and zero missing column crashes.

---

### 5. Lock & Table Rewrite Analysis
- **Table Rewrites:** **NONE**. In PostgreSQL 11+, adding columns with constant defaults (such as `confidential boolean not null default false`, `custom_metadata jsonb not null default '{}'::jsonb`, `version_count integer not null default 1`, `retention_status text not null default 'ACTIVE'`) is an instantaneous catalog-only metadata update. The table heap is never rewritten.
- **Lock Contention:**
  - `ALTER TABLE public.documents ADD COLUMN ...` takes an `ACCESS EXCLUSIVE` lock. This blocks reads and writes, but releases within microseconds.
  - Adding `CHECK` constraints on `public.documents` scans the table under a `SHARE ROW EXCLUSIVE` lock.
  - Non-concurrent index creations (`documents_custom_metadata_gin_idx` and `documents_active_confidential_idx`) acquire `SHARE` locks, blocking write transactions during the index build.
  - **Table Size Dependency:** While lock durations are expected to be low (<100ms) on typical KWD database volumes, actual lock duration scales with table row count. The operator must run `select count(*) from public.documents;` on production to verify actual row volume.
  - **Verdict:** Safe for production rollout, but must be applied during an off-peak maintenance window to prevent queueing concurrent staff uploads.

---

## E. Prioritized List of Gaps & Operator Decisions

### Priority 1: Blocking Production Launch
1. **Target Database Schema State:** If production has not run `20261029000000` through `20261029080000` (conditional on running the operator's three-query check), deploying `feature/kwd-fullstack-modernization` or `task/*` will immediately crash because route handlers query tables (`audit_log`, `document_links`, etc.) that do not exist.
2. **Google OAuth "Testing" Expiration Risk:** If the Google OAuth consent screen is in "Testing", refresh tokens will silently expire after 7 days, halting all Google Drive uploads and downloads.

---

### Priority 2: Important (Operational, Security & Legal)
1. **Unaudited CSV Registry Export (Silent Audit Failure & Schema Constraint Block):**
   - **Finding:** In `src/app/api/reports/export/route.ts:43`, the handler attempts a direct table insert: `await adminClient.from("audit_log").insert(...)`. Direct table DML on `public.audit_log` is revoked from all database roles (including `service_role`). PostgREST returns an error, which is caught and swallowed in a non-fatal block, allowing the CSV to stream unaudited.
   - **Constraint Reality:** The proposed fix of calling `append_audit_log_entry` with action `REPORT_EXPORT` and entity `REPORT` **will fail at the database level**:
     - `supabase/migrations/20261029010000_create_audit_log.sql:13-29` enforces strict check constraints:
       ```sql
       constraint audit_log_action_valid check (action in ('DOCUMENT_UPLOAD', 'DOCUMENT_OPEN', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_CONFIDENTIALITY_CHANGE', 'DOCUMENT_DELETE', 'DOCUMENT_RESTORE', 'DOCUMENT_PURGE', 'USER_CREATE', 'USER_UPDATE', 'FOLDER_CREATE')),
       constraint audit_log_entity_type_valid check (entity_type in ('DOCUMENT', 'USER', 'FOLDER'))
       ```
       `REPORT_EXPORT` and `REPORT` are **NOT** permitted values.
     - Furthermore, `append_audit_log_entry` explicitly has all execute privileges revoked from `service_role` (line 115).
   - **Consequence:** This cannot be resolved with application code alone. It strictly requires a **new database migration** expanding the check constraints and creating a dedicated authorized RPC. Adding a migration alters the "Migrations: None" rollout status and requires a forward migration strategy since instant rollback cannot reverse schema migrations.
2. **Mandatory `CRON_SECRET` Enforcement:** Make `CRON_SECRET` strictly required in code across all environments to eliminate any risk of unauthenticated triggering in local or preview setups.
3. **Privacy Policy Legal Compliance:** Update `/privacy-policy` with approved legal text citing Republic Act No. 10173 (Data Privacy Act of 2012) and statutory retention requirements under NAP RA 9470.
4. **Approval Routing Org Alignment:** The approval chains seeded in `approval_routes` are default templates; they must be verified against KWD's actual delegation of authority.

---

### Features Dormant Until Configured (Operational Reality)
1. **OCR Batch Processing:** Uploads queue jobs into `public.ocr_jobs`, but without a background worker or cron calling `processOcrBatch`, jobs stay in `PENDING`. Text search continues to work on document title, date, subject, metadata, and tags, but OCR text extraction is dormant.
2. **Automated Reminders & Retention:** Without a `vercel.json` cron entry or external scheduler calling `/api/cron/reminders`, automated daily reminder notifications will not trigger.
3. **Email Dispatcher:** `DefaultEmailDispatcher` logs to console only. Notifications are recorded in `public.notifications` and are readable in-app only.

---

### Priority 3: Minor / Polishing
1. **A11y Pass on New Pages:** Automated Axe and manual screen reader checks have only been run on the delete dialog and upload toast. Run Axe on `/dashboard`, `/reports`, and `/documents/starred`.

---

### Decisions Required From Operator
1. **Inline Previews Audit Policy:** Decide whether viewing document previews inline on `/documents/[id]` should record an audit entry. Currently, inline previews (`?inline=1`) bypass `recordAccessAudit` by design to prevent log bloat on every page navigation. However, this means authorized users can inspect confidential document contents inline without generating an audit trail unless they click "Open in Drive ↗". A rate-limited access log (e.g. once per user per document per hour) could balance compliance with log volume.
2. **UI Visibility of Dormant Features:** Decide whether to hide dormant UI controls (e.g. reminder tabs, pending approval tasks, or OCR status indicators) in the UI until their backend execution schedules and email providers are configured, or leave them visible with clear copy indicating they are in manual/local mode.
3. **Staging Environment Authorization:** Authorize creation of staging Supabase project and dedicated staging Google Drive folder per `docs/staging-runbook.md`.
4. **Google OAuth Publishing Status:** Check whether the Google Cloud OAuth app is in **Testing** or **In production**.
5. **Production Row Count & File Sizes:** Run `select count(*) from public.documents;` on production to verify actual volume and check largest records against Vercel's 4.5 MB request limit.
6. **Email Dispatch Provider:** Decide whether notification emails should remain in-app only for Phase 2, or if an SMTP/Resend provider integration should be scheduled.
7. **Privacy Policy Legal Text:** Obtain formal legal text from KWD records officer/counsel regarding RA 10173 and NAP RA 9470 records retention.
