# Architecture Decision Record: Supabase for Auth & App Data

## Status
Accepted

## Context
We need a secure way to authenticate users via Google and store application-specific data (users, roles, permissions, and the Phase 2 document registry) without mixing application state into KWD's existing Google Sheets trackers.

## Decision
We will use Supabase for authentication and to store application users, roles, and permissions. We will **not** use Supabase Storage for the documents themselves (see ADR-001).

## Consequences
- **Positive:** Fast setup for Google Auth. Secure, production-ready PostgreSQL database for user management. Easy integration with Next.js.
- **Negative:** Introduces a third-party dependency alongside Google Workspace.
