-- Milestone 5: Notifications, reminders (90/30/7-day threshold with exactly-once tracking),
-- legal retention lifecycle (NAP RA 9470 & COA compliance, review flags, no auto-disposal),
-- and document comments with strict confidentiality enforcement.

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
    'REMINDER_SENT'
  )
);

-- 2. Add expiration, due date, and retention columns to documents table
alter table public.documents
  add column if not exists expires_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists retention_period_months integer check (retention_period_months is null or retention_period_months >= 0),
  add column if not exists retention_status text not null default 'ACTIVE' check (retention_status in ('ACTIVE', 'PENDING_REVIEW', 'ARCHIVED', 'DISPOSED')),
  add column if not exists retention_flagged_at timestamptz,
  add column if not exists retention_approved_at timestamptz,
  add column if not exists retention_approved_by uuid references public.users(id),
  add column if not exists retention_notes text;

create index if not exists documents_expires_at_idx
  on public.documents (expires_at)
  where deletion_state = 'ACTIVE';

create index if not exists documents_due_at_idx
  on public.documents (due_at)
  where deletion_state = 'ACTIVE';

create index if not exists documents_retention_status_idx
  on public.documents (retention_status)
  where deletion_state = 'ACTIVE';

-- 3. Notifications table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (
    kind in (
      'REMINDER_90',
      'REMINDER_30',
      'REMINDER_7',
      'RETENTION_FLAGGED',
      'COMMENT',
      'STATUS_CHANGE',
      'GENERAL'
    )
  ),
  document_id uuid references public.documents(document_id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_read_idx
  on public.notifications (user_id, read_at, created_at desc);

create index if not exists notifications_document_id_idx
  on public.notifications (document_id);

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
  on public.notifications
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = notifications.user_id
        and u.email = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on public.notifications
  for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = notifications.user_id
        and u.email = lower(auth.jwt() ->> 'email')
    )
  );

grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- 4. Reminders Sent (Exactly-once deduplication table)
create table if not exists public.reminders_sent (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(document_id) on delete cascade,
  kind text not null check (kind in ('EXPIRY', 'DUE_DATE')),
  threshold_days integer not null check (threshold_days in (90, 30, 7)),
  sent_at timestamptz not null default now(),
  constraint reminders_sent_document_kind_threshold_unique unique (document_id, kind, threshold_days)
);

create index if not exists reminders_sent_lookup_idx
  on public.reminders_sent (document_id, kind, threshold_days);

alter table public.reminders_sent enable row level security;

-- Only service role and administrative backend functions manage reminders_sent
grant all on public.reminders_sent to service_role;

-- 5. Document Comments table
create table if not exists public.document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(document_id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0 and char_length(content) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_comments_doc_created_idx
  on public.document_comments (document_id, created_at asc);

create index if not exists document_comments_user_idx
  on public.document_comments (user_id);

alter table public.document_comments enable row level security;

drop policy if exists "Users can read comments on accessible documents" on public.document_comments;
create policy "Users can read comments on accessible documents"
  on public.document_comments
  for select
  using (
    exists (
      select 1 from public.documents d
      where d.document_id = document_comments.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
  );

drop policy if exists "Staff and Admins can insert comments on accessible documents" on public.document_comments;
create policy "Staff and Admins can insert comments on accessible documents"
  on public.document_comments
  for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.document_id = document_comments.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
    and exists (
      select 1 from public.users u
      where u.id = document_comments.user_id
        and u.email = lower(auth.jwt() ->> 'email')
        and u.status = 'ACTIVE'
        and u.role in ('STAFF', 'ADMIN')
    )
  );

grant select, insert on public.document_comments to authenticated;
grant all on public.document_comments to service_role;

-- 6. RPC: add_document_comment
create or replace function public.add_document_comment(
  p_actor_id uuid,
  p_document_id uuid,
  p_content text
)
returns table (
  id uuid,
  document_id uuid,
  user_id uuid,
  user_name text,
  user_email text,
  user_role text,
  content text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
  v_doc public.documents%rowtype;
  v_clean_content text;
  v_comment_id uuid;
  v_created_at timestamptz;
begin
  select * into v_actor from public.users where public.users.id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' then
    raise exception 'ACTOR_NOT_AUTHORIZED';
  end if;

  if v_actor.role not in ('STAFF', 'ADMIN') then
    raise exception 'INSUFFICIENT_ROLE';
  end if;

  select * into v_doc from public.documents where public.documents.document_id = p_document_id;
  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if not public.can_read_document(p_actor_id, p_document_id) then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;

  v_clean_content := btrim(coalesce(p_content, ''));
  if char_length(v_clean_content) = 0 or char_length(v_clean_content) > 2000 then
    raise exception 'INVALID_COMMENT_CONTENT';
  end if;

  insert into public.document_comments (
    document_id,
    user_id,
    content
  ) values (
    p_document_id,
    p_actor_id,
    v_clean_content
  ) returning public.document_comments.id, public.document_comments.created_at
    into v_comment_id, v_created_at;

  insert into public.audit_log (
    actor_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor.id,
    v_actor.email,
    'DOCUMENT_COMMENT_CREATE',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object(
      'comment_id', v_comment_id,
      'content_length', char_length(v_clean_content)
    )
  );

  return query
  select
    v_comment_id as id,
    p_document_id as document_id,
    v_actor.id as user_id,
    v_actor.name as user_name,
    v_actor.email as user_email,
    v_actor.role as user_role,
    v_clean_content as content,
    v_created_at as created_at;
end;
$$;

revoke all on function public.add_document_comment(uuid, uuid, text) from public, anon;
grant execute on function public.add_document_comment(uuid, uuid, text) to authenticated, service_role;

-- 7. RPC: approve_retention_action
create or replace function public.approve_retention_action(
  p_actor_id uuid,
  p_document_id uuid,
  p_action text,
  p_notes text default ''
)
returns table (
  document_id uuid,
  retention_status text,
  retention_approved_at timestamptz,
  retention_approved_by uuid,
  retention_notes text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
  v_doc public.documents%rowtype;
  v_target_status text;
  v_approved_at timestamptz := now();
begin
  select * into v_actor from public.users where public.users.id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' or v_actor.role <> 'ADMIN' then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_action not in ('ARCHIVE', 'DISPOSE') then
    raise exception 'INVALID_RETENTION_ACTION';
  end if;

  select * into v_doc from public.documents where public.documents.document_id = p_document_id;
  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  v_target_status := case when p_action = 'ARCHIVE' then 'ARCHIVED' else 'DISPOSED' end;

  update public.documents
  set
    retention_status = v_target_status,
    retention_approved_at = v_approved_at,
    retention_approved_by = p_actor_id,
    retention_notes = coalesce(p_notes, ''),
    status = case when p_action = 'ARCHIVE' then 'ARCHIVED' else status end,
    updated_at = v_approved_at
  where public.documents.document_id = p_document_id;

  insert into public.audit_log (
    actor_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor.id,
    v_actor.email,
    'DOCUMENT_RETENTION_APPROVE',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object(
      'retention_action', p_action,
      'retention_status', v_target_status,
      'notes', coalesce(p_notes, '')
    )
  );

  return query
  select
    p_document_id as document_id,
    v_target_status as retention_status,
    v_approved_at as retention_approved_at,
    p_actor_id as retention_approved_by,
    coalesce(p_notes, '') as retention_notes;
end;
$$;

revoke all on function public.approve_retention_action(uuid, uuid, text, text) from public, anon;
grant execute on function public.approve_retention_action(uuid, uuid, text, text) to authenticated, service_role;
