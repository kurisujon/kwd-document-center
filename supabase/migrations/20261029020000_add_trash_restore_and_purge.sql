-- Milestone 1 Task 3 (ADR-006): Soft Delete, Restore, and Admin Purge.
-- Soft delete marks deletion_state = 'DELETED' without touching Google Drive.
-- Admin Purge uses the leased Drive Trash flow and requires a non-empty reason.

alter table public.documents
  add column purged_at timestamptz,
  add column purged_by uuid references public.users(id),
  add column purge_reason text;

alter table public.documents
  drop constraint if exists documents_deletion_state_shape;

alter table public.documents
  add constraint documents_deletion_state_shape
  check (
    (deletion_state = 'ACTIVE'
      and delete_started_at is null and delete_operation_token is null and delete_lease_expires_at is null
      and delete_error_category is null and deleted_at is null and deleted_by is null and drive_trashed_at is null
      and purged_at is null and purged_by is null and purge_reason is null)
    or (deletion_state = 'DELETE_PENDING'
      and delete_started_at is not null and delete_operation_token is not null and delete_lease_expires_at is not null
      and delete_error_category is null
      and ((deleted_at is null and deleted_by is null) or (deleted_at is not null and deleted_by is not null))
      and purged_at is null and purged_by is null and purge_reason is null)
    or (deletion_state = 'DELETE_FAILED'
      and delete_started_at is not null and delete_operation_token is null and delete_lease_expires_at is null
      and delete_error_category is not null
      and ((deleted_at is null and deleted_by is null) or (deleted_at is not null and deleted_by is not null))
      and purged_at is null and purged_by is null and purge_reason is null)
    or (deletion_state = 'DELETED'
      and delete_started_at is not null and delete_operation_token is null and delete_lease_expires_at is null
      and delete_error_category is null and deleted_at is not null and deleted_by is not null)
  ),
  add constraint documents_purge_state_shape
  check (
    (purged_at is null and purged_by is null and purge_reason is null)
    or (
      deletion_state = 'DELETED'
      and purged_at is not null
      and purged_by is not null
      and purge_reason is not null
      and pg_catalog.btrim(purge_reason) <> ''
      and pg_catalog.char_length(pg_catalog.btrim(purge_reason)) <= 500
    )
  );

create index documents_trash_deleted_at_idx
  on public.documents (deleted_at desc)
  where deletion_state in ('DELETED', 'DELETE_FAILED') and purged_at is null;

create or replace function public.admin_soft_delete_document(
  p_document_id uuid,
  p_actor_id uuid
)
returns table (outcome text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.documents%rowtype;
begin
  if p_document_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into target
  from public.documents
  where document_id = p_document_id
  for update;

  if not found then
    return query select 'NOT_FOUND'::text;
    return;
  end if;

  if target.deletion_state = 'DELETED' then
    return query select 'ALREADY_DELETED'::text;
    return;
  end if;

  if target.deletion_state = 'DELETE_PENDING' and target.delete_lease_expires_at > now() then
    return query select 'IN_PROGRESS'::text;
    return;
  end if;

  update public.documents
  set deletion_state = 'DELETED',
      delete_started_at = coalesce(target.delete_started_at, now()),
      deleted_at = now(),
      deleted_by = p_actor_id,
      drive_trashed_at = null,
      delete_operation_token = null,
      delete_lease_expires_at = null,
      delete_error_category = null
  where document_id = p_document_id;

  perform public.append_audit_log_entry(
    p_actor_id,
    'DOCUMENT_DELETE',
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', target.document_type,
      'document_number', coalesce(target.document_number, ''),
      'file_name', coalesce(target.file_name, ''),
      'drive_trashed', false
    )
  );

  return query select 'DELETED'::text;
end;
$$;

