# Development Roadmap

## Phase 0 — Requirements & Documentation
**Status: Current**
- Produce complete, implementation-ready documentation set.
- Define architecture, requirements, data models, and design system.
- *Do not begin implementation during this phase.*

## Phase 1 — Foundation
- Setup Next.js with TypeScript and Tailwind CSS.
- Setup Supabase project.
- Implement Google authentication.
- Build basic application shell and navigation.

## Phase 2 — Document Registry
- Implement the Supabase/PostgreSQL document registry data model.
- Build the registry interface (table).
- Implement search, filters, and sorting.
- Build the document detail page.
- Do not implement Google Drive, Google Sheets, file uploads, or registry synchronization in this phase.

## Phase 3 — Google Integration
- Implement Admin-only Google Drive upload, open, and download operations.
- Keep Supabase/PostgreSQL as the sole application metadata registry.
- Google Sheets and Accounting are outside this implementation.

## Phase 4 — User Management
- Implement role-based access control (Admin, Staff, Viewer).
- Build the Users administration page.
- Secure API routes based on roles.

## Phase 5 — Testing & Hardening
- Write unit tests and integration tests for critical paths.
- Conduct security review (credentials, access control).
- Refine error handling and edge cases.
- Create production build.

## Phase 6 — Deployment
- Deploy to Vercel.
- Configure production environment variables.
- Write operational documentation and handover.
