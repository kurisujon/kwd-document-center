# Staging Environment Build & Verification Runbook

**Target Application:** KWD Document Center  
**Branch:** `task/phase-2-upload-queue-toast`  
**Purpose:** Step-by-step instructions for establishing an isolated, end-to-end staging environment that mirrors production without touching live KWD records, production Supabase, or official Drive folders.

---

## 1. Prerequisites & Safety Isolation Rules

> [!CAUTION] Environment Isolation
> - **Never** reuse the production Supabase database URL, anon key, or service role key in staging.
> - **Never** reuse the official KWD Google Drive account (`<kwd-production-drive-account@domain.com>`) for staging. Use a dedicated test Google account.
> - **Never** run destructive reset commands (`supabase db reset` or `KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES`) against hosted staging or production projects.
> - **OAuth "Testing" Expiration Notice:** A staging Google Cloud OAuth app set to "Testing" publishing status will expire its refresh token every 7 days. If uploads suddenly fail with 401 after a week, re-authorize via `/api/admin/drive-setup/authorize`.

---

## 2. Step 1: Staging Supabase Project Setup

1. **Create Staging Project:**
   - Log into the [Supabase Dashboard](https://supabase.com/dashboard) and click **New project**.
   - **Name:** `kwd-document-center-staging`
   - **Database Region:** Select Southeast Asia (Singapore) (`ap-southeast-1`) or nearest region to production.
   - Set a strong database password and store it securely in a password manager.

2. **Apply Migrations in Exact Order:**
   - Navigate to the repository root:
     ```bash
     cd <path-to-repo>/kwd-document-center
     ```
   - **Option A: Supabase SQL Editor (Recommended Primary Method)**  
     Execute the 22 SQL files sequentially in the **Supabase SQL Editor**:
     1. `supabase/migrations/20260907000000_create_authorized_users.sql`
     2. `supabase/migrations/20260908000000_create_document_registry.sql`
     3. `supabase/migrations/20260909000000_add_admin_drive_uploads.sql`
     4. `supabase/migrations/20260915000000_grant_service_role_documents_select.sql`
     5. `supabase/migrations/20260917000000_phase4_user_management.sql`
     6. `supabase/migrations/20260917010000_harden_users_table_privileges.sql`
     7. `supabase/migrations/20260917020000_fix_admin_update_user_coalesce.sql`
     8. `supabase/migrations/20260930000000_add_document_deletion_state.sql`
     9. `supabase/migrations/20261001000000_add_document_folders.sql`
     10. `supabase/migrations/20261002000000_extend_document_folders_hierarchy.sql`
     11. `supabase/migrations/20261006000000_add_folder_upload_provenance_reservations.sql`
     12. `supabase/migrations/20261007000000_add_folder_upload_claim_finalize_rpc.sql`
     13. `supabase/migrations/20261016000000_harden_document_folder_hierarchy_integrity.sql`
     14. `supabase/migrations/20261029000000_add_document_confidentiality_and_can_read.sql`
     15. `supabase/migrations/20261029010000_create_audit_log.sql`
     16. `supabase/migrations/20261029020000_add_trash_restore_and_purge.sql`
     17. `supabase/migrations/20261029030000_add_document_custom_metadata_and_hash.sql`
     18. `supabase/migrations/20261029040000_add_document_lifecycle_links_versions_tags.sql`
     19. `supabase/migrations/20261029050000_add_search_and_ocr.sql`
     20. `supabase/migrations/20261029060000_add_notifications_reminders_and_retention.sql`
     21. `supabase/migrations/20261029070000_add_user_document_stars.sql`
     22. `supabase/migrations/20261029080000_add_approval_routing.sql`

   - **Option B: Supabase CLI via npx (Optional Alternative)**  
     > [!NOTE] CLI Caveats
     > - `npx supabase db push` downloads the Supabase CLI package binaries on demand.
     > - Passing `--db-url` directly with the password exposes database credentials in your local shell history (`~/.bash_history`).
     > - Direct connections to `db.<project-ref>.supabase.co:5432` resolve to IPv6 on modern Supabase instances, which will fail from environments (including many WSL configurations) without native IPv6 routing unless using the connection pooler or IPv4 add-on.
     > - Use **Option A (SQL Editor)** if you do not have native IPv6 routing or wish to avoid shell credential leakage.

3. **Verify Staging Schema:**
   - Run the fast 3-query check and exhaustive catalog verification script from Section D of `docs/verification-report-2026-11-03.md` in the SQL Editor.
   - Confirm all 14 tables report `EXISTS` with `RLS: ENABLED`, all document columns exist, and all key RPCs report `EXISTS`.

4. **Seed Initial Staging Admin User:**
   - In the Supabase SQL Editor, insert your staging test Google account as an authorized active ADMIN.
   - *Schema Verification:* Verified against `supabase/migrations/20260907000000_create_authorized_users.sql` and `20260917000000_phase4_user_management.sql`. All NOT NULL columns without defaults (`email`, `name`, `role`) are supplied. Table check constraints `users_email_canonical` (`email = lower(trim(email))`) and `users_name_valid` (`trim(name) <> '' and length <= 120`) are satisfied:
     ```sql
     insert into public.users (email, name, role, status)
     values (lower('your-staging-test-account@gmail.com'), 'Staging Operator', 'ADMIN', 'ACTIVE')
     on conflict (email) do update set role = 'ADMIN', status = 'ACTIVE';
     ```

---

## 3. Step 2: Google Cloud Platform (GCP) Staging Project Setup

1. **Create Dedicated GCP Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project: `kwd-doc-center-staging`.
2. **Enable Google Drive API:**
   - Under **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
3. **Configure OAuth Consent Screen:**
   - Go to **APIs & Services → OAuth consent screen**.
   - User Type: Select **External** (or **Internal** if using a Google Workspace domain).
   - App Name: `KWD Document Center Staging`.
   - Support email: your test email.
   - Scopes: Add `https://www.googleapis.com/auth/drive.file`.
   - Test Users: Add your staging tester Google email addresses.
4. **Create OAuth Client ID (Web Application):**
   - Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `KWD Staging Web Client`.
   - **Authorized JavaScript Origins:**
     - `http://localhost:3000`
     - `https://<your-vercel-staging-preview>.vercel.app`
   - **Authorized Redirect URIs (Exact paths verified in repository code):**
     - **For Supabase Auth Provider:**  
       `https://<staging-project-ref>.supabase.co/auth/v1/callback`
     - **For Local Drive Storage Setup:**  
       `http://localhost:3000/api/admin/drive-setup/callback`
     - **For Staging Deployment Drive Setup:**  
       `https://<your-vercel-staging-preview>.vercel.app/api/admin/drive-setup/callback`
5. **Configure Supabase Google Auth Provider:**
   - In Supabase Dashboard → **Authentication → Providers → Google**:
     - Toggle **Enable Google provider**.
     - Paste `Client ID` and `Client Secret` from the GCP staging client.
     - Save changes.
   - Under **Authentication → URL Configuration**:
     - Site URL: `http://localhost:3000` (or staging Vercel URL).
     - Redirect URLs: add `http://localhost:3000/**` and `https://<your-vercel-staging-preview>.vercel.app/**`.

---

## 4. Step 3: Google Drive Dedicated Staging Folder Setup

1. Log into Google Drive using your **test Google account**.
2. Create a new root folder: `KWD_DOCUMENT_CENTER_STAGING_ROOT`.
3. Open the folder in the browser and extract the folder ID from the URL:
   `https://drive.google.com/drive/folders/<STAGING_ROOT_FOLDER_ID>`
4. Copy this ID for your `GOOGLE_DRIVE_ROOT_FOLDER_ID` environment variable.

---

## 5. Step 4: Staging Google Drive Storage Authorization Flow

1. Start your local Next.js dev server pointing to staging Supabase and GCP credentials (without `GOOGLE_DRIVE_REFRESH_TOKEN` set yet).
2. As the staging Admin user, sign into `http://localhost:3000/login`.
3. In the browser, navigate to the setup authorization endpoint:
   ```text
   http://localhost:3000/api/admin/drive-setup/authorize
   ```
4. Complete Google consent with the test Google account.
5. Google redirects to `/api/admin/drive-setup/callback`. The screen will display the generated **Refresh Token** once.

> [!WARNING] Refresh Token is a Secret
> The displayed refresh token grants persistent read/write access to your staging Google Drive storage. Treat it as a secret credential:
> - Do **NOT** screenshot the browser window.
> - Do **NOT** paste the token in chat, logs, or commit it to version control.
> - Copy it directly into `.env.local` and close the browser tab.

6. Copy this token and set it as `GOOGLE_DRIVE_REFRESH_TOKEN` in your staging environment.

---

## 6. Step 5: Staging `.env.local` Configuration Template

> [!WARNING] Back Up Existing `.env.local`
> If you already have a local `.env.local` configured for local development or another database, make a backup first (e.g. `cp .env.local .env.local.backup`) before modifying credentials.

Create or update `.env.local` in the repository root:

```ini
# ==============================================================================
# KWD Document Center - Staging Environment Configuration (.env.local)
# DO NOT COMMIT THIS FILE. NEVER USE PRODUCTION SECRETS HERE.
# ==============================================================================

# Staging Supabase Project Keys (Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL=https://<staging-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...<staging_anon_key>
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...<staging_service_role_key>

# Staging Google Drive OAuth Credentials (from staging GCP Console)
GOOGLE_DRIVE_CLIENT_ID=<staging_client_id>.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=GOCSPX-<staging_client_secret>
GOOGLE_DRIVE_REFRESH_TOKEN=1//04...<staging_refresh_token>

# Staging Dedicated Google Drive Root Folder ID
GOOGLE_DRIVE_ROOT_FOLDER_ID=<staging_root_folder_id>

# Optional Admin folder map (JSON); if omitted, all uploads fall back to root
GOOGLE_DRIVE_ADMIN_FOLDER_MAP={}

# Upload Limit: 4 MiB (4,194,304 bytes) for Vercel Serverless Function headroom
# Code verification: read directly by src/lib/documents/upload-validation.ts:35
ADMIN_UPLOAD_MAX_BYTES=4194304

# Internal Cron Secret for /api/cron/reminders
# Generate a secure 32-byte secret with: openssl rand -hex 32
CRON_SECRET=<generated_32_byte_hex_secret>

# Local Application URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 7. Step 6: Step-by-Step Staging Smoke-Test Checklist

Run these tests on staging in order before authorizing any production push:

- [ ] **1. Authentication & Role Loading:**
  - Sign in with the test Google account at `/login`.
  - Verify redirect to `/documents`. Verify header shows "Admin" badge and "Upload center" / "User access" links.
- [ ] **2. Single Valid Upload (< 4 MiB):**
  - Go to `/documents/upload`. Select a single file (e.g., 500 KB PDF).
  - Verify progress bar advances, updates to "Saving..." (`PROCESSING`), and displays completion toast.
  - Check Google Drive test folder: verify file appears.
  - Check `public.audit_log`: verify a `DOCUMENT_UPLOAD` row exists.
- [ ] **3. Batch Upload Concurrency (5 Files):**
  - Drop 5 files (< 4 MiB each) into `/documents/upload`.
  - Open DevTools Network tab. Verify concurrency is strictly capped at 3 simultaneous HTTP requests.
- [ ] **4. Processing Cancel Guard:**
  - Upload a 3.5 MB file. While progress displays "Saving..." (100%), verify the Cancel button is disabled and badge shows "Saving...".
- [ ] **5. Network Disconnect During Save:**
  - In DevTools Network tab, toggle **Offline** at 100% progress.
  - Verify toast displays: *"Connection was lost while saving. Retry to confirm whether the file was saved."*
- [ ] **6. Session Expiry (401) Queue Halt:**
  - Delete auth cookies in DevTools Application tab during an active upload queue.
  - Verify the queue pauses immediately with *"Session expired"*, does not auto-retry, and prompts sign-in.
- [ ] **7. Stuck-Row Recovery (Variant A - PostgREST Filter Check):**
  - Manually update a test attempt in staging SQL: set `document_id = null`, `operation_token = null`, `updated_at = now() - interval '10 minutes'`, delete created document.
  - Re-run upload via DevTools Copy as cURL; verify the server reclaims the attempt and creates the document.
- [ ] **8. Stuck-Row Recovery (Variant B - Initial Reservation Recovery):**
  - Delete staging test document and Drive file; reset attempt to `PENDING_UPLOAD` with `drive_file_id = null`.
  - Retry upload via DevTools Copy as cURL; verify a fresh Drive file ID is allocated and saved.
- [ ] **9. Near-Cap Size Test (4,194,304 bytes):**
  - Generate a valid padded PDF of exactly 4,194,304 bytes. Upload via UI.
  - Verify file uploads cleanly without timing out.
- [ ] **10. Direct Curl Oversize Rejection (4,300,000 bytes):**
  - Send direct curl POST with 4.3 MB file bypassing client validation.
  - Verify API returns HTTP 400 with exact payload:
    ```json
    {"error": {"code": "VALIDATION_ERROR", "message": "The file must not exceed 4 MiB.", "field": "file"}}
    ```
    and does not crash Vercel with a raw 413.
- [ ] **11. Soft Delete, Restore, and Purge Flow:**
  - On `/documents`, click Delete on a test record. Verify modal confirmation. Click Confirm Delete.
  - Verify record disappears from `/documents` but file remains in Google Drive.
  - Go to `/admin/trash`. Verify record is listed. Click Restore. Verify record returns to `/documents`.
  - Back on `/admin/trash`, click Purge on a deleted record. Enter purge reason ("Staging disposal verification test").
  - Click Confirm Purge. Verify record moves to Google Drive Trash and `public.audit_log` records `DOCUMENT_PURGE` with reason.
- [ ] **12. Confidential Document Masking:**
  - Mark a test document as Confidential on `/documents/[id]`.
  - Create a second test user with `role = 'STAFF'`. Sign in as Staff.
  - Verify document is hidden from `/documents`, `/api/search`, and `/dashboard` metrics.
  - Navigate directly to `/documents/<confidential-id>` as Staff; verify HTTP 404.
- [ ] **13. Axe DevTools Accessibility Pass:**
  - Run the Axe DevTools browser extension on:
    - Expanded progress toast (0 violations)
    - Minimized progress toast (0 violations)
    - `/dashboard` (0 critical violations)
    - `/reports` (0 critical violations)
    - `/admin/trash` (0 critical violations)
- [ ] **14. Unauthenticated Cron Exposure Guard:**
  - In a staging or production-configured environment, send an HTTP GET request to `/api/cron/reminders` without an Authorization header:
    ```bash
    curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/reminders
    ```
  - Verify the server returns HTTP `401`.
- [ ] **15. Dormant OCR Job Verification:**
  - Upload a valid PDF file in the upload center.
  - Query the staging database:
    ```sql
    select status, created_at from public.ocr_jobs order by created_at desc limit 1;
    ```
  - Verify the job status remains `PENDING` (confirming that background OCR text extraction sits dormant without an active background worker).
- [ ] **16. CSV Report Export Audit Check (Silent Failure Proof):**
  - Sign in as Admin, navigate to `/reports`, and click **Export CSV**.
  - Verify the file downloads cleanly.
  - Query the audit log:
    ```sql
    select count(*) from public.audit_log where action = 'REPORT_EXPORT';
    ```
  - Verify count is `0` (demonstrating the documented Priority 2 gap where direct table insert is rejected by PostgreSQL and swallowed in code).
- [ ] **17. Inline Previews Audit Bypass Check:**
  - As Admin, view the document detail page `/documents/[id]` for an active document with an uploaded PDF.
  - Verify the PDF renders inside the inline `<iframe>` viewer.
  - Query the audit log for recent access records on that document:
    ```sql
    select action, created_at from public.audit_log where entity_id = '<document_id>' and action in ('DOCUMENT_OPEN', 'DOCUMENT_DOWNLOAD');
    ```
  - Verify that **no** audit record was created for the inline preview (proving that inline previews bypass audit logging unless the user clicks "Open in Drive ↗").
- [ ] **18. Old Codebase Backward-Compatibility Smoke Test:**
  - In a separate local directory or test branch, check out the previous production commit (`10a3fa2` or `beb9cef`).
  - Configure its `.env.local` to point to the **Staging** Supabase database (which has all 22 migrations applied).
  - Start the previous build and verify:
    - Staff sign-in and document registry browsing succeed without column-not-found errors.
    - Single document upload completes and correctly invokes the 13-argument `finalize_admin_upload` RPC.
    - Document download and Open in Drive work as expected.
