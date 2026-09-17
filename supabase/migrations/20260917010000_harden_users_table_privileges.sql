-- Phase 4 follow-up: public.users administration is RPC-only for application
-- roles. Reset direct table grants to least privilege without changing RLS or
-- the existing SECURITY DEFINER RPC execution grants.
revoke all privileges on table public.users
  from anon, authenticated, service_role;

-- Preserve the Phase 1 authenticated self-read path. Row-level security still
-- restricts each authenticated user to their own authorization record.
grant select on table public.users to authenticated;
