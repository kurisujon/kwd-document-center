# KWD Document Center - AI Agent Instruction Manual

## 1. Project Identity
The KWD Document Center is a simple internal document-management application for Kiblawan Water District.

Its primary purpose is:
> Allow authorized KWD staff to upload, register, search, and access official documents efficiently.

It is intentionally simple and is not an enterprise DMS.

---

## 2. Required Reading
Before modifying the project, an AI coding agent MUST read:
- `README.md`
- Relevant documentation under `docs/`

For architectural work, read:
- `docs/05-system-architecture.md`
- `docs/06-data-model.md`
- `docs/07-google-drive-structure.md`
- `docs/08-authentication-and-security.md`
- `docs/09-api-design.md`
- `docs/10-ui-pages.md`
- `docs/11-deployment.md`

For UI work, MUST read:
- `docs/design/design-system.md`

For architecture decisions, MUST read:
- `docs/architecture/`

---

## 3. Source-of-Truth Hierarchy
1. Explicitly approved KWD business requirements
2. `docs/02-requirements.md`
3. Approved architecture documentation
4. Architecture Decision Records
5. `docs/design/design-system.md`
6. `AGENTS.md`
7. Existing implementation

If existing code conflicts with approved documentation, do not silently change the requirements. If documentation conflicts with confirmed business requirements, flag the conflict.

---

## 4. Requirement Classification
Agents MUST respect these classifications:
- **CONFIRMED**
- **PROPOSED**
- **ASSUMPTION**
- **PENDING CONFIRMATION**
- **FUTURE**

Never treat `PROPOSED` as `CONFIRMED`.
Never implement `PENDING CONFIRMATION` by inventing a value.
Never implement `FUTURE` features during the MVP unless explicitly approved.

---

## 5. Technology Stack
- Next.js
- React
- TypeScript
- Supabase
- Google Drive API
- Google Sheets API
- Vercel
- GitHub

Use the existing approved architecture. Do not introduce additional infrastructure unless there is a documented technical reason.

---

## 6. Architecture Rules
```text
    KWD Staff
        ↓
    Next.js
        ↓
    ┌───────────────┬─────────────────┐
    ↓               ↓                 ↓
    Supabase    Google Drive     Google Sheets [Deferred]
```

**Responsibilities:**
- **Next.js**: Application layer and server-side API boundary.
- **Supabase/PostgreSQL**: Authentication, authorized users, roles, permissions, and the Phase 2 application document registry/metadata source of truth.
- **Google Drive**: Actual document file storage; integration begins in Phase 3.
- **Google Sheets**: Not used as the Phase 2 registry. Any future integration or synchronization requires a separate architectural decision and must not create a competing source of truth.
- **Vercel**: Application hosting.

---

## 7. Google Drive Rules
Actual documents MUST remain in Google Drive.

Do NOT:
- move document storage to Supabase Storage
- create another object-storage system
- hard-code unknown Drive folder IDs
- invent the final Drive folder structure

The final Drive structure is currently pending confirmation. Use configuration for document-type-to-folder mapping (e.g., `DOCUMENT_TYPE → DRIVE_FOLDER_ID`).
Google API credentials MUST remain server-side.

---

## 8. Google Sheets Rules
Google Sheets is not used as the Phase 2 application registry. Its future role, including any integration or synchronization, requires a separate architectural decision.
Do not create competing registry sources of truth without that decision.
Do not introduce Elasticsearch or another search engine for MVP.
If the registry architecture needs to change in the future, document the reason and architectural decision first.

---

## 9. Supabase Rules
Supabase is NOT the document file repository.

Use Supabase for:
- authentication
- user records
- roles
- permissions
- approved application data
- audit logs only if approved

Do not duplicate Google Drive documents into Supabase Storage.

---

## 10. Authentication Rules
Google authentication is used to establish identity. Application authorization is separate.

The application MUST verify:
`authenticated user` → `authorized user` → `active user` → `appropriate role`

Do not assume anyone who can authenticate with Google automatically has access. Do not assume all KWD staff use one Google Workspace domain. Never ask users to provide their Google password.

---

## 11. Authorization Rules
Authorization MUST be enforced server-side.

Never trust:
- client-provided role
- hidden UI elements
- frontend-only permission checks

The server must verify permissions for protected operations. Administrative functions must be restricted to authorized administrators.

---

## 12. Security Rules
Never:
- commit secrets
- hard-code credentials
- expose private Google credentials to the browser
- use `NEXT_PUBLIC_*` for server-only secrets
- log credentials
- trust client-side authorization
- bypass validation

Validate: uploaded files, file type, file size, metadata, API input, authorization. Use least-privilege access.

---

## 13. Environment Variables
Expected configuration may include:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_SHEET_ID`

Only values intended for the browser may use `NEXT_PUBLIC_*`. Google secrets MUST remain server-only. Do not create fake credentials. Do not commit `.env` files containing secrets.

---

## 14. Document Upload Rules
Intended workflow:
`User` → `Upload` → `Validate` → `Upload to Google Drive` → `Receive Drive file ID` → `Write registry record` → `Success`

The implementation MUST account for partial failure (e.g., Drive upload succeeds, but Sheets write fails).
Do not falsely report complete success. Use the architecture documented in the approved architecture review for retry/reconciliation/idempotency behavior. Do not introduce distributed systems merely to solve this problem.

---

## 15. Idempotency and Duplicate Prevention
Consider accidental double-clicks, network retries, lost responses, repeated requests, and duplicate document submissions.
Use a simple, maintainable strategy. Do not introduce Kafka, Redis, or other infrastructure solely for idempotency.

---

## 16. Google API Boundary
Keep Google API logic isolated. Prefer a structure conceptually similar to:
```
    Application
        ↓
    Document Service
        ├── Drive Service
        └── Sheets Service
