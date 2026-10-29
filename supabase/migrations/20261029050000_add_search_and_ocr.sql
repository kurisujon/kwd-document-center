-- Milestone 4: Full-text search with simple configuration, pg_trgm fuzzy matching,
-- extracted text storage (document_text), and asynchronous OCR job queue (ocr_jobs).
-- Enforces can_read_document confidentiality across all search queries.

-- 1. Enable pg_trgm extension for fuzzy trigram matching
create extension if not exists pg_trgm;

-- 2. Document Text Storage (document_text)
create table if not exists public.document_text (
  document_id uuid primary key references public.documents(document_id) on delete cascade,
  extracted_text text not null default '',
  tsv tsvector generated always as (to_tsvector('simple', extracted_text)) stored,
  ocr_status text not null default 'PENDING' check (ocr_status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NOT_APPLICABLE')),
  last_processed_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now()
);

create index if not exists document_text_tsv_idx on public.document_text using gin(tsv);
create index if not exists document_text_trgm_idx on public.document_text using gin(extracted_text gin_trgm_ops);
create index if not exists document_text_status_idx on public.document_text (ocr_status);

alter table public.document_text enable row level security;

drop policy if exists "Users can view extracted text for accessible documents" on public.document_text;
create policy "Users can view extracted text for accessible documents"
  on public.document_text
  for select
  using (
    exists (
      select 1 from public.documents d
      where d.document_id = document_text.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
  );

-- 3. Asynchronous OCR Job Queue (ocr_jobs)
create table if not exists public.ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(document_id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3,
  last_attempt_at timestamptz,
  lock_token uuid,
  lock_expires_at timestamptz,
  error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ocr_jobs_status_idx on public.ocr_jobs (status, lock_expires_at);
create index if not exists ocr_jobs_document_idx on public.ocr_jobs (document_id);

alter table public.ocr_jobs enable row level security;

drop policy if exists "Admins can view OCR jobs" on public.ocr_jobs;
create policy "Admins can view OCR jobs"
  on public.ocr_jobs
  for select
  using (
    exists (
      select 1 from public.users u
      where u.email = lower(btrim(auth.jwt() ->> 'email'))
        and u.role = 'ADMIN'
        and u.status = 'ACTIVE'
    )
  );

-- 4. Full-Text Search Function with Snippet Generation
create or replace function public.search_documents_fulltext(
  p_query text,
  p_user_email text,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  document_id uuid,
  document_type text,
  document_number text,
  document_date date,
  subject text,
  status text,
  confidential boolean,
  file_name text,
  snippet text,
  rank real,
  total_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tsquery tsquery;
  v_clean_query text;
begin
  v_clean_query := btrim(coalesce(p_query, ''));
  if v_clean_query = '' then
    return;
  end if;

  v_tsquery := plainto_tsquery('simple', v_clean_query);

  return query
  with accessible_matches as (
    select
      d.document_id,
      d.document_type,
      d.document_number,
      d.document_date,
      d.subject,
      d.status,
      d.confidential,
      d.file_name,
      ts_headline(
        'simple',
        coalesce(dt.extracted_text, d.subject || ' ' || coalesce(d.document_number, '')),
        v_tsquery,
        'StartSel=<b>, StopSel=</b>, MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=FALSE, MaxFragments=1'
      ) as snippet,
      ts_rank_cd(
        coalesce(dt.tsv, to_tsvector('simple', '')),
        v_tsquery
      ) +
      similarity(d.subject, v_clean_query) * 0.5 +
      case when d.document_number ilike '%' || v_clean_query || '%' then 1.0 else 0.0 end as rank,
      count(*) over() as total_count
    from public.documents d
    left join public.document_text dt on dt.document_id = d.document_id
    where d.deletion_state = 'ACTIVE'
      and public.can_read_document(p_user_email, d.deletion_state, d.confidential)
      and (
        (dt.tsv is not null and dt.tsv @@ v_tsquery)
        or d.subject ilike '%' || v_clean_query || '%'
        or d.document_number ilike '%' || v_clean_query || '%'
        or d.persons_involved ilike '%' || v_clean_query || '%'
        or (d.custom_metadata::text ilike '%' || v_clean_query || '%')
      )
  )
  select
    m.document_id,
    m.document_type,
    m.document_number,
    m.document_date,
    m.subject,
    m.status,
    m.confidential,
    m.file_name,
    m.snippet,
    m.rank::real,
    m.total_count
  from accessible_matches m
  order by m.rank desc, m.document_date desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
end;
$$;

-- 5. OCR Job Queue Worker Functions

-- 5.1 claim_ocr_jobs
create or replace function public.claim_ocr_jobs(
  p_batch_size integer default 5,
  p_lock_seconds integer default 120,
  p_worker_token uuid default gen_random_uuid()
)
returns table (
  job_id uuid,
  document_id uuid,
  drive_file_id text,
  file_name text,
  file_type text,
  attempts integer,
  worker_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with available_jobs as (
    select j.id
    from public.ocr_jobs j
    where (
      j.status = 'PENDING'
      or (j.status = 'PROCESSING' and j.lock_expires_at is not null and j.lock_expires_at <= now())
    )
    and j.attempts < j.max_attempts
    order by j.created_at asc
    limit greatest(1, least(p_batch_size, 20))
    for update skip locked
  ),
  claimed as (
    update public.ocr_jobs j
    set status = 'PROCESSING',
        lock_token = p_worker_token,
        lock_expires_at = now() + (p_lock_seconds || ' seconds')::interval,
        last_attempt_at = now(),
        attempts = j.attempts + 1,
        updated_at = now()
    from available_jobs aj
    where j.id = aj.id
    returning j.id, j.document_id, j.attempts
  )
  select
    c.id as job_id,
    c.document_id,
    d.drive_file_id,
    d.file_name,
    d.file_type,
    c.attempts,
    p_worker_token as worker_token
  from claimed c
  join public.documents d on d.document_id = c.document_id;
end;
$$;

-- 5.2 complete_ocr_job
create or replace function public.complete_ocr_job(
  p_job_id uuid,
  p_document_id uuid,
  p_extracted_text text,
  p_worker_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.ocr_jobs
  set status = 'COMPLETED',
      lock_token = null,
      lock_expires_at = null,
      updated_at = now()
  where id = p_job_id
    and lock_token = p_worker_token;

  if not found then
    return false;
  end if;

  insert into public.document_text (
    document_id,
    extracted_text,
    ocr_status,
    last_processed_at,
    error_message,
    updated_at
  ) values (
    p_document_id,
    coalesce(p_extracted_text, ''),
    'COMPLETED',
    now(),
    null,
    now()
  )
  on conflict (document_id) do update set
    extracted_text = excluded.extracted_text,
    ocr_status = 'COMPLETED',
    last_processed_at = now(),
    error_message = null,
    updated_at = now();

  return true;
end;
$$;

-- 5.3 fail_ocr_job
create or replace function public.fail_ocr_job(
  p_job_id uuid,
  p_document_id uuid,
  p_error_category text,
  p_error_message text,
  p_worker_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts integer;
  v_max_attempts integer;
begin
  select attempts, max_attempts
  into v_attempts, v_max_attempts
  from public.ocr_jobs
  where id = p_job_id and lock_token = p_worker_token;

  if not found then
    return false;
  end if;

  if v_attempts >= v_max_attempts then
    update public.ocr_jobs
    set status = 'FAILED',
        error_category = p_error_category,
        lock_token = null,
        lock_expires_at = null,
        updated_at = now()
    where id = p_job_id;

    insert into public.document_text (
      document_id,
      extracted_text,
      ocr_status,
      last_processed_at,
      error_message,
      updated_at
    ) values (
      p_document_id,
      '',
      'FAILED',
      now(),
      p_error_message,
      now()
    )
    on conflict (document_id) do update set
      ocr_status = 'FAILED',
      last_processed_at = now(),
      error_message = excluded.error_message,
      updated_at = now();
  else
    -- Return to PENDING for retry
    update public.ocr_jobs
    set status = 'PENDING',
        error_category = p_error_category,
        lock_token = null,
        lock_expires_at = null,
        updated_at = now()
    where id = p_job_id;
  end if;

  return true;
end;
$$;

-- Permissions: revoke from public/anon/authenticated and grant to service_role
revoke all on function public.search_documents_fulltext(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_documents_fulltext(text, text, integer, integer) to service_role;

revoke all on function public.claim_ocr_jobs(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_ocr_jobs(integer, integer, uuid) to service_role;

revoke all on function public.complete_ocr_job(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.complete_ocr_job(uuid, uuid, text, uuid) to service_role;

revoke all on function public.fail_ocr_job(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fail_ocr_job(uuid, uuid, text, text, uuid) to service_role;
