# Architecture Decision Record: Phase 2 Supabase Registry and Deferred Google Sheets Role

## Status
Accepted clarification; the original Google Sheets registry decision is deferred for Phase 3 review.

## Context
KWD currently uses various Google Sheets to track documents (Memorandum Tracker, Board Resolution Tracker, etc.). The application needs a registry that supports document search, filtering, sorting, pagination, and detail retrieval. Phase 2 must provide that registry without beginning Google integration.

## Decision
For Phase 2, Supabase/PostgreSQL is the application's document metadata registry. The application reads and writes Phase 2 registry data through its server-side document registry boundary.

Google Sheets is not implemented in Phase 2. Its future role, including whether it is synchronized, migrated, retained as a separate operational tracker, or not used by the application, requires an explicit architectural decision. Google Sheets must not become a competing source of truth without that decision.

## Consequences
- **Positive:** PostgreSQL provides the Phase 2 application with direct support for structured queries, filtering, sorting, pagination, and detail retrieval.
- **Positive:** Google API credentials and integration complexity remain outside Phase 2.
- **Negative:** Existing Google Sheets trackers are not automatically part of the Phase 2 application registry.
- **Future:** Google Sheets integration and any synchronization or migration strategy must be documented and approved separately during Phase 3 planning.
