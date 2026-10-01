create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  logical_parent_key text not null,
  drive_parent_id text not null,
  name text not null,
  normalized_name text not null,
  drive_folder_id text unique,
  status text not null,
  operation_token uuid,
  lease_expires_at timestamptz,
  created_by uuid not null references public.users(id),
  error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_folders_unique_logical_name unique (logical_parent_key, normalized_name),
  constraint document_folders_status_valid check (status in ('CREATING', 'ACTIVE', 'FAILED')),
  constraint document_folders_error_category_valid check (error_category is null or error_category in ('DRIVE_PERMISSION', 'DRIVE_UNAVAILABLE', 'DRIVE_NOT_FOUND', 'DRIVE_UNKNOWN', 'REGISTRY_FINALIZATION')),
  constraint document_folders_lifecycle_shape check (
    (status = 'CREATING' and operation_token is not null and lease_expires_at is not null and error_category is null)
    or (status = 'ACTIVE' and operation_token is null and lease_expires_at is null and drive_folder_id is not null and error_category is null)
    or (status = 'FAILED' and operation_token is null and lease_expires_at is null and error_category is not null)
  )
);

alter table public.document_folders enable row level security;
revoke all on public.document_folders from public, anon, authenticated;
grant select, insert, update on public.document_folders to service_role;

create or replace function public.admin_claim_document_folder_creation(
  p_actor_id uuid, p_idempotency_key uuid, p_logical_parent_key text, p_drive_parent_id text,
  p_name text, p_normalized_name text, p_operation_token uuid, p_lease_seconds integer default 60
)
returns table (outcome text, folder_id uuid, drive_folder_id text, operation_token uuid)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare target public.document_folders%rowtype;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 300 or p_operation_token is null then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  select * into target from public.document_folders where idempotency_key = p_idempotency_key for update;
  if found then
    if target.logical_parent_key <> p_logical_parent_key or target.drive_parent_id <> p_drive_parent_id or target.name <> p_name or target.normalized_name <> p_normalized_name or target.created_by <> p_actor_id then raise exception 'IDEMPOTENCY_MISMATCH'; end if;
    if target.status = 'ACTIVE' then return query select 'ACTIVE'::text, target.id, target.drive_folder_id, null::uuid; return; end if;
    if target.status = 'CREATING' and target.lease_expires_at > now() then return query select 'IN_PROGRESS'::text, target.id, target.drive_folder_id, null::uuid; return; end if;
    update public.document_folders set status = 'CREATING', operation_token = p_operation_token, lease_expires_at = now() + pg_catalog.make_interval(secs => p_lease_seconds), error_category = null, updated_at = now() where id = target.id;
    return query select 'CLAIMED'::text, target.id, target.drive_folder_id, p_operation_token; return;
  end if;
  begin
    insert into public.document_folders (idempotency_key, logical_parent_key, drive_parent_id, name, normalized_name, status, operation_token, lease_expires_at, created_by)
    values (p_idempotency_key, p_logical_parent_key, p_drive_parent_id, p_name, p_normalized_name, 'CREATING', p_operation_token, now() + pg_catalog.make_interval(secs => p_lease_seconds), p_actor_id)
    returning * into target;
  exception when unique_violation then
    select * into target from public.document_folders where idempotency_key = p_idempotency_key for update;
    if found then
      if target.logical_parent_key <> p_logical_parent_key or target.drive_parent_id <> p_drive_parent_id or target.name <> p_name or target.normalized_name <> p_normalized_name or target.created_by <> p_actor_id then raise exception 'IDEMPOTENCY_MISMATCH'; end if;
      return query select case when target.status = 'ACTIVE' then 'ACTIVE' else 'IN_PROGRESS' end, target.id, target.drive_folder_id, null::uuid; return;
    end if;
    return query select 'DUPLICATE_NAME'::text, null::uuid, null::text, null::uuid; return;
  end;
  return query select 'CLAIMED'::text, target.id, target.drive_folder_id, p_operation_token;
end;
$$;

create or replace function public.admin_set_document_folder_drive_id(p_folder_id uuid, p_actor_id uuid, p_operation_token uuid, p_drive_folder_id text)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  update public.document_folders set drive_folder_id = p_drive_folder_id, updated_at = now()
  where id = p_folder_id and status = 'CREATING' and operation_token = p_operation_token and drive_folder_id is null;
  return found;
end;
$$;

create or replace function public.admin_finalize_document_folder_creation(p_folder_id uuid, p_actor_id uuid, p_operation_token uuid)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  update public.document_folders set status = 'ACTIVE', operation_token = null, lease_expires_at = null, error_category = null, updated_at = now()
  where id = p_folder_id and status = 'CREATING' and operation_token = p_operation_token and drive_folder_id is not null;
  return found;
end;
$$;

create or replace function public.admin_mark_document_folder_failed(p_folder_id uuid, p_actor_id uuid, p_operation_token uuid, p_error_category text)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if p_error_category not in ('DRIVE_PERMISSION', 'DRIVE_UNAVAILABLE', 'DRIVE_NOT_FOUND', 'DRIVE_UNKNOWN', 'REGISTRY_FINALIZATION') then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  update public.document_folders set status = 'FAILED', operation_token = null, lease_expires_at = null, error_category = p_error_category, updated_at = now()
  where id = p_folder_id and status = 'CREATING' and operation_token = p_operation_token;
  return found;
end;
$$;

revoke all on function public.admin_claim_document_folder_creation(uuid, uuid, text, text, text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_set_document_folder_drive_id(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_finalize_document_folder_creation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_mark_document_folder_failed(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_claim_document_folder_creation(uuid, uuid, text, text, text, text, uuid, integer) to service_role;
grant execute on function public.admin_set_document_folder_drive_id(uuid, uuid, uuid, text) to service_role;
grant execute on function public.admin_finalize_document_folder_creation(uuid, uuid, uuid) to service_role;
grant execute on function public.admin_mark_document_folder_failed(uuid, uuid, uuid, text) to service_role;
