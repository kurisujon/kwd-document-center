# Architecture Decision Record: Supabase for Auth & App Data

## Status
Accepted

## Context
We need a secure way to authenticate users via Google and store application-specific data (users, roles, permissions) without mixing this purely application-level state into the Google Sheets document registries.

## Decision
We will use Supabase for authentication and to store application users, roles, and permissions. We will **not** use Supabase Storage for the documents themselves (see ADR-001).

## Consequences
- **Positive:** Fast setup for Google Auth. Secure, production-ready PostgreSQL database for user management. Easy integration with Next.js.
- **Negative:** Introduces a third-party dependency alongside Google Workspace.
