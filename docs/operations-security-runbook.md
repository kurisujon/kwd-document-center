# Security and Operations Runbook

This runbook covers security-sensitive configuration and recovery for the current KWD Document Center. It is not a Phase 6 deployment manual. Never record or paste a credential value into this document, Git, tickets, screenshots, chat, logs, or command output.

## Environments and ownership

| Environment | Supabase project | Project reference | Use |
|---|---|---|---|
| Local development | Disposable local services only | N/A | Development and explicitly opted-in destructive tests |
| DEV | `kwd-document-center-dev` | `sgtclwxtqeqoitefeohw` | Integration and smoke testing |
| Production | `kwd-document-center` | `mnkohkqniuyauuypeyfj` | Live KWD application |

- Google Cloud project: `KWD Document Center`.
- Official Drive storage account: `kiblawanwaterdistrict@gmail.com`.
- DEV and Production configuration, credentials, and folder mappings must never be mixed.
- Google Drive storage authorization is separate from Supabase Google sign-in. Application users do not need the official KWD Gmail password.

## Configuration inventory

| Item | Classification | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public configuration | Browser-safe Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public configuration | Browser-safe anonymous key, constrained by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret | Privileged server-side Supabase/RPC access |
| `GOOGLE_DRIVE_CLIENT_ID` | Server-only configuration | Dedicated Drive Storage OAuth client identifier |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Server-only secret | Dedicated Drive Storage OAuth client secret |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Server-only secret | Official Drive storage account authorization |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Server-only non-secret configuration | Official Drive root folder identifier |
| `GOOGLE_DRIVE_ADMIN_FOLDER_MAP` | Server-only non-secret configuration | Admin logical-destination mapping to Drive folders |
| `ADMIN_UPLOAD_MAX_BYTES` | Server-only non-secret configuration | Optional upload size limit; default is deployment-safe 4 MiB |
| `PHASE4_*` | Local/test-only configuration | Explicit disposable local PostgreSQL concurrency test controls |
| `KWD_SECURITY_*` | Local/test-only configuration | Explicit disposable local Supabase/PostgreSQL security test controls |
| `KWD_UPLOAD_*` | Local/test-only configuration | Explicit disposable local upload-persistence test controls |

### Storage rules

- Keep Production secrets only in approved Production deployment configuration; keep DEV secrets only in DEV configuration.
- Never commit `.env.local`; never place server-only values in `NEXT_PUBLIC_*` variables.
- Do not paste secrets into PRs, GitHub issues, tickets, screenshots, logs, or chat.
- Test database URLs must be provided only for disposable loopback databases. They must never target hosted DEV or Production.
- Root folder IDs are configuration, not passwords, but the official Drive hierarchy must not be made public or casually deleted, replaced, or reorganized. Do not delete the older KWD DOCUMENT CENTER folder without an explicit migration or cleanup decision.

## Rotation and recovery

### Supabase service-role credential

1. Confirm the affected environment and project before opening any Supabase project controls.
2. Generate or retrieve the replacement using the official Supabase controls for that exact project; do not copy it into source code.
3. Update only that environment's server-side deployment configuration.
4. Redeploy or restart the affected application runtime.
5. Verify protected server functionality: sign-in, document list/detail, and an ADMIN-only Users page request. Verify user management remains RPC-only.
6. Confirm browser code and responses do not contain the service-role credential; the service-role client remains server-only.
7. Retire or invalidate the previous credential when Supabase supports it, after replacement verification succeeds.
8. Record the date, environment, operator, and verification result without recording the credential value.

### Google OAuth client secret

1. Confirm the environment and use the `KWD Document Center` Google Cloud project.
2. Rotate the dedicated Drive Storage OAuth client secret through the official Google controls.
3. Preserve the registered Drive setup callback URI and the approved `https://www.googleapis.com/auth/drive.file` scope. Do not broaden the scope.
4. Update `GOOGLE_DRIVE_CLIENT_SECRET` only in the matching server-side deployment configuration.
5. Redeploy or restart, then verify the Drive setup flow and normal server-mediated Drive storage behavior using safe smoke testing.
6. Retire the old client secret only after the replacement is verified. Record the rotation without recording either value.

### Drive refresh token recovery

Use this when the refresh token is revoked, the official storage-account authorization changes, or Drive reports an authorization failure.

1. Confirm the correct environment and that the official storage account is the intended account.
2. An ACTIVE ADMIN starts the approved `/api/admin/drive-setup/authorize` flow and completes Google consent for the official storage account.
3. The setup flow uses a short-lived, HttpOnly, `SameSite=Lax` state cookie and requires the same ACTIVE ADMIN at callback completion. Start a new setup attempt rather than replaying an old callback.
4. Copy the one-time refresh-token response directly into the matching deployment secret configuration. It must never enter Git, logs, tickets, or public documentation.
5. Confirm the configured root folder and mapping are correct; do not alter the Drive hierarchy merely to recover authorization.
6. Redeploy or restart, then safely verify root-folder access and one ordinary Drive-backed document operation.
7. Remove or retire old/revoked authorization material where applicable and record the recovery without token values.

## Outage handling

### Supabase/Auth outage

- After Phase 5 hardening, callback failures produce a generic auth failure, protected authorization fails closed, and proxy refresh exceptions do not grant access.
- Users may be redirected to a generic authentication failure page during an outage. Do not disable authorization or RLS as a workaround.
- Check public service status and deployment configuration names first. Confirm the environment is correct, then retry after service recovery.
- If configuration changed recently, use the relevant rotation procedure and verify with a minimal authenticated request.

