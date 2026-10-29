-- Milestone 6: User Document Stars (Bookmarks), Dashboard Summary RPC,
-- and Reports Export audit logging.

-- 1. Extend audit_log allowed actions
alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid check (
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
    'FOLDER_CREATE',
    'DOCUMENT_STATUS_CHANGE',
    'DOCUMENT_LINK_CREATE',
    'DOCUMENT_LINK_DELETE',
    'DOCUMENT_VERSION_UPLOAD',
    'DOCUMENT_TAG_ADD',
    'DOCUMENT_TAG_REMOVE',
    'DOCUMENT_COMMENT_CREATE',
    'DOCUMENT_COMMENT_DELETE',
    'DOCUMENT_RETENTION_FLAG',
    'DOCUMENT_RETENTION_APPROVE',
    'REMINDER_SENT',
    'DOCUMENT_STAR',
    'DOCUMENT_UNSTAR',
    'REPORT_EXPORT_CSV'
  )
);

-- 2. User Document Stars table
create table if not exists public.user_document_stars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(document_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_document_stars_user_doc_unique unique (user_id, document_id)
);

create index if not exists user_document_stars_user_idx
  on public.user_document_stars (user_id, created_at desc);

create index if not exists user_document_stars_document_idx
  on public.user_document_stars (document_id);

alter table public.user_document_stars enable row level security;

drop policy if exists "Users can read own starred documents" on public.user_document_stars;
create policy "Users can read own starred documents"
  on public.user_document_stars
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = user_document_stars.user_id
        and u.email = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "Users can star accessible documents" on public.user_document_stars;
create policy "Users can star accessible documents"
  on public.user_document_stars
  for insert
  with check (
    (
      user_id = auth.uid()
      or exists (
        select 1 from public.users u
        where u.id = user_document_stars.user_id
          and u.email = lower(auth.jwt() ->> 'email')
          and u.status = 'ACTIVE'
      )
    )
    and exists (
      select 1 from public.documents d
      where d.document_id = user_document_stars.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
  );

drop policy if exists "Users can unstar own documents" on public.user_document_stars;
create policy "Users can unstar own documents"
  on public.user_document_stars
  for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = user_document_stars.user_id
        and u.email = lower(auth.jwt() ->> 'email')
    )
  );

grant select, insert, delete on public.user_document_stars to authenticated;
grant all on public.user_document_stars to service_role;

-- 3. RPC: toggle_document_star
create or replace function public.toggle_document_star(
  p_actor_id uuid,
  p_document_id uuid
)
returns table (
  document_id uuid,
  starred boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
  v_doc public.documents%rowtype;
  v_existing_id uuid;
begin
  select * into v_actor from public.users where public.users.id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' then
    raise exception 'ACTOR_NOT_AUTHORIZED';
  end if;

  select * into v_doc from public.documents where public.documents.document_id = p_document_id;
  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if not public.can_read_document(p_actor_id, p_document_id) then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;

  select id into v_existing_id
  from public.user_document_stars
  where user_id = p_actor_id and public.user_document_stars.document_id = p_document_id;

  if found then
    delete from public.user_document_stars
    where id = v_existing_id;

    return query select p_document_id, false;
  else
    insert into public.user_document_stars (user_id, document_id)
    values (p_actor_id, p_document_id);

    return query select p_document_id, true;
  end if;
end;
$$;

revoke all on function public.toggle_document_star(uuid, uuid) from public, anon;
grant execute on function public.toggle_document_star(uuid, uuid) to authenticated, service_role;

-- 4. RPC: get_dashboard_summary
create or replace function public.get_dashboard_summary(
  p_actor_id uuid
)
returns table (
  total_documents bigint,
  expiring_soon_count bigint,
  pending_retention_count bigint,
  type_counts jsonb
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
  v_is_admin boolean;
  v_total bigint;
  v_expiring bigint;
  v_retention bigint;
  v_types jsonb;
begin
  select * into v_actor from public.users where public.users.id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' then
    raise exception 'ACTOR_NOT_AUTHORIZED';
  end if;

  v_is_admin := (v_actor.role = 'ADMIN');

  -- Total active documents accessible to actor
  select count(*) into v_total
  from public.documents
  where deletion_state = 'ACTIVE'
    and (not confidential or v_is_admin);

  -- Expiring within next 90 days
  select count(*) into v_expiring
  from public.documents
  where deletion_state = 'ACTIVE'
    and (not confidential or v_is_admin)
    and expires_at is not null
    and expires_at >= now()
    and expires_at <= (now() + interval '90 days');

  -- Flagged for retention review
  select count(*) into v_retention
  from public.documents
  where deletion_state = 'ACTIVE'
    and (not confidential or v_is_admin)
    and retention_status = 'PENDING_REVIEW';

  -- Breakdown by document type
  select coalesce(
    jsonb_object_agg(sub.document_type, sub.cnt),
    '{}'::jsonb
  ) into v_types
  from (
    select document_type, count(*) as cnt
    from public.documents
    where deletion_state = 'ACTIVE'
      and (not confidential or v_is_admin)
    group by document_type
    order by cnt desc
  ) sub;

  return query select v_total, v_expiring, v_retention, v_types;
end;
$$;

revoke all on function public.get_dashboard_summary(uuid) from public, anon;
grant execute on function public.get_dashboard_summary(uuid) to authenticated, service_role;
