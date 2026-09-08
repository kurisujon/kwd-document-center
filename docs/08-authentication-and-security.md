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

## 6. Environment Variables [CONFIRMED]

### Client-Safe (NEXT_PUBLIC_*)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key (safe for client, used with RLS)

### Server-Only (Never expose to client)
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS, used for admin operations
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — service account private key (JSON key)
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` — root folder for uploads
- `GOOGLE_SHEET_ID` — registry spreadsheet ID
- `GOOGLE_SHEET_NAME` — specific sheet/tab name within the spreadsheet

IMPORTANT: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are only needed if using OAuth for user-delegated access. With a service account strategy, they are not required for Drive/Sheets operations. However, they ARE required for configuring Google as an OAuth provider in Supabase.

## 7. Security Principles [CONFIRMED]
- Never expose secrets in frontend code.
- Never place private credentials in NEXT_PUBLIC variables.
- All Google API operations occur server-side.
- Validate all uploads: check file types and sizes before uploading to Drive.
- Validate metadata: ensure required fields are present and sanitized.
- Protect API routes from unauthenticated access.
- Avoid logging secrets in production.
- Return standardized error responses. Never leak stack traces.

## 8. Upload Validation [PROPOSED]
- **File types**: PDF, DOCX, DOC, XLSX, XLS, PNG, JPG (configurable allowlist)
- **File size**: Maximum 25 MB (Vercel payload limit consideration; adjustable)
- **Metadata**: Validate required fields with Zod schemas server-side
- **File name**: Sanitize to remove special characters before Drive upload

## 9. Google API Credentials [PROPOSED]
- Use a Google Cloud service account, NOT individual user OAuth for Drive/Sheets.
- Service account key stored as environment variable (JSON private key).
- Service account granted Editor access to target Drive folder and Sheet.
- In production, use Vercel environment variables. Do NOT commit credentials to source control.

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
