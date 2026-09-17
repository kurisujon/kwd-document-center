-- Phase 4 user-management database security boundary.
--
-- Application authorization remains separate from auth.users. Privileged user
-- management is available only through the SECURITY DEFINER RPCs below.

-- Refuse to enable mutations when existing authorization data does not meet
-- the Phase 4 identity and continuity invariants. Identity data is never
-- rewritten automatically by this migration.
do $$
begin
  if exists (
    select 1
    from public.users
  ) and not exists (
    select 1
    from public.users as u
    where u.role = 'ADMIN' and u.status = 'ACTIVE'
  ) then
    raise exception using message = 'PHASE4_PREFLIGHT_ACTIVE_ADMIN_REQUIRED';
  end if;

  if exists (
    select 1
    from public.users as u
    where u.email <> pg_catalog.lower(pg_catalog.btrim(u.email))
  ) then
    raise exception using message = 'PHASE4_PREFLIGHT_NONCANONICAL_EMAIL';
  end if;

  if exists (
    select pg_catalog.lower(pg_catalog.btrim(u.email))
    from public.users as u
    group by pg_catalog.lower(pg_catalog.btrim(u.email))
    having pg_catalog.count(*) > 1
  ) then
    raise exception using message = 'PHASE4_PREFLIGHT_DUPLICATE_EMAIL';
  end if;

  if exists (
    select 1
    from public.users as u
    where pg_catalog.btrim(u.name) = ''
  ) then
    raise exception using message = 'PHASE4_PREFLIGHT_EMPTY_NAME';
  end if;

  if exists (
    select 1
    from public.users as u
    where pg_catalog.char_length(u.name) > 120
  ) then
    raise exception using message = 'PHASE4_PREFLIGHT_NAME_TOO_LONG';
  end if;

  if exists (
    select 1
    from public.users as u
    where pg_catalog.char_length(u.email) > 254
  ) then
    raise exception using message = 'PHASE4_PREFLIGHT_EMAIL_TOO_LONG';
  end if;
end;
$$;

alter table public.users
  drop constraint if exists users_email_lowercase;

alter table public.users
  add constraint users_email_canonical
    check (email = pg_catalog.lower(pg_catalog.btrim(email))),
  add constraint users_email_max_length
    check (pg_catalog.char_length(email) <= 254),
  add constraint users_name_valid
    check (
      pg_catalog.btrim(name) <> ''
      and pg_catalog.char_length(name) <= 120
    );

-- Email is the application authorization identity and is immutable in Phase 4.
create or replace function public.enforce_users_email_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.email is distinct from old.email then
    raise exception using message = 'EMAIL_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists users_email_immutable_trg on public.users;
create trigger users_email_immutable_trg
  before update of email on public.users
  for each row
  execute function public.enforce_users_email_immutable();

-- updated_at is owned by PostgreSQL, not by callers.
create or replace function public.set_users_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at_trg on public.users;
create trigger users_set_updated_at_trg
  before update on public.users
  for each row
  execute function public.set_users_updated_at();

-- Read access remains behind an ADMIN-only server RPC. This does not expand
-- the existing authenticated self-read RLS policy.
create or replace function public.admin_list_users(actor_id uuid)
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
begin
  if not exists (
    select 1
    from public.users as actor
    where actor.id = actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception using message = 'ADMIN_REQUIRED';
  end if;

  return query
  select
    listed_user.id,
    listed_user.email,
    listed_user.name,
    listed_user.role,
    listed_user.status,
    listed_user.created_at,
    listed_user.updated_at
  from public.users as listed_user
  order by listed_user.email asc, listed_user.id asc;
end;
$$;

create or replace function public.admin_create_user(
  actor_id uuid,
  p_email text,
  p_name text,
  p_role text
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
  canonical_email text;
  canonical_name text;
begin
  -- Namespace 126400 is reserved in this application for KWD coordination;
  -- key 4 serializes every Phase 4 user-management mutation.
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

  canonical_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  canonical_name := pg_catalog.btrim(p_name);

  if canonical_email is null
    or canonical_email = ''
    or pg_catalog.char_length(canonical_email) > 254
    or canonical_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  if canonical_name is null
    or canonical_name = ''
    or pg_catalog.char_length(canonical_name) > 120 then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  if p_role is null or p_role not in ('ADMIN', 'STAFF', 'VIEWER') then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from public.users as existing_user
    where existing_user.email = canonical_email
  ) then
    raise exception using message = 'USER_ALREADY_EXISTS';
  end if;

  begin
    return query
    insert into public.users as created_user (email, name, role, status)
    values (canonical_email, canonical_name, p_role, 'ACTIVE')
    returning
      created_user.id,
      created_user.email,
      created_user.name,
      created_user.role,
      created_user.status,
      created_user.created_at,
      created_user.updated_at;
  exception
    when unique_violation then
      raise exception using message = 'USER_ALREADY_EXISTS';
  end;

  return;
end;
$$;

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
  -- This is the same transaction-level lock used by admin_create_user. Actor
  -- authorization intentionally occurs only after the lock has been acquired.
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

  final_role := pg_catalog.coalesce(p_role, target_role);
  final_status := pg_catalog.coalesce(p_status, target_status);

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

-- Keep ordinary authenticated self-read access, but make all application
-- mutations pass through the RPC boundary even when using service_role.
revoke insert, update, delete on table public.users
  from anon, authenticated, service_role;

revoke execute on function public.admin_list_users(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_create_user(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_update_user(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_list_users(uuid) to service_role;
grant execute on function public.admin_create_user(uuid, text, text, text) to service_role;
grant execute on function public.admin_update_user(uuid, uuid, text, text) to service_role;
