# Architecture Decision Record: Next.js and Vercel

## Status
Accepted

## Context
We need a framework and hosting platform for the frontend user interface and the backend API routes that will securely communicate with Google APIs and Supabase.

## Decision
We will use Next.js (React) for the full-stack framework and Vercel for hosting.

## Consequences
- **Positive:** Next.js provides seamless server-side rendering and secure API routes within a single repository, hiding secrets from the client. Vercel offers zero-configuration deployment, excellent performance, and very low maintenance overhead for the district.
- **Negative:** Ties the deployment model closely to serverless environments (though Next.js can be self-hosted if absolutely necessary).
