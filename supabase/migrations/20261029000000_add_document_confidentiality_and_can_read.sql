-- Milestone 1 Task 1: Document confidentiality flag and can_read_document helper.
alter table public.documents
  add column confidential boolean not null default false;

create index documents_active_confidential_idx
  on public.documents (confidential, created_at desc)
  where deletion_state = 'ACTIVE';

-- Evaluates whether the caller email belongs to an ACTIVE authorized user who may
-- read a document row with the given deletion_state and confidentiality flag.
create or replace function public.can_read_document(
  p_user_email text,
  p_deletion_state text,
  p_confidential boolean
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p_deletion_state = 'ACTIVE'
    and exists (
      select 1
      from public.users actor
      where actor.email = lower(btrim(coalesce(p_user_email, '')))
        and actor.status = 'ACTIVE'
        and (not coalesce(p_confidential, false) or actor.role = 'ADMIN')
    );
$$;

-- Evaluates whether a server-resolved actor UUID may read a specific document UUID.
-- Used by service-role server paths and RPCs where RLS does not apply automatically.
create or replace function public.can_read_document(
  p_actor_id uuid,
  p_document_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.documents doc
    join public.users actor on actor.id = p_actor_id
    where doc.document_id = p_document_id
      and doc.deletion_state = 'ACTIVE'
      and actor.status = 'ACTIVE'
      and (not doc.confidential or actor.role = 'ADMIN')
  );
$$;

revoke all on function public.can_read_document(text, text, boolean) from public, anon;
grant execute on function public.can_read_document(text, text, boolean) to authenticated, service_role;

revoke all on function public.can_read_document(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_read_document(uuid, uuid) to service_role;

drop policy if exists "Authorized active users can read active documents" on public.documents;
create policy "Authorized active users can read accessible documents"
  on public.documents for select to authenticated
  using (
    public.can_read_document(auth.jwt() ->> 'email', deletion_state, confidential)
  );

create or replace function public.admin_set_document_confidential(
  p_document_id uuid,
  p_actor_id uuid,
  p_confidential boolean
)
returns table (outcome text, confidential boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.documents%rowtype;
begin
  if p_document_id is null or p_actor_id is null or p_confidential is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1
    from public.users actor
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

  if not found or target.deletion_state <> 'ACTIVE' then
    return query select 'NOT_FOUND'::text, false;
    return;
  end if;

  update public.documents
  set confidential = p_confidential,
      updated_at = now()
  where document_id = p_document_id;

  return query select 'UPDATED'::text, p_confidential;
end;
$$;

revoke all on function public.admin_set_document_confidential(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_document_confidential(uuid, uuid, boolean) to service_role;
