-- The server-side upload repository reads finalized documents during
-- idempotency reuse. Keep this privilege limited to SELECT.
grant select on public.documents to service_role;
