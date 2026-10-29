-- Milestone 3: Document lifecycle status, relationships (links), version history, tags, and saved filters.
-- Forward-only migration with RLS policies, acyclic supersede verification, and transactional audit logging.

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
    'DOCUMENT_TAG_REMOVE'
  )
);

-- 2. Extend documents table: lifecycle status and version count
do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and pg_get_constraintdef(oid) like '%status%in%'
  ) loop
    execute 'alter table public.documents drop constraint ' || quote_ident(r.conname);
  end loop;
end $$;

alter table public.documents add constraint documents_status_check check (
  status in ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')
);

alter table public.documents add column if not exists version_count integer not null default 1;
alter table public.documents add constraint documents_version_count_positive check (version_count >= 1);

-- 3. Document Relationships (document_links)
create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.documents(document_id) on delete cascade,
  to_id uuid not null references public.documents(document_id) on delete cascade,
  relation text not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint document_links_relation_check check (relation in ('RELATES_TO', 'SUPERSEDES', 'AMENDS')),
  constraint document_links_no_self_link check (from_id <> to_id),
  constraint document_links_unique unique (from_id, to_id, relation)
);

create index if not exists document_links_from_idx on public.document_links (from_id);
create index if not exists document_links_to_idx on public.document_links (to_id);
create index if not exists document_links_relation_idx on public.document_links (relation);

