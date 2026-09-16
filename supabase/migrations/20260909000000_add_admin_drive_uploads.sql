-- Phase 3 Admin documents only. Supabase remains the application metadata
-- registry; Google Drive stores file content.
alter table public.documents
  add column if not exists filing_year integer,
  add column if not exists filing_subcategory text;

alter table public.documents
  add constraint documents_filing_year_valid
  check (filing_year is null or filing_year between 1900 and 9999);

create table public.upload_attempts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  status text not null check (status in ('PENDING_UPLOAD', 'UPLOADING', 'PENDING_REGISTRY', 'COMPLETE', 'FAILED')),
  drive_file_id text,
  operation_token uuid,
  reservation_expires_at timestamptz,
  metadata_snapshot jsonb not null,
  document_id uuid unique references public.documents(document_id),
  created_by uuid not null references public.users(id),
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upload_attempts_drive_id_reserved check (
    status = 'PENDING_UPLOAD' or drive_file_id is not null
  ),
  constraint upload_attempts_completed_document check (
    status <> 'COMPLETE' or document_id is not null
  ),
  constraint upload_attempts_uploading_token check (
    status <> 'UPLOADING' or operation_token is not null
  )
);

alter table public.upload_attempts enable row level security;

-- Upload attempts are accessed only through the authenticated server boundary
-- with the service-role client. No browser-facing table policy is created.
revoke all on public.upload_attempts from anon, authenticated;
grant select, insert, update on public.upload_attempts to service_role;

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
set search_path = public
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

  return created_document;
end;
$$;

revoke all on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.finalize_admin_upload(uuid, text, text, date, text, text, text, text, text, text, integer, text, text) to service_role;

create index upload_attempts_creator_status_idx
  on public.upload_attempts (created_by, status, created_at desc);

create unique index documents_drive_file_id_unique_idx
  on public.documents (drive_file_id)
  where drive_file_id is not null;

-- Enforce drive_file_id immutability on documents at the database boundary.
-- A NULL drive_file_id may transition to non-NULL (initial assignment).
-- Once non-NULL, updating to the same value is permitted, but changing to a different
-- value or clearing to NULL is strictly rejected.
create or replace function public.enforce_documents_drive_file_id_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.drive_file_id is not null then
    if new.drive_file_id is null or new.drive_file_id <> old.drive_file_id then
      raise exception 'DRIVE_FILE_ID_IMMUTABLE: Persisted Drive file ID cannot be modified or cleared.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_drive_file_id_immutable_trg on public.documents;
create trigger documents_drive_file_id_immutable_trg
  before update on public.documents
  for each row
  execute function public.enforce_documents_drive_file_id_immutable();
