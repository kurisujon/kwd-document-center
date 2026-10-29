-- Milestone 1 Task 2: Append-only audit log and transactional RPC wiring.
-- Per owner decision: no IP addresses are stored in audit_log.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(id),
  actor_email text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_valid check (
    action in (
      'DOCUMENT_UPLOAD',
      'DOCUMENT_OPEN',
      'DOCUMENT_DOWNLOAD',
      'DOCUMENT_CONFIDENTIALITY_CHANGE',
      'DOCUMENT_DELETE',
      'DOCUMENT_RESTORE',
      'DOCUMENT_PURGE',
      'USER_CREATE',
      'USER_UPDATE',
      'FOLDER_CREATE'
    )
  ),
  constraint audit_log_entity_type_valid check (
    entity_type in ('DOCUMENT', 'USER', 'FOLDER')
  ),
  constraint audit_log_metadata_object check (
    pg_catalog.jsonb_typeof(metadata) = 'object'
  )
);

create index audit_log_created_at_idx
  on public.audit_log (created_at desc, id desc);

create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

create index audit_log_actor_idx
  on public.audit_log (actor_id, created_at desc);

create index audit_log_action_idx
  on public.audit_log (action, created_at desc);

create or replace function public.enforce_audit_log_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using message = 'AUDIT_LOG_IMMUTABLE';
end;
$$;

drop trigger if exists audit_log_immutable_trg on public.audit_log;
create trigger audit_log_immutable_trg
  before update or delete on public.audit_log
  for each row
  execute function public.enforce_audit_log_append_only();

alter table public.audit_log enable row level security;

-- Direct table access is revoked from all roles including service_role.
-- All inserts and reads must pass through SECURITY DEFINER functions.
revoke all on table public.audit_log from public, anon, authenticated, service_role;