revoke all on function public.admin_soft_delete_document(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_soft_delete_document(uuid, uuid)
  to service_role;

create or replace function public.admin_list_trashed_documents(
  p_actor_id uuid
)
returns table (
  document_id uuid,
  document_type text,
  document_number text,
  document_date date,
  subject text,
  file_name text,
  file_type text,
  confidential boolean,
  deletion_state text,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_by_email text,
  drive_trashed_at timestamptz,
  delete_error_category text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
  select
    d.document_id,
    d.document_type,
    d.document_number,
    d.document_date,
    d.subject,
    d.file_name,
    d.file_type,
    d.confidential,
    d.deletion_state,
    d.deleted_at,
    d.deleted_by,
    u.email as deleted_by_email,
    d.drive_trashed_at,
    d.delete_error_category
  from public.documents as d
  left join public.users as u on u.id = d.deleted_by
  where d.deletion_state in ('DELETED', 'DELETE_FAILED')
    and d.purged_at is null
  order by coalesce(d.deleted_at, d.delete_started_at, d.updated_at) desc, d.document_id asc;
end;
$$;

revoke all on function public.admin_list_trashed_documents(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_trashed_documents(uuid)
  to service_role;

create or replace function public.admin_prepare_document_restore(
  p_document_id uuid,
  p_actor_id uuid
)
returns table (
  outcome text,
  drive_file_id text,
  needs_drive_untrash boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.documents%rowtype;
begin
  if p_document_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into target
  from public.documents
  where document_id = p_document_id
  for update;

  if not found then
    return query select 'NOT_FOUND'::text, null::text, false;
    return;
  end if;

  if target.purged_at is not null then
    return query select 'ALREADY_PURGED'::text, target.drive_file_id, false;
    return;
  end if;

  if target.deletion_state = 'ACTIVE' then
    return query select 'ALREADY_ACTIVE'::text, target.drive_file_id, false;
    return;
  end if;

  if target.deletion_state = 'DELETE_PENDING' and target.delete_lease_expires_at > now() then
    return query select 'IN_PROGRESS'::text, target.drive_file_id, false;
    return;
  end if;

  if target.drive_trashed_at is not null and target.drive_file_id is not null then
    return query select 'NEEDS_DRIVE_UNTRASH'::text, target.drive_file_id, true;
    return;
  end if;

  update public.documents
  set deletion_state = 'ACTIVE',
      delete_started_at = null,
      delete_operation_token = null,
      delete_lease_expires_at = null,
      delete_error_category = null,
      deleted_at = null,
      deleted_by = null,
      drive_trashed_at = null
  where document_id = p_document_id;

  perform public.append_audit_log_entry(
    p_actor_id,
    'DOCUMENT_RESTORE',
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', target.document_type,
      'document_number', coalesce(target.document_number, ''),
      'file_name', coalesce(target.file_name, ''),
      'drive_untrashed', false
    )
  );

  return query select 'RESTORED'::text, target.drive_file_id, false;
end;
$$;

revoke all on function public.admin_prepare_document_restore(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_prepare_document_restore(uuid, uuid)
  to service_role;

create or replace function public.admin_complete_document_restore(
  p_document_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.documents%rowtype;
begin
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into target
  from public.documents
  where document_id = p_document_id
  for update;

  if not found or target.purged_at is not null or target.deletion_state not in ('DELETED', 'DELETE_FAILED') then
    return false;
  end if;

  update public.documents
  set deletion_state = 'ACTIVE',
      delete_started_at = null,
      delete_operation_token = null,
      delete_lease_expires_at = null,
      delete_error_category = null,
      deleted_at = null,
      deleted_by = null,
      drive_trashed_at = null
  where document_id = p_document_id;

  perform public.append_audit_log_entry(
    p_actor_id,
    'DOCUMENT_RESTORE',
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', target.document_type,
      'document_number', coalesce(target.document_number, ''),
      'file_name', coalesce(target.file_name, ''),
      'drive_untrashed', true
    )
  );

  return true;
end;
$$;

revoke all on function public.admin_complete_document_restore(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_complete_document_restore(uuid, uuid)
  to service_role;

create or replace function public.admin_claim_document_purge(
  p_document_id uuid,
  p_actor_id uuid,
  p_operation_token uuid,
  p_lease_seconds integer default 60
)
returns table (outcome text, drive_file_id text, operation_token uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.documents%rowtype;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 300 or p_operation_token is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into target
  from public.documents
  where document_id = p_document_id
  for update;

  if not found then
    return query select 'NOT_FOUND'::text, null::text, null::uuid;
    return;
  end if;

  if target.purged_at is not null then
    return query select 'ALREADY_PURGED'::text, target.drive_file_id, null::uuid;
    return;
  end if;

  if target.deletion_state = 'ACTIVE' then
    return query select 'NOT_DELETED'::text, target.drive_file_id, null::uuid;
    return;
  end if;

  if target.deletion_state = 'DELETE_PENDING' and target.delete_lease_expires_at > now() then
    return query select 'IN_PROGRESS'::text, target.drive_file_id, null::uuid;
    return;
  end if;

  update public.documents
  set deletion_state = 'DELETE_PENDING',
      delete_started_at = coalesce(target.delete_started_at, now()),
      deleted_at = coalesce(target.deleted_at, now()),
      deleted_by = coalesce(target.deleted_by, p_actor_id),
      delete_operation_token = p_operation_token,
      delete_lease_expires_at = now() + pg_catalog.make_interval(secs => p_lease_seconds),
      delete_error_category = null
  where document_id = p_document_id;

  return query select 'CLAIMED'::text, target.drive_file_id, p_operation_token;
end;
$$;

revoke all on function public.admin_claim_document_purge(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_claim_document_purge(uuid, uuid, uuid, integer)
  to service_role;

create or replace function public.admin_finalize_document_purge(
  p_document_id uuid,
  p_actor_id uuid,
  p_operation_token uuid,
  p_drive_trashed boolean,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_doc public.documents%rowtype;
begin
  if v_reason = '' or pg_catalog.char_length(v_reason) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.documents
  set deletion_state = 'DELETED',
      deleted_at = coalesce(deleted_at, now()),
      deleted_by = coalesce(deleted_by, p_actor_id),
      drive_trashed_at = case when p_drive_trashed then now() else drive_trashed_at end,
      purged_at = now(),
      purged_by = p_actor_id,
      purge_reason = v_reason,
      delete_operation_token = null,
      delete_lease_expires_at = null,
      delete_error_category = null
  where document_id = p_document_id
    and deletion_state = 'DELETE_PENDING'
    and delete_operation_token = p_operation_token
  returning * into v_doc;

  if not found then
    return false;
  end if;

  perform public.append_audit_log_entry(
    p_actor_id,
    'DOCUMENT_PURGE',
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', v_doc.document_type,
      'document_number', coalesce(v_doc.document_number, ''),
      'file_name', coalesce(v_doc.file_name, ''),
      'drive_trashed', coalesce(p_drive_trashed, false),
      'reason', v_reason
    )
  );

  return true;
end;
$$;

revoke all on function public.admin_finalize_document_purge(uuid, uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_document_purge(uuid, uuid, uuid, boolean, text)
  to service_role;