```
Do not scatter direct Google API calls throughout React components.

---

## 17. Data Model Rules
Keep the data model simple. Do not prematurely normalize the database. Do not create entities simply because they are theoretically possible. The document model should support the approved requirements and remain extensible where justified.

---

## 18. API Rules
API endpoints MUST:
1. authenticate
2. authorize
3. validate input
4. perform the operation
5. return safe errors

Never rely on the frontend to protect an endpoint. Do not expose internal implementation details through error responses.

---

## 19. UI / Design Rules
The application uses a minimalist professional design.
Primary visual reference: `https://veldra-sand.vercel.app/` (Inspiration only).

Do NOT copy Veldra's branding, logo, content, exact layouts, or proprietary assets.
Use the general design language: clean, spacious, structured, professional, restrained, strong typography, clear hierarchy, intentional spacing.
The application must NOT look like a generic AI-generated dashboard.
Exception: The restrained bento-style tile layout in `docs/design/design-system.md` Section 27 is owner-approved.

---

## 20. KWD Color System
Use the approved KWD colors:
- Azure: `#007FFF`
- Cobalt: `#0047AB`
- Slate Blue: `#557C99`
- Milky White: `(HEX pending confirmation)`

Do NOT invent a final Milky White HEX value. Use centralized design tokens. Do NOT scatter raw color values throughout components.

---

## 21. UI Anti-Patterns
Avoid purple AI gradients, neon effects, glassmorphism, excessive gradients/cards/rounded containers/shadows/borders/charts/KPI dashboards/animations/icons, decorative dashboards, visual clutter, and generic Tailwind dashboard templates. The UI should look intentionally designed, not AI-generated.
Exception: Restrained bento tiles, `--radius-tile`/`--radius-inner`/`--radius-control` tokens, and inline SVG navigation/upload icons defined in `docs/design/design-system.md` Section 27 are owner-approved.

---

## 22. UX Priority
The most important user task is: > Find and access documents.
Prioritize:
1. Search
2. Document registry
3. Document filtering
4. Document details
5. Upload
6. Administrative functions

Do not turn the home page into an analytics dashboard.

---

## 23. Coding Principles
**Prefer:** simple code, readable code, small focused components, reusable components where justified, explicit logic, strong TypeScript types, clear naming, server-side validation, maintainable architecture.
**Avoid:** premature abstractions, unnecessary design patterns/dependencies, giant components, duplicated business logic, clever code that is difficult to maintain.

---

## 24. Dependency Rules
Before adding a package:
1. Determine whether the functionality can be implemented with the existing stack.
2. Determine whether the dependency provides meaningful value.
3. Check whether it conflicts with the architecture.
4. Avoid adding dependencies for trivial functionality.

Do not add Redis, Kafka, Elasticsearch, Kubernetes, or microservices unless a future approved architecture explicitly requires them.

---

## 25. Testing
Before considering implementation complete, run appropriate TypeScript checks, linting, unit tests, integration tests, and build verification. Tests should focus on real application behavior (authentication, authorization, validation, uploads, registry writes, errors, search, permissions).

---

## 26. Error Handling
Errors should be user-friendly, actionable, safe, and logged appropriately where required. Never expose stack traces, secrets, internal credentials, or unnecessary infrastructure details.

---

## 27. Documentation Synchronization
If implementation changes an architectural decision: DO NOT silently modify the architecture.
Instead: identify the conflict, explain the reason, update the relevant documentation/ADR, obtain/record approval when required, then implement. Documentation and implementation must remain synchronized.

---

## 28. Pending Requirements
When encountering `PENDING CONFIRMATION`, STOP and determine whether the implementation can safely continue without deciding the requirement.
If it cannot: do not invent the answer, document the blocker, request clarification.
If it can: isolate the behavior behind configuration, clearly document the temporary assumption.

---

## 29. MVP Scope
Prioritize the minimum useful system: Google authentication, authorized users, roles, document upload, Google Drive storage, document registry, search, filtering, document detail, Drive access, basic administration.
Do not implement future features unless explicitly approved.

---

## 30. Non-Goals
Do not turn the project into an enterprise DMS, ERP, OCR platform, AI document analysis system, legal review platform, enterprise search engine, workflow engine, microservice architecture, or event-driven distributed platform.

---

## 31. Definition of Done
A feature is not complete merely because the UI exists. Complete when: requirements satisfied, authorization/validation/error handling implemented, tests exist, TS/lint/build passes, docs updated, design system followed, security addressed.

---

## 32. Final Agent Rule
When uncertain:
> DO NOT GUESS.

Check: `requirements` → `architecture` → `ADRs` → `design system`
If still unknown: `STOP`, `DOCUMENT THE QUESTION`, `REQUEST CLARIFICATION`.

Priority: Correctness > Security > Maintainability > Simplicity > Convenience.
The KWD Document Center should remain a small, reliable, maintainable application.