create or replace function public.append_audit_log_entry(
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_email text;
  v_entry_id uuid;
begin
  select u.email
  into v_actor_email
  from public.users as u
  where u.id = p_actor_id;

  if v_actor_email is null then
    raise exception using message = 'ACTOR_NOT_FOUND';
  end if;

  insert into public.audit_log (
    actor_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_actor_id,
    v_actor_email,
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

revoke all on function public.append_audit_log_entry(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.record_document_access_audit(
  p_actor_id uuid,
  p_document_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_doc public.documents%rowtype;
begin
  if p_action is null or p_action not in ('DOCUMENT_OPEN', 'DOCUMENT_DOWNLOAD') then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  if not public.can_read_document(p_actor_id, p_document_id) then
    raise exception using message = 'DOCUMENT_NOT_FOUND';
  end if;

  select *
  into v_doc
  from public.documents
  where document_id = p_document_id;

  if not found then
    raise exception using message = 'DOCUMENT_NOT_FOUND';
  end if;

  return public.append_audit_log_entry(
    p_actor_id,
    p_action,
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', v_doc.document_type,
      'document_number', coalesce(v_doc.document_number, ''),
      'file_name', coalesce(v_doc.file_name, ''),
      'confidential', v_doc.confidential
    )
  );
end;
$$;

revoke all on function public.record_document_access_audit(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_document_access_audit(uuid, uuid, text)
  to service_role;

create or replace function public.admin_list_audit_logs(
  p_actor_id uuid,
  p_filter_actor text default null,
  p_filter_action text default null,
  p_filter_entity_type text default null,
  p_filter_entity_id text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  actor_id uuid,
  actor_email text,
  action text,
  entity_type text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_filter text := nullif(pg_catalog.btrim(coalesce(p_filter_actor, '')), '');
  v_action_filter text := nullif(pg_catalog.btrim(coalesce(p_filter_action, '')), '');
  v_entity_type_filter text := nullif(pg_catalog.btrim(coalesce(p_filter_entity_type, '')), '');
  v_entity_id_filter text := nullif(pg_catalog.btrim(coalesce(p_filter_entity_id, '')), '');
begin
  if not exists (
    select 1
    from public.users as actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception using message = 'ADMIN_REQUIRED';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    l.id,
    l.actor_id,
    l.actor_email,
    l.action,
    l.entity_type,
    l.entity_id,
    l.metadata,
    l.created_at,
    pg_catalog.count(*) over () as total_count
  from public.audit_log as l
  where (
      v_actor_filter is null
      or l.actor_email ilike '%' || v_actor_filter || '%'
      or l.actor_id::text = v_actor_filter
    )
    and (v_action_filter is null or l.action = v_action_filter)
    and (v_entity_type_filter is null or l.entity_type = v_entity_type_filter)
    and (v_entity_id_filter is null or l.entity_id = v_entity_id_filter)
    and (p_date_from is null or l.created_at >= p_date_from)
    and (p_date_to is null or l.created_at <= p_date_to)
  order by l.created_at desc, l.id desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.admin_list_audit_logs(uuid, text, text, text, text, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_audit_logs(uuid, text, text, text, text, timestamptz, timestamptz, integer, integer)
  to service_role;

-- Wire transactional audit logging into existing mutation RPCs.

create or replace function public.admin_set_document_confidential(
  p_document_id uuid,
  p_actor_id uuid,
  p_confidential boolean
)
returns public.documents
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_previous boolean;
  updated_document public.documents%rowtype;
begin
  if p_document_id is null or p_confidential is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1
    from public.users as actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select d.confidential
  into v_previous
  from public.documents as d
  where d.document_id = p_document_id
    and d.status = 'ACTIVE'
    and d.deletion_state = 'ACTIVE'
  for update;

  if not found then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  update public.documents
  set confidential = p_confidential
  where document_id = p_document_id
    and status = 'ACTIVE'
    and deletion_state = 'ACTIVE'
  returning * into updated_document;

  perform public.append_audit_log_entry(
    p_actor_id,
    'DOCUMENT_CONFIDENTIALITY_CHANGE',
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'previous_confidential', v_previous,
      'confidential', p_confidential,
      'document_type', updated_document.document_type,
      'document_number', coalesce(updated_document.document_number, '')
    )
  );

  return updated_document;
end;
$$;

revoke all on function public.admin_set_document_confidential(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_document_confidential(uuid, uuid, boolean)
  to service_role;

create or replace function public.finalize_admin_upload(
  attempt_id uuid,
  p_document_type text,
  p_document_number text,
  p_document_date date,
  p_subject text,
  p_persons_involved text,
  p_drive_file_id text,
  p_drive_url text,
  p_file_name text,
  p_file_type text,
  p_filing_year integer,
  p_filing_subcategory text,
  p_created_by text
)
returns public.documents
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  locked_attempt public.upload_attempts;
  existing_document public.documents;
  created_document public.documents;
begin
  select * into locked_attempt
  from public.upload_attempts
  where id = attempt_id
  for update;

  if not found then
    raise exception 'UPLOAD_ATTEMPT_NOT_FOUND';
  end if;

  if locked_attempt.status = 'COMPLETE' and locked_attempt.document_id is not null then
    select * into existing_document
    from public.documents
    where document_id = locked_attempt.document_id;
    return existing_document;
  end if;

  if locked_attempt.status <> 'PENDING_REGISTRY'
    or locked_attempt.drive_file_id <> p_drive_file_id
    or locked_attempt.document_id is not null then
    raise exception 'UPLOAD_ATTEMPT_NOT_FINALIZABLE';
  end if;

  insert into public.documents (
    document_type, document_number, document_date, subject,
    persons_involved, drive_file_id, drive_url, file_name, file_type,
    status, created_by, filing_year, filing_subcategory
  ) values (
    p_document_type, nullif(p_document_number, ''), p_document_date, p_subject,
    nullif(p_persons_involved, ''), p_drive_file_id, p_drive_url, p_file_name,
    p_file_type, 'ACTIVE', p_created_by, p_filing_year,
    nullif(p_filing_subcategory, '')
  ) returning * into created_document;

  update public.upload_attempts
  set status = 'COMPLETE', document_id = created_document.document_id,
      safe_error_code = null, updated_at = now()
  where id = attempt_id;

  perform public.append_audit_log_entry(
    locked_attempt.created_by,
    'DOCUMENT_UPLOAD',
    'DOCUMENT',
    created_document.document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', created_document.document_type,
      'document_number', coalesce(created_document.document_number, ''),
      'file_name', coalesce(created_document.file_name, ''),
      'upload_mode', 'SINGLE'
    )
  );

  return created_document;
end;
$$;

revoke all on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text)
  to service_role;

create or replace function public.admin_finalize_folder_upload(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_expected_drive_file_id text
)
returns public.documents
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  locked_attempt public.upload_attempts%rowtype;
  existing_document public.documents%rowtype;
  created_document public.documents%rowtype;
  creator_email text;
begin
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.status = 'ACTIVE'
      and actor.role in ('STAFF', 'ADMIN')
  ) then
    raise exception 'UPLOAD_AUTHORIZATION_REQUIRED';
  end if;

  select * into locked_attempt
  from public.upload_attempts
  where id = p_attempt_id
  for update;

  if not found
    or locked_attempt.created_by is distinct from p_actor_id
    or locked_attempt.destination_folder_id is null
    or locked_attempt.source_relative_path is null
    or locked_attempt.normalized_relative_path_key is null
    or locked_attempt.content_sha256 is null then
    raise exception 'FOLDER_UPLOAD_ATTEMPT_INVALID';
  end if;

  if locked_attempt.status = 'COMPLETE' and locked_attempt.document_id is not null then
    select * into existing_document
    from public.documents
    where document_id = locked_attempt.document_id;
    if found then return existing_document; end if;
    raise exception 'FOLDER_UPLOAD_DOCUMENT_MISSING';
  end if;

  if locked_attempt.status <> 'PENDING_REGISTRY'
    or locked_attempt.drive_file_id is distinct from p_expected_drive_file_id
    or locked_attempt.document_id is not null then
    raise exception 'FOLDER_UPLOAD_NOT_FINALIZABLE';
  end if;

  select email into creator_email
  from public.users
  where id = locked_attempt.created_by;

  if creator_email is null then
    raise exception 'FOLDER_UPLOAD_CREATOR_MISSING';
  end if;

  insert into public.documents (
    document_type, document_number, document_date, subject,
    persons_involved, drive_file_id, drive_url, file_name, file_type,
    status, created_by, filing_year, filing_subcategory,
    destination_folder_id, source_relative_path
  ) values (
    locked_attempt.metadata_snapshot ->> 'document_type',
    nullif(locked_attempt.metadata_snapshot ->> 'document_number', ''),
    (locked_attempt.metadata_snapshot ->> 'document_date')::date,
    locked_attempt.metadata_snapshot ->> 'subject',
    nullif(locked_attempt.metadata_snapshot ->> 'persons_involved', ''),
    locked_attempt.drive_file_id,
    'https://drive.google.com/file/d/' || locked_attempt.drive_file_id || '/view',
    locked_attempt.metadata_snapshot ->> 'file_name',
    locked_attempt.metadata_snapshot ->> 'file_type',
    'ACTIVE', creator_email,
    nullif(locked_attempt.metadata_snapshot ->> 'filing_year', '')::integer,
    nullif(locked_attempt.metadata_snapshot ->> 'filing_subcategory', ''),
    locked_attempt.destination_folder_id, locked_attempt.source_relative_path
  ) returning * into created_document;

  update public.upload_attempts
  set status = 'COMPLETE', document_id = created_document.document_id,
      safe_error_code = null, updated_at = now()
  where id = locked_attempt.id
    and status = 'PENDING_REGISTRY'
    and drive_file_id = p_expected_drive_file_id
    and document_id is null;

  if not found then raise exception 'FOLDER_UPLOAD_COMPLETION_CONFLICT'; end if;

  perform public.append_audit_log_entry(
    p_actor_id,
    'DOCUMENT_UPLOAD',
    'DOCUMENT',
    created_document.document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', created_document.document_type,
      'document_number', coalesce(created_document.document_number, ''),
      'file_name', coalesce(created_document.file_name, ''),
      'upload_mode', 'FOLDER',
      'destination_folder_id', created_document.destination_folder_id
    )
  );

  return created_document;
end;
$$;

revoke all on function public.admin_finalize_folder_upload(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_folder_upload(uuid, uuid, text)
  to service_role;

create or replace function public.admin_finalize_document_deletion(
  p_document_id uuid,
  p_actor_id uuid,
  p_operation_token uuid,
  p_drive_trashed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_doc public.documents%rowtype;
begin
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
      deleted_at = now(),
      deleted_by = p_actor_id,
      drive_trashed_at = case when p_drive_trashed then now() else null end,
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
    'DOCUMENT_DELETE',
    'DOCUMENT',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'document_type', v_doc.document_type,
      'document_number', coalesce(v_doc.document_number, ''),
      'file_name', coalesce(v_doc.file_name, ''),
      'drive_trashed', coalesce(p_drive_trashed, false)
    )
  );

  return true;
end;
$$;

revoke all on function public.admin_finalize_document_deletion(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_document_deletion(uuid, uuid, uuid, boolean)
  to service_role;

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
  v_created public.users%rowtype;
begin
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
    insert into public.users as created_user (email, name, role, status)
    values (canonical_email, canonical_name, p_role, 'ACTIVE')
    returning * into v_created;
  exception
    when unique_violation then
      raise exception using message = 'USER_ALREADY_EXISTS';
  end;

  perform public.append_audit_log_entry(
    actor_id,
    'USER_CREATE',
    'USER',
    v_created.id::text,
    pg_catalog.jsonb_build_object(
      'target_email', v_created.email,
      'role', v_created.role,
      'status', v_created.status
    )
  );

  return query
  select
    v_created.id,
    v_created.email,
    v_created.name,
    v_created.role,
    v_created.status,
    v_created.created_at,
    v_created.updated_at;
end;
$$;

revoke execute on function public.admin_create_user(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_user(uuid, text, text, text)
  to service_role;

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
  v_updated public.users%rowtype;
begin
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

  update public.users as target
  set role = final_role,
      status = final_status
  where target.id = target_id
  returning * into v_updated;

  perform public.append_audit_log_entry(
    actor_id,
    'USER_UPDATE',
    'USER',
    v_updated.id::text,
    pg_catalog.jsonb_build_object(
      'target_email', v_updated.email,
      'previous_role', target_role,
      'role', v_updated.role,
      'previous_status', target_status,
      'status', v_updated.status
    )
  );

  return query
  select
    v_updated.id,
    v_updated.email,
    v_updated.name,
    v_updated.role,
    v_updated.status,
    v_updated.created_at,
    v_updated.updated_at;
end;
$$;

revoke execute on function public.admin_update_user(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_user(uuid, uuid, text, text)
  to service_role;

create or replace function public.admin_finalize_document_folder_creation(
  p_folder_id uuid,
  p_actor_id uuid,
  p_operation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_folder public.document_folders%rowtype;
begin
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.role = 'ADMIN'
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.document_folders
  set status = 'ACTIVE',
      operation_token = null,
      lease_expires_at = null,
      error_category = null,
      updated_at = now()
  where id = p_folder_id
    and status = 'CREATING'
    and operation_token = p_operation_token
    and drive_folder_id is not null
  returning * into v_folder;

  if not found then
    return false;
  end if;

  perform public.append_audit_log_entry(
    p_actor_id,
    'FOLDER_CREATE',
    'FOLDER',
    v_folder.id::text,
    pg_catalog.jsonb_build_object(
      'name', v_folder.name,
      'logical_parent_key', v_folder.logical_parent_key,
      'hierarchy_kind', coalesce(v_folder.hierarchy_kind, ''),
      'source', coalesce(v_folder.source, 'DYNAMIC')
    )
  );

  return true;
end;
$$;

revoke all on function public.admin_finalize_document_folder_creation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_document_folder_creation(uuid, uuid, uuid)
  to service_role;
