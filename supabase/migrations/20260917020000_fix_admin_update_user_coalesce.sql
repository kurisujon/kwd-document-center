-- Phase 4 forward-only correction: COALESCE is PostgreSQL syntax, not a
-- schema-qualified function. Preserve the existing user-management security
-- boundary while replacing the invalid admin_update_user implementation.
create or replace function public.admin_update_user(
  actor_id uuid,
  target_id uuid,
  p_role text default null,
  p_status text default null
)
returns table (
  id uuid,
  email text,
  name text,
  role text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_role text;
  target_status text;
  final_role text;
  final_status text;
  active_admin_count bigint;
begin
  -- Serialize all Phase 4 user-management mutations before reauthorizing the
  -- actor so concurrent cross-target ADMIN removals cannot both succeed.
  perform pg_catalog.pg_advisory_xact_lock(126400, 4);

  if not exists (
    select 1
    from public.users as actor
    where actor.id = actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception using message = 'ADMIN_REQUIRED';
  end if;

  if actor_id = target_id then
    raise exception using message = 'SELF_MODIFICATION_FORBIDDEN';
  end if;

  if p_role is null and p_status is null then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  if p_role is not null and p_role not in ('ADMIN', 'STAFF', 'VIEWER') then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  if p_status is not null and p_status not in ('ACTIVE', 'INACTIVE') then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  select target.role, target.status
  into target_role, target_status
  from public.users as target
  where target.id = target_id
  for update;

  if not found then
    raise exception using message = 'USER_NOT_FOUND';
  end if;

  final_role := coalesce(p_role, target_role);
  final_status := coalesce(p_status, target_status);

  if target_role = 'ADMIN'
    and target_status = 'ACTIVE'
    and (final_role <> 'ADMIN' or final_status <> 'ACTIVE') then
    select pg_catalog.count(*)
    into active_admin_count
    from public.users as active_admin
    where active_admin.role = 'ADMIN'
      and active_admin.status = 'ACTIVE';

    if active_admin_count <= 1 then
      raise exception using message = 'LAST_ACTIVE_ADMIN';
    end if;
  end if;

  return query
  update public.users as target
  set role = final_role,
      status = final_status
  where target.id = target_id
  returning
    target.id,
    target.email,
    target.name,
    target.role,
    target.status,
    target.created_at,
    target.updated_at;

  return;
end;
$$;

-- CREATE OR REPLACE preserves existing function privileges. Reassert the
-- intended RPC boundary explicitly so this corrective migration is auditable.
revoke execute on function public.admin_update_user(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_user(uuid, uuid, text, text)
  to service_role;
