-- Milestone 2: Custom metadata, file SHA-256 hash, and duplicate detection.

alter table public.documents
  add column if not exists custom_metadata jsonb not null default '{}'::jsonb,
  add column if not exists file_sha256 text;

alter table public.documents
  drop constraint if exists documents_custom_metadata_object,
  drop constraint if exists documents_file_sha256_format;

alter table public.documents
  add constraint documents_custom_metadata_object
    check (pg_catalog.jsonb_typeof(custom_metadata) = 'object'),
  add constraint documents_file_sha256_format
    check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists documents_file_sha256_idx
  on public.documents (file_sha256)
  where deletion_state = 'ACTIVE' and file_sha256 is not null;

create index if not exists documents_doc_number_type_idx
  on public.documents (document_type, document_number)
  where deletion_state = 'ACTIVE' and document_number is not null;

create index if not exists documents_custom_metadata_gin_idx
  on public.documents using gin (custom_metadata);

-- Check for existing duplicates (hash or document number within the same document type).
-- Enforces can_read_document so confidential documents are not leaked to unauthorized users.
create or replace function public.check_document_duplicate(
  p_actor_id uuid,
  p_document_type text,
  p_document_number text,
  p_file_sha256 text
)
returns table (
  duplicate_kind text,
  existing_document_id uuid,
  existing_document_number text,
  existing_subject text,
  is_confidential boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_norm_number text := nullif(pg_catalog.btrim(coalesce(p_document_number, '')), '');
  v_norm_hash text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_file_sha256, ''))), '');
  target record;
begin
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id
      and actor.status = 'ACTIVE'
  ) then
    raise exception 'UNAUTHORIZED';
  end if;

  -- 1. Check exact file hash duplicate among ACTIVE documents
  if v_norm_hash is not null then
    for target in
      select d.document_id, d.document_number, d.subject, d.confidential
      from public.documents as d
      where d.deletion_state = 'ACTIVE'
        and d.file_sha256 = v_norm_hash
      limit 1
    loop
      if public.can_read_document(p_actor_id, target.document_id) then
        return query select
          'HASH'::text,
          target.document_id,
          target.document_number,
          target.subject,
          target.confidential;
      else
        return query select
          'CONFIDENTIAL_HASH'::text,
          target.document_id,
          null::text,
          null::text,
          true;
      end if;
      return;
    end loop;
  end if;

  -- 2. Check document number duplicate within the same document type among ACTIVE documents
  if v_norm_number is not null and p_document_type is not null then
    for target in
      select d.document_id, d.document_number, d.subject, d.confidential
      from public.documents as d
      where d.deletion_state = 'ACTIVE'
        and d.document_type = p_document_type
        and lower(d.document_number) = lower(v_norm_number)
      limit 1
    loop
      if public.can_read_document(p_actor_id, target.document_id) then
        return query select
          'NUMBER'::text,
          target.document_id,
          target.document_number,
          target.subject,
          target.confidential;
      else
        return query select
          'CONFIDENTIAL_NUMBER'::text,
          target.document_id,
          null::text,
          null::text,
          true;
      end if;
      return;
    end loop;
  end if;

  return;
end;
$$;

revoke all on function public.check_document_duplicate(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.check_document_duplicate(uuid, text, text, text)
  to service_role;

-- Overloaded finalize_admin_upload with custom metadata, file SHA-256, and override reason
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
  p_created_by text,
  p_custom_metadata jsonb default '{}'::jsonb,
  p_file_sha256 text default null,
  p_duplicate_override_reason text default null
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
  v_metadata jsonb := coalesce(p_custom_metadata, '{}'::jsonb);
  v_audit_meta jsonb;
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
    status, created_by, filing_year, filing_subcategory,
    custom_metadata, file_sha256
  ) values (
    p_document_type, nullif(p_document_number, ''), p_document_date, p_subject,
    nullif(p_persons_involved, ''), p_drive_file_id, p_drive_url, p_file_name,
    p_file_type, 'ACTIVE', p_created_by, p_filing_year,
    nullif(p_filing_subcategory, ''),
    v_metadata, nullif(lower(p_file_sha256), '')
  ) returning * into created_document;

  update public.upload_attempts
  set status = 'COMPLETE', document_id = created_document.document_id,
      safe_error_code = null, updated_at = now()
  where id = attempt_id;

  v_audit_meta := pg_catalog.jsonb_build_object(
    'document_type', created_document.document_type,
    'document_number', coalesce(created_document.document_number, ''),
    'file_name', coalesce(created_document.file_name, ''),
    'upload_mode', 'SINGLE'
  );

  if p_file_sha256 is not null then
    v_audit_meta := v_audit_meta || pg_catalog.jsonb_build_object('file_sha256', p_file_sha256);
  end if;

  if p_duplicate_override_reason is not null and btrim(p_duplicate_override_reason) <> '' then
    v_audit_meta := v_audit_meta || pg_catalog.jsonb_build_object(
      'duplicate_override', true,
      'duplicate_override_reason', btrim(p_duplicate_override_reason)
    );
  end if;

  perform public.append_audit_log_entry(
    locked_attempt.created_by,
    'DOCUMENT_UPLOAD',
    'DOCUMENT',
    created_document.document_id::text,
    v_audit_meta
  );

  return created_document;
end;
$$;

revoke all on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text, jsonb, text, text)
  to service_role;

-- Backward-compatible 13-argument finalize_admin_upload forwards to 16-argument version
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
begin
  return public.finalize_admin_upload(
    attempt_id,
    p_document_type,
    p_document_number,
    p_document_date,
    p_subject,
    p_persons_involved,
    p_drive_file_id,
    p_drive_url,
    p_file_name,
    p_file_type,
    p_filing_year,
    p_filing_subcategory,
    p_created_by,
    '{}'::jsonb,
    null,
    null
  );
end;
$$;

revoke all on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text)
  to service_role;