### Google Drive outage or authorization failure

- Drive provider errors are translated to safe application failures. Do not expose provider diagnostics to users.
- A Drive upload can safely remain `FAILED` or `PENDING_REGISTRY`; use the normal retry path with the same idempotency key. `PENDING_REGISTRY` retries finalization without another Drive upload.
- Do not manually edit `upload_attempts`, documents, or Drive IDs unless an approved database recovery procedure exists.
- For OAuth authorization failures, follow the refresh-token recovery procedure. For provider outages, wait for recovery and retry the intended operation once; use normal monitoring/log review without copying credential material.

## Database and local-test safety

- Migrations are forward-only once applied. Never edit an already-applied Production migration; create a reviewed corrective migration instead.
- Validate migrations and relevant local integration tests before requesting any hosted migration operation. Production migration work requires explicit review and a separate go/no-go gate.
- The destructive local suites are `phase4-users-concurrency`, `supabase-security-integration`, and `upload-persistence-integration`.
- They require explicit opt-in plus a database target that resolves exclusively to loopback. Never run them against hosted DEV or Production.
- Run the relevant local suite after changes to Phase 4 admin authorization/RPC concurrency, Supabase RLS/ACL boundaries, or upload/finalization database behavior.

## Verification

Normal non-destructive verification:

```bash
npm ci
npm run verify
npm run audit:production
```

`npm run verify` runs tests, typecheck, lint, the Webpack production build, and `git diff --check`. Normal `npm test` intentionally skips the three destructive/local database suites unless their explicit local-only configuration is supplied. Pull-request CI uses `npm ci`, the same verification command, and the production-only high/critical dependency audit; it does not supply application secrets or destructive-test variables.

## Incident response for suspected credential exposure

1. Stop sharing or copying the suspected credential immediately.
2. Identify the credential category and affected environment without reproducing its value.
3. Rotate or revoke it through the official provider controls.
4. Update only the affected deployment configuration and redeploy or restart if required.
5. Verify the affected function with a minimum safe smoke test.
6. Invalidate the previous credential where supported.
7. Review relevant logs and history for exposure without copying the secret into incident records.
8. Document the incident, environment, timing, rotation, and verification result without storing the credential.

Use the matching procedure above for a Supabase service-role key, Google OAuth client secret, or Drive refresh token. Treat any confirmed exposure as requiring rotation; do not assume repository history is clean unless it has been separately reviewed.

## Admin-account safety

Phase 4 prevents an ADMIN from demoting or deactivating their own account through user management, and the database preserves at least one ACTIVE ADMIN. These controls do not replace deliberate account recovery. If administrator access is lost, use an approved recovery process; do not weaken database authorization rules or bypass the RPC boundary.

## Production configuration-change checklist

### Before

- Confirm the exact environment and intended configuration item.
- Consider rollback/recovery implications and run relevant local verification.
- Obtain peer or security review when the change affects credentials, authorization, or storage access.

### Change

- Update only the intended secret or configuration value using approved deployment controls.
- Do not print, log, screenshot, or paste its value.

### After

- Redeploy or restart if required.
- Verify authentication, the ADMIN Users page, document list/detail, and Drive storage when relevant.
- Run minimal appropriate smoke tests and check for unexpected safe-error responses.

## Current Phase 5 security notes

- The service-role client and Drive OAuth credentials remain server-only.
- Protected document metadata responses use `Cache-Control: private, no-store`.
- Drive OAuth state is short-lived and replay-resistant; callback responses consume state and use no-store/no-referrer protections.
- The one-time refresh-token display for manual server configuration is an accepted current operational design. It is ACTIVE ADMIN-only, response-body only, non-cacheable, and frame-restricted.
- The `finalize_admin_upload` `SECURITY DEFINER` audit found no demonstrated exploit: sensitive relations are qualified and untrusted application roles cannot create objects in `public`. Its `search_path = public` remains a LOW defense-in-depth follow-up, not a current blocker.

## Phase 7C.1 controlled hierarchy procedure [PENDING PRODUCTION APPROVAL]

Before a hierarchy rollout, obtain deployment and migration approval, verify
the server-only ADMIN root configuration, and approve the exact existing STATIC
identities to be registered. Accounting is disabled and PRE-POST is excluded.
Never use broad Drive discovery, `files.list`, or guessed provider identities.

The planner `buildStaticHierarchyBootstrapPlan()` consumes trusted configuration
only. It is deterministic, parent-first, skips missing intermediate IDs,
preserves legacy-only destinations, excludes automatic WORKING_FOLDER bootstrap,
and does not mutate Drive or the database. The executor
`executeStaticHierarchyBootstrapPlan()` consumes only a reviewed plan; it
registers parent-first, resolves parent application UUIDs from registration
results, fails fast, and makes no provider calls or production configuration
reads.

Bootstrap can leave partial parent-first registration after a later failure.
Do not delete already registered parents or overwrite a differing provider
identity. Matching replay is idempotent; conflicts fail closed. Actual
production bootstrap has not been executed.

For normal hierarchy creation, preserve one provider ID before create, verify
only the exact ID, and leave ambiguous create/verification failures recoverable
in `CREATING`. A proven object mismatch may be marked failed. Do not perform
provider cleanup, move, rename, delete, or permission changes as recovery.
