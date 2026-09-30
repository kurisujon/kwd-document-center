# Authentication and Security

## 1. Authentication Flow [CONFIRMED]

```
User clicks "Continue with Google"
    → Supabase Auth (Google OAuth provider)
    → Google authenticates identity
    → Supabase creates/updates auth.users entry
    → Application checks public.users table for matching email
    → If found AND status = ACTIVE: grant access with assigned role
    → If found AND status = INACTIVE: deny access ("Account deactivated")
    → If not found: deny access ("You are not authorized to use this application")
```

IMPORTANT: Google authentication proves identity. It does NOT automatically grant application access. The application must maintain its own authorized-user list.

## 2. Google Account Considerations [CONFIRMED]
- Users may use personal Gmail accounts (not a Google Workspace domain).
- Do NOT assume domain-based filtering (e.g., `@kiblawanwd.gov.ph`).
- Authorization is managed entirely through the `public.users` table.

## 3. Role Enforcement [PROPOSED]

### Server-Side (Mandatory)
- Every API route / Server Action must:
  1. Verify the Supabase session token
  2. Look up the user in the public.users table
  3. Check role and status
  4. Reject if unauthorized
- NEVER trust client-provided role claims.

### Client-Side (Convenience Only)
- UI may hide/show elements based on role for UX purposes.
- This is NOT a security boundary.

## 4. Session Handling [PROPOSED]
- Supabase manages JWT tokens with automatic refresh.
- Session is stored in httpOnly cookies (recommended) or secure localStorage.
- On every server request, validate the token. A normal missing session redirects to `/login`; OAuth/session callback failures and genuine invalid/expired-session handling redirect to `/login?error=auth`.
- When a user's status is changed to INACTIVE in the `public.users` table, their next request will be denied. Existing sessions are invalidated on next server check.

Phase 1 login error states distinguish session failure (`/login?error=auth`), an authenticated identity absent from `public.users` (`/login?error=unauthorized`), and an INACTIVE account (`/login?error=inactive`, account deactivated). Post-login redirects default to `/documents`; a `next` destination must be a safe single-root application path. External and protocol-relative destinations, including paths that normalize to protocol-relative destinations, fall back to `/documents`.

## 5. Account Lifecycle [PROPOSED]
- **New user**: Admin adds email + name + role to the `public.users` table. User can then sign in.
- **Deactivation**: Admin sets status to INACTIVE. User is denied on next request.
- **Revoked Google access**: If a user deletes their Google account or changes email, their Supabase auth session will fail. The application handles this gracefully.
- **Staff departure**: Admin deactivates the account. No need to revoke Google OAuth credentials specifically.

### Phase 4 database mutation boundary [CONFIRMED]

- User-management writes are available only through server-called PostgreSQL RPCs granted to `service_role`; browser roles receive no user-table write policy or RPC execution grant.
- The server derives the actor's application-user ID from the authenticated authorization record. A browser request must never supply that actor ID.
- Each RPC independently verifies that the actor remains an ACTIVE ADMIN.
- User creation and update RPCs acquire the same transaction advisory lock before actor verification. The lock serializes the intentionally small user-management workload and protects ACTIVE ADMIN continuity under concurrent requests.
- An ADMIN cannot mutate their own role or status. An update that would remove the final ACTIVE ADMIN is rejected at the database boundary.
- User email is canonical and immutable because it is matched to the authenticated Google email. Phase 4 updates are restricted to another user's role and status.

## 6. Environment Variables [CONFIRMED]

### Client-Safe (NEXT_PUBLIC_*)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key (safe for client, used with RLS)

### Server-Only (Never expose to client)
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS, used for admin operations
- `GOOGLE_DRIVE_CLIENT_ID` — dedicated Drive Storage OAuth client ID
- `GOOGLE_DRIVE_CLIENT_SECRET` — dedicated Drive Storage OAuth client secret
- `GOOGLE_DRIVE_REFRESH_TOKEN` — refresh token for the KWD official storage account
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` — configured KWD Drive root folder ID
- `GOOGLE_DRIVE_ADMIN_FOLDER_MAP` — exact Phase 3 Admin logical-destination-to-folder-ID mapping
- `ADMIN_UPLOAD_MAX_BYTES` — optional explicit upload limit; defaults to 4 MiB

The existing Supabase Google authentication client remains unchanged. Its credentials and redirect URI are managed by Supabase and are separate from the Drive Storage OAuth client.

## 7. Security Principles [CONFIRMED]
- Never expose secrets in frontend code.
- Never place private credentials in NEXT_PUBLIC variables.
- All Google API operations occur server-side.
- Validate all uploads: check file types and sizes before uploading to Drive.
- Validate metadata: ensure required fields are present and sanitized.
- Protect API routes from unauthenticated access.
- Avoid logging secrets in production.
- Return standardized error responses. Never leak stack traces.

## 8. Upload Validation [CONFIRMED]
- **File types**: PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX, JPG/JPEG, PNG, and TXT through an explicit server-side extension/MIME allowlist and content plausibility checks
- **File size**: Maximum 4 MiB by default to remain below the documented Vercel request limit; adjustable through `ADMIN_UPLOAD_MAX_BYTES` only when the deployment supports it
- **Metadata**: Validate required fields with Zod schemas server-side
- **File name**: Sanitize to remove special characters before Drive upload

## 9. Google Drive OAuth Credentials [CONFIRMED PHASE 3]
- Use the dedicated `KWD Document Center - Drive Storage` OAuth client.
- Authorize the KWD official account `kiblawanwaterdistrict@gmail.com` with the approved `drive.file` scope.
- Use the separate Admin-only setup callback to obtain a refresh token.
- Store the refresh token in Vercel as `GOOGLE_DRIVE_REFRESH_TOKEN`.
- Keep the client secret, refresh token, authorization code, and access token server-side and out of logs.
- The callback displays the refresh token only in the one-time Admin setup response so the administrator can configure Vercel. It is not saved in application storage or normal browser state.

## 10. Audit Logging [PENDING CONFIRMATION]
Do not build a complex audit system unless KWD confirms the need.
If approved, minimum useful events:
- Login (success/failure)
- Document upload
- Metadata edit
- Document deletion/archival
- User creation/deactivation
- Role change

Store in Supabase audit_log table. Simple append-only insert. No complex querying required for MVP.