-- Cycle detection for SUPERSEDES relationships
create or replace function public.check_supersede_cycle(p_from_id uuid, p_to_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cycle_exists boolean;
begin
  if p_from_id = p_to_id then
    return true;
  end if;

  with recursive supersede_chain as (
    select to_id as current_id
    from public.document_links
    where from_id = p_to_id and relation = 'SUPERSEDES'

    union

    select l.to_id as current_id
    from public.document_links l
    join supersede_chain sc on l.from_id = sc.current_id
    where l.relation = 'SUPERSEDES'
  )
  select exists (
    select 1 from supersede_chain where current_id = p_from_id
  ) into v_cycle_exists;

  return coalesce(v_cycle_exists, false);
end;
$$;

create or replace function public.enforce_document_links_acyclic()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.relation = 'SUPERSEDES' then
    if public.check_supersede_cycle(new.from_id, new.to_id) then
      raise exception 'SUPERSEDE_CYCLE_DETECTED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_links_acyclic_trg on public.document_links;
create trigger document_links_acyclic_trg
  before insert or update on public.document_links
  for each row
  execute function public.enforce_document_links_acyclic();

-- RLS on document_links: both endpoints must be accessible to viewer
alter table public.document_links enable row level security;

drop policy if exists "Users can view links between accessible documents" on public.document_links;
create policy "Users can view links between accessible documents"
  on public.document_links
  for select
  using (
    exists (
      select 1 from public.documents d1, public.documents d2
      where d1.document_id = document_links.from_id
        and d2.document_id = document_links.to_id
        and public.can_read_document(auth.jwt() ->> 'email', d1.deletion_state, d1.confidential)
        and public.can_read_document(auth.jwt() ->> 'email', d2.deletion_state, d2.confidential)
    )
  );

-- 4. Document Version History (document_versions)
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(document_id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  drive_file_id text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  change_summary text not null default '',
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint document_versions_unique_version unique (document_id, version_number)
);

create index if not exists document_versions_doc_idx on public.document_versions (document_id, version_number desc);

alter table public.document_versions enable row level security;

drop policy if exists "Users can view versions for accessible documents" on public.document_versions;
create policy "Users can view versions for accessible documents"
  on public.document_versions
  for select
  using (
    exists (
      select 1 from public.documents d
      where d.document_id = document_versions.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
  );

-- 5. Tags and Document Tags
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 50),
  color text not null default 'blue',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.document_tags (
  document_id uuid not null references public.documents(document_id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  primary key (document_id, tag_id)
);

alter table public.tags enable row level security;
alter table public.document_tags enable row level security;

drop policy if exists "Active users can view tags" on public.tags;
create policy "Active users can view tags"
  on public.tags
  for select
  using (
    exists (
      select 1 from public.users u
      where u.email = lower(btrim(auth.jwt() ->> 'email'))
        and u.status = 'ACTIVE'
    )
  );

drop policy if exists "Users can view tags for accessible documents" on public.document_tags;
create policy "Users can view tags for accessible documents"
  on public.document_tags
  for select
  using (
    exists (
      select 1 from public.documents d
      where d.document_id = document_tags.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
  );

-- 6. Saved Filters
create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  query_params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint saved_filters_user_name_unique unique (user_id, name),
  constraint saved_filters_query_params_object check (pg_catalog.jsonb_typeof(query_params) = 'object')
);

alter table public.saved_filters enable row level security;

drop policy if exists "Users can manage their own saved filters" on public.saved_filters;
create policy "Users can manage their own saved filters"
  on public.saved_filters
  for all
  using (
    exists (
      select 1 from public.users u
      where u.id = saved_filters.user_id
        and u.email = lower(btrim(auth.jwt() ->> 'email'))
        and u.status = 'ACTIVE'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = saved_filters.user_id
        and u.email = lower(btrim(auth.jwt() ->> 'email'))
        and u.status = 'ACTIVE'
    )
  );

-- 7. Security Definer RPCs

-- 7.1 change_document_status
create or replace function public.change_document_status(
  p_actor_id uuid,
  p_document_id uuid,
  p_new_status text,
  p_reason text default ''
)
returns table (
  document_id uuid,
  status text,
  previous_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_doc record;
  v_old_status text;
begin
  select u.id, u.email, u.role, u.status
  into v_actor
  from public.users u
  where u.id = p_actor_id;

  if not found or v_actor.status <> 'ACTIVE' then
    raise exception 'UNAUTHORIZED';
  end if;

  select d.document_id, d.status, d.document_type, d.confidential, d.deletion_state
  into v_doc
  from public.documents d
  where d.document_id = p_document_id
  for update;

  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if v_doc.confidential and v_actor.role <> 'ADMIN' then
    raise exception 'FORBIDDEN';
  end if;

  v_old_status := v_doc.status;

  if p_new_status not in ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED') then
    raise exception 'INVALID_STATUS';
  end if;

  update public.documents
  set status = p_new_status,
      updated_at = now()
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
    'DOCUMENT_STATUS_CHANGE',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object(
      'from_status', v_old_status,
      'to_status', p_new_status,
      'reason', coalesce(p_reason, '')
    )
  );

  return query select p_document_id, p_new_status, v_old_status;
end;
$$;

-- 7.2 add_document_link
create or replace function public.add_document_link(
  p_actor_id uuid,
  p_from_id uuid,
  p_to_id uuid,
  p_relation text
)
returns table (
  id uuid,
  from_id uuid,
  to_id uuid,
  relation text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_from record;
  v_to record;
  v_link_id uuid;
  v_created_at timestamptz;
begin
  select u.id, u.email, u.role, u.status
  into v_actor
  from public.users u
  where u.id = p_actor_id;

  if not found or v_actor.status <> 'ACTIVE' or v_actor.role not in ('ADMIN', 'STAFF') then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_from_id = p_to_id then
    raise exception 'SELF_LINK_NOT_ALLOWED';
  end if;

  if p_relation not in ('RELATES_TO', 'SUPERSEDES', 'AMENDS') then
    raise exception 'INVALID_RELATION';
  end if;

  select d.document_id, d.confidential, d.deletion_state into v_from
  from public.documents d where d.document_id = p_from_id;
  if not found or v_from.deletion_state <> 'ACTIVE' then
    raise exception 'SOURCE_DOCUMENT_NOT_FOUND';
  end if;

  select d.document_id, d.confidential, d.deletion_state into v_to
  from public.documents d where d.document_id = p_to_id;
  if not found or v_to.deletion_state <> 'ACTIVE' then
    raise exception 'TARGET_DOCUMENT_NOT_FOUND';
  end if;

  if (v_from.confidential or v_to.confidential) and v_actor.role <> 'ADMIN' then
    raise exception 'FORBIDDEN';
  end if;

  if p_relation = 'SUPERSEDES' and public.check_supersede_cycle(p_from_id, p_to_id) then
    raise exception 'SUPERSEDE_CYCLE_DETECTED';
  end if;

  insert into public.document_links (from_id, to_id, relation, created_by)
  values (p_from_id, p_to_id, p_relation, v_actor.id)
  returning document_links.id, document_links.created_at into v_link_id, v_created_at;

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
    'DOCUMENT_LINK_CREATE',
    'DOCUMENT',
    p_from_id::text,
    jsonb_build_object(
      'link_id', v_link_id,
      'to_id', p_to_id,
      'relation', p_relation
    )
  );

  return query select v_link_id, p_from_id, p_to_id, p_relation, v_created_at;
end;
$$;

-- 7.3 remove_document_link
create or replace function public.remove_document_link(
  p_actor_id uuid,
  p_link_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_link record;
begin
  select u.id, u.email, u.role, u.status
  into v_actor
  from public.users u
  where u.id = p_actor_id;

  if not found or v_actor.status <> 'ACTIVE' or v_actor.role not in ('ADMIN', 'STAFF') then
    raise exception 'UNAUTHORIZED';
  end if;

  select l.id, l.from_id, l.to_id, l.relation into v_link
  from public.document_links l
  where l.id = p_link_id;

  if not found then
    return false;
  end if;

  delete from public.document_links where id = p_link_id;

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
    'DOCUMENT_LINK_DELETE',
    'DOCUMENT',
    v_link.from_id::text,
    jsonb_build_object(
      'link_id', p_link_id,
      'to_id', v_link.to_id,
      'relation', v_link.relation
    )
  );

  return true;
end;
$$;

-- 7.4 add_document_version
create or replace function public.add_document_version(
  p_actor_id uuid,
  p_document_id uuid,
  p_drive_file_id text,
  p_file_name text,
  p_file_type text,
  p_file_size bigint,
  p_file_sha256 text,
  p_change_summary text default ''
)
returns table (
  version_id uuid,
  document_id uuid,
  version_number integer,
  drive_file_id text,
  file_name text,
  file_type text,
  file_size bigint,
  file_sha256 text,
  change_summary text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_doc record;
  v_next_version integer;
  v_version_id uuid;
  v_created_at timestamptz;
begin
  select u.id, u.email, u.role, u.status
  into v_actor
  from public.users u
  where u.id = p_actor_id;

  if not found or v_actor.status <> 'ACTIVE' or v_actor.role not in ('ADMIN', 'STAFF') then
    raise exception 'UNAUTHORIZED';
  end if;

  select d.document_id, d.version_count, d.confidential, d.deletion_state
  into v_doc
  from public.documents d
  where d.document_id = p_document_id
  for update;

  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if v_doc.confidential and v_actor.role <> 'ADMIN' then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(max(v.version_number), v_doc.version_count, 1) + 1
  into v_next_version
  from public.document_versions v
  where v.document_id = p_document_id;

  insert into public.document_versions (
    document_id,
    version_number,
    drive_file_id,
    file_name,
    file_type,
    file_size,
    file_sha256,
    change_summary,
    created_by
  ) values (
    p_document_id,
    v_next_version,
    p_drive_file_id,
    p_file_name,
    p_file_type,
    p_file_size,
    p_file_sha256,
    coalesce(p_change_summary, ''),
    v_actor.id
  )
  returning id, created_at into v_version_id, v_created_at;

  update public.documents
  set drive_file_id = p_drive_file_id,
      file_name = p_file_name,
      file_type = p_file_type,
      file_sha256 = p_file_sha256,
      version_count = v_next_version,
      updated_at = now()
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
    'DOCUMENT_VERSION_UPLOAD',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object(
      'version_id', v_version_id,
      'version_number', v_next_version,
      'file_name', p_file_name,
      'file_sha256', p_file_sha256,
      'drive_file_id', p_drive_file_id
    )
  );

  return query select
    v_version_id,
    p_document_id,
    v_next_version,
    p_drive_file_id,
    p_file_name,
    p_file_type,
    p_file_size,
    p_file_sha256,
    coalesce(p_change_summary, ''),
    v_created_at;
end;
$$;

-- 7.5 add_document_tag
create or replace function public.add_document_tag(
  p_actor_id uuid,
  p_document_id uuid,
  p_tag_name text,
  p_tag_color text default 'blue'
)
returns table (
  tag_id uuid,
  tag_name text,
  tag_color text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_doc record;
  v_clean_name text;
  v_clean_color text;
  v_tag_id uuid;
begin
  select u.id, u.email, u.role, u.status
  into v_actor
  from public.users u
  where u.id = p_actor_id;

  if not found or v_actor.status <> 'ACTIVE' or v_actor.role not in ('ADMIN', 'STAFF') then
    raise exception 'UNAUTHORIZED';
  end if;

  select d.document_id, d.confidential, d.deletion_state
  into v_doc
  from public.documents d
  where d.document_id = p_document_id;

  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if v_doc.confidential and v_actor.role <> 'ADMIN' then
    raise exception 'FORBIDDEN';
  end if;

  v_clean_name := lower(btrim(p_tag_name));
  v_clean_color := lower(btrim(coalesce(p_tag_color, 'blue')));

  if length(v_clean_name) < 1 or length(v_clean_name) > 50 then
    raise exception 'INVALID_TAG_NAME';
  end if;

  insert into public.tags (name, color, created_by)
  values (v_clean_name, v_clean_color, v_actor.id)
  on conflict (name) do update set color = excluded.color
  returning tags.id into v_tag_id;

  insert into public.document_tags (document_id, tag_id, created_by)
  values (p_document_id, v_tag_id, v_actor.id)
  on conflict do nothing;

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
    'DOCUMENT_TAG_ADD',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object(
      'tag_id', v_tag_id,
      'tag_name', v_clean_name
    )
  );

  return query select v_tag_id, v_clean_name, v_clean_color;
end;
$$;

-- 7.6 remove_document_tag
create or replace function public.remove_document_tag(
  p_actor_id uuid,
  p_document_id uuid,
  p_tag_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
begin
  select u.id, u.email, u.role, u.status
  into v_actor
  from public.users u
  where u.id = p_actor_id;

  if not found or v_actor.status <> 'ACTIVE' or v_actor.role not in ('ADMIN', 'STAFF') then
    raise exception 'UNAUTHORIZED';
  end if;

  delete from public.document_tags
  where document_id = p_document_id and tag_id = p_tag_id;

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
    'DOCUMENT_TAG_REMOVE',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object('tag_id', p_tag_id)
  );

  return true;
end;
$$;

-- Revoke execute from public/anon/authenticated and grant to service_role
revoke all on function public.check_supersede_cycle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.check_supersede_cycle(uuid, uuid) to service_role;

revoke all on function public.change_document_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_document_status(uuid, uuid, text, text) to service_role;

revoke all on function public.add_document_link(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_document_link(uuid, uuid, uuid, text) to service_role;

revoke all on function public.remove_document_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_document_link(uuid, uuid) to service_role;

revoke all on function public.add_document_version(uuid, uuid, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.add_document_version(uuid, uuid, text, text, text, bigint, text, text) to service_role;

revoke all on function public.add_document_tag(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.add_document_tag(uuid, uuid, text, text) to service_role;

revoke all on function public.remove_document_tag(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_document_tag(uuid, uuid, uuid) to service_role;
