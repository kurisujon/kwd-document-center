# KWD Document Center V2 modernization report

Date: 2026-10-14  
Branch: `feature/kwd-fullstack-modernization`  
Starting commit: `8666b26`

Implementation commit: `609cffc` (`feat(ui): modernize document workspace experience`)

## Outcome

The existing KWD Document Center implementation was audited across its App Router pages, shared UI components, API routes, server authorization boundary, document/folder/user services, migrations, and automated tests. The authenticated experience now uses one restrained, responsive enterprise workspace design: a focused navigation shell, document-workflow overview, prominent registry search, clearer results and detail hierarchy, unified upload surfaces, and consistent administration, dialog, empty, loading, error, and public-page treatments. No API, persistence, Drive mapping, credential, role, active-user, idempotency, migration, or provider contract was changed.

The overview uses only live registry facts (`result.total` and the current filter count). It does not introduce analytics, charts, reports, or fabricated metrics, and `/documents` remains the authenticated home. The unresolved Milky White value remains the documented neutral token fallback; no new color was invented.

## Scope audited

- Public pages: login and privacy policy.
- Authenticated shell: desktop sidebar, mobile navigation, role-aware links, current-user area, and sign-out.
- Documents: workflow-oriented overview, search, filtering, sorting, pagination, result actions, deletion, detail metadata, Drive open, and download.
- Uploads: multi-file and folder modes, destination discovery, review tables, progress, retry, bulk metadata, CSV import/template/preview, results CSV export, and supported Office/image/text files.
- Folder management: legacy controlled creation, hierarchy management, destination activation, safe logical inputs, and provider-ID isolation.
- Administration: authorized-user list, role updates, activation/deactivation, self-protection, and add-user flow.
- Backend boundaries: authenticated/ACTIVE/role authorization, same-origin mutation checks, Supabase registry/RPC ownership, Drive service isolation, safe errors, deletion lifecycle, upload and folder idempotency/recovery, and migration contracts.

No evidence-backed backend regression was found by the repository suite, so no speculative backend or migration changes were made.

## Implementation decisions

- Preserved the approved Azure, Cobalt, and Slate Blue tokens and centralized all design values in `globals.css`.
- Kept decoration restrained: square-to-small radii, mostly border/spacing hierarchy, one elevated dialog treatment, no glassmorphism, no decorative charts, and no excessive gradients.
- Added a compact bento-inspired registry overview containing document count, active-filter state, and workflow guidance only.
- Made mobile navigation an explicit labeled control with a dismissible scrim; document-detail routes keep Documents active while Upload has an independent active state.
- Retained horizontal scrolling for data-dense review tables rather than hiding fields or changing upload behavior.

## Verification evidence

### Automated checks

| Command | Result |
|---|---|
| `npm ci` | Passed; 477 packages installed from lockfile. The install summary reported dependency advisories, checked separately below. |
| `npm test` | Passed before changes: 310 tests, 306 passed, 4 skipped, 0 failed. |
| `npm test -- --test-name-pattern='authenticated navigation\|modern shell\|all approved Admin file formats\|CSV accepts\|Folder CSV\|results CSV'` | Passed after changes: 312 tests, 308 passed, 4 skipped, 0 failed. The repository script places its file globs before the forwarded argument, so Node executed the complete suite rather than filtering it. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with 0 errors and 2 pre-existing warnings (`postcss.config.mjs` anonymous default export and an unused test parameter in `tests/admin-documents.test.ts`). |
| `npm run build -- --webpack` | Passed; production build compiled, typechecked, generated all 17 static pages, and emitted the expected dynamic route table. Loopback Supabase was unavailable during prerender and the protected authorization boundary failed closed as designed. |
| `git diff --check` | Passed. |
| `npm run audit:production` | Environment-limited: npm registry DNS returned `EAI_AGAIN`; no audit conclusion is claimed. |

The four expected test skips require an explicitly opted-in disposable local PostgreSQL target: folder concurrency, Phase 4 concurrency, Supabase security integration, and upload persistence/finalization. Both sandboxed and approved attempts to start the repository's loopback Supabase stack failed at Docker health inspection, and `pg_isready` confirmed no response on loopback ports 54322 or 5432. No hosted DEV or Production service was contacted.

### CSV and Excel workflows

- CSV validation covered the Windows MIME variant, canonical MIME forwarding, strict UTF-8 parsing, BOM, CRLF/LF, quoted and multiline fields, malformed data, exact byte/row/header limits, canonical relative paths, duplicate/collision rejection, atomic unmatched-path rejection, preview/apply behavior, reversible spreadsheet formula protection, template export, and results export.
- Excel validation covered both `.xls` and `.xlsx` in the approved-format matrix, canonical extension/MIME mapping, file-signature plausibility, unchanged byte forwarding, download MIME/filename/byte preservation, folder selection, and independent per-file upload behavior.
- No external spreadsheet service or Google Sheets registry was introduced.

### Real browser QA

Browser: Orca embedded browser against `next dev` on `http://localhost:3000`; no hosted environment was used.

- Login was rendered and inspected at 320, 390, 768, 1024, and 1440 CSS-pixel widths. Each measurement reported `scrollWidth === innerWidth`, the `Document Center` heading, and no horizontal overflow.
- Privacy Policy was rendered and inspected at the same five widths. Each measurement reported no horizontal overflow, the `Privacy Policy` heading, and the `Back to sign in` action. The action was activated in the real browser and returned to `/login`.
- Direct requests to `/documents`, `/documents/upload`, `/admin/users`, and a valid-shape `/documents/[id]` route were exercised in the real browser without a session. Every route returned to `/login`, confirming the server authorization boundary remained active.
- A viewport screenshot of the 320px login page was captured through Orca, and semantic browser snapshots were captured for login and the complete privacy-policy heading/link structure.

Authenticated visual QA of the protected document, upload, folder, detail, and user-management pages could not be executed in a real browser because the disposable loopback Supabase/Docker runtime was unavailable. Those modules were exercised through their existing JSDOM interaction suites and the production build, but that is not represented as equivalent to authenticated browser QA.

## Security and contract audit

- Protected routes still resolve authorization server-side; unauthenticated requests redirect to login.
- Role-aware navigation remains presentation only; API/server role checks and ACTIVE-user enforcement remain authoritative.
- Supabase remains the sole metadata registry and Google Drive remains file storage through the existing server-only boundary.
- No secrets, credentials, Drive IDs, mappings, environment values, or provider diagnostics were added or exposed.
- Existing upload, folder, deletion, user-management, idempotency, token/lease, recovery, and safe-error tests passed.
- Migrations were inspected and left unchanged; no destructive or hosted migration was attempted.
- Phase 7F/7G, analytics, reports, settings expansion, and Google Sheets integration were not implemented.

## Release readiness

Code-level readiness is green: tests, typecheck, lint, production build, and diff hygiene pass. Release readiness remains **conditional** until an operator with a working disposable loopback Supabase/Docker stack runs the four opted-in PostgreSQL suites and completes authenticated browser QA for Documents, Upload (files and folder/CSV flows), Document Detail/actions, folder creation/hierarchy, and User Access at the five required widths. The production dependency audit must also be rerun when registry DNS is available.

No Production deployment, hosted database call, credential change, Drive mapping change, migration application, or destructive provider operation was performed.
