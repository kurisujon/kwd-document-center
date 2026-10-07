-- Phase 7D.3b: folder-upload reservation claim and finalization primitives.
-- Legacy upload RPCs and direct upload-attempt lifecycle remain unchanged.
create or replace function public.admin_claim_folder_upload_attempt(
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_destination_folder_id uuid,
  p_source_relative_path text,
  p_normalized_relative_path_key text,
  p_content_sha256 bytea,
  p_metadata_snapshot jsonb
)
returns table (
  outcome text,
  attempt_id uuid,
  attempt_status text,
  drive_file_id text,
  operation_token uuid,
  reservation_expires_at timestamptz,
  document_id uuid
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.upload_attempts%rowtype;
  destination public.document_folders%rowtype;
  snapshot_document_date_text text;
  snapshot_document_date date;
  snapshot_file_size_text text;
  snapshot_file_size integer;
begin
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.status = 'ACTIVE'
      and actor.role in ('STAFF', 'ADMIN')
  ) then
    return query select 'NOT_AUTHORIZED'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  -- Existing operations retain their durable authorization after claim. Their
  -- full immutable identity is checked before new-request validation.
  select * into target
  from public.upload_attempts
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if target.created_by is distinct from p_actor_id
      or target.destination_folder_id is distinct from p_destination_folder_id
      or target.source_relative_path is distinct from p_source_relative_path
      or target.normalized_relative_path_key is distinct from p_normalized_relative_path_key
      or target.content_sha256 is distinct from p_content_sha256
      or target.metadata_snapshot is distinct from p_metadata_snapshot
    then
      return query select 'IDEMPOTENCY_MISMATCH'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
      return;
    end if;
    return query select case when target.status = 'COMPLETE' then 'COMPLETE' else 'REPLAY' end,
      target.id, target.status, target.drive_file_id, target.operation_token, target.reservation_expires_at, target.document_id;
    return;
  end if;

  if p_idempotency_key is null
    or p_destination_folder_id is null
    or p_source_relative_path is null or p_source_relative_path = '' or pg_catalog.octet_length(p_source_relative_path) > 1024
    or p_normalized_relative_path_key is null or p_normalized_relative_path_key = '' or pg_catalog.octet_length(p_normalized_relative_path_key) > 1024
    or p_content_sha256 is null or pg_catalog.octet_length(p_content_sha256) <> 32
    or p_metadata_snapshot is null or pg_catalog.jsonb_typeof(p_metadata_snapshot) <> 'object'
    or not (
      p_metadata_snapshot ? 'document_type'
      and p_metadata_snapshot ? 'document_number'
      and p_metadata_snapshot ? 'document_date'
      and p_metadata_snapshot ? 'subject'
      and p_metadata_snapshot ? 'persons_involved'
      and p_metadata_snapshot ? 'filing_year'
      and p_metadata_snapshot ? 'filing_subcategory'
      and p_metadata_snapshot ? 'file_name'
      and p_metadata_snapshot ? 'file_type'
      and p_metadata_snapshot ? 'file_size'
    )
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'document_type') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'document_number') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'document_date') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'subject') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'persons_involved') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'filing_year') not in ('number', 'null')
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'filing_subcategory') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'file_name') <> 'string'
    or pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'file_type') <> 'string'
    or coalesce(p_metadata_snapshot ->> 'file_name', '') = ''
    or coalesce(p_metadata_snapshot ->> 'file_type', '') = ''
    or coalesce(p_metadata_snapshot ->> 'document_type', '') = ''
    or coalesce(p_metadata_snapshot ->> 'document_date', '') = ''
    or coalesce(p_metadata_snapshot ->> 'subject', '') = ''
    or coalesce(p_metadata_snapshot ->> 'filing_year', '') !~ '^[0-9]+$'
  then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  snapshot_document_date_text := p_metadata_snapshot ->> 'document_date';
  if snapshot_document_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  begin
    snapshot_document_date := snapshot_document_date_text::date;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
      return;
  end;
  if pg_catalog.to_char(snapshot_document_date, 'YYYY-MM-DD') <> snapshot_document_date_text then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  if pg_catalog.jsonb_typeof(p_metadata_snapshot -> 'file_size') <> 'number' then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  snapshot_file_size_text := p_metadata_snapshot ->> 'file_size';
  if snapshot_file_size_text !~ '^[1-9][0-9]*$' then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  if pg_catalog.char_length(snapshot_file_size_text) > 7 then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  snapshot_file_size := snapshot_file_size_text::integer;
  if snapshot_file_size < 1 or snapshot_file_size > 4194304 then
    return query select 'INVALID_REQUEST'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  select * into destination
  from public.document_folders
  where id = p_destination_folder_id
  for update;

  if not found
    or destination.status <> 'ACTIVE'
    or destination.department_key <> 'ADMIN'
    or destination.hierarchy_kind not in ('CATEGORY', 'SUBCATEGORY', 'WORKING_FOLDER')
    or destination.upload_enabled is not true
    or destination.drive_folder_id is null
    or destination.filing_year is null
    or destination.category is null
    or destination.logical_key is null
    or (destination.hierarchy_kind = 'CATEGORY' and destination.subcategory is not null)
    or (destination.hierarchy_kind = 'SUBCATEGORY' and destination.subcategory is null)
    or (p_metadata_snapshot ->> 'document_type') is distinct from destination.category
    or (p_metadata_snapshot ->> 'filing_year') is distinct from destination.filing_year::text
    or (p_metadata_snapshot ->> 'filing_subcategory') is distinct from coalesce(destination.subcategory, '')
  then
    return query select 'INVALID_DESTINATION'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  begin
    insert into public.upload_attempts (
      idempotency_key, status, metadata_snapshot, created_by,
      destination_folder_id, source_relative_path, normalized_relative_path_key, content_sha256
    ) values (
      p_idempotency_key, 'PENDING_UPLOAD', p_metadata_snapshot, p_actor_id,
      p_destination_folder_id, p_source_relative_path, p_normalized_relative_path_key, p_content_sha256
    ) returning * into target;
  exception when unique_violation then
    select * into target
    from public.upload_attempts
    where idempotency_key = p_idempotency_key
    for update;

    if found then
      if target.created_by is distinct from p_actor_id
        or target.destination_folder_id is distinct from p_destination_folder_id
        or target.source_relative_path is distinct from p_source_relative_path
        or target.normalized_relative_path_key is distinct from p_normalized_relative_path_key
        or target.content_sha256 is distinct from p_content_sha256
        or target.metadata_snapshot is distinct from p_metadata_snapshot
      then
        return query select 'IDEMPOTENCY_MISMATCH'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
        return;
      end if;
      return query select case when target.status = 'COMPLETE' then 'COMPLETE' else 'REPLAY' end,
        target.id, target.status, target.drive_file_id, target.operation_token, target.reservation_expires_at, target.document_id;
      return;
    end if;

    return query select 'DUPLICATE_PATH'::text, null::uuid, null::text, null::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end;

  return query select 'CLAIMED'::text,
    target.id, target.status, target.drive_file_id, target.operation_token, target.reservation_expires_at, target.document_id;
end;
$$;

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
  return created_document;
end;
$$;

revoke all on function public.admin_claim_folder_upload_attempt(uuid, uuid, uuid, text, text, bytea, jsonb) from public, anon, authenticated;
revoke all on function public.admin_finalize_folder_upload(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_claim_folder_upload_attempt(uuid, uuid, uuid, text, text, bytea, jsonb) to service_role;
grant execute on function public.admin_finalize_folder_upload(uuid, uuid, text) to service_role;
