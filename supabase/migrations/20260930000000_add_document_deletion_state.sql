alter table public.documents
  add column deletion_state text not null default 'ACTIVE',
  add column delete_started_at timestamptz,
  add column delete_operation_token uuid,
  add column delete_lease_expires_at timestamptz,
  add column delete_error_category text,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.users(id),
  add column drive_trashed_at timestamptz;

alter table public.documents
  add constraint documents_deletion_state_valid
  check (deletion_state in ('ACTIVE', 'DELETE_PENDING', 'DELETED', 'DELETE_FAILED')),
  add constraint documents_deletion_state_shape
  check (
    (deletion_state = 'ACTIVE'
      and delete_started_at is null and delete_operation_token is null and delete_lease_expires_at is null
      and delete_error_category is null and deleted_at is null and deleted_by is null and drive_trashed_at is null)
    or (deletion_state = 'DELETE_PENDING'
      and delete_started_at is not null and delete_operation_token is not null and delete_lease_expires_at is not null
      and delete_error_category is null and deleted_at is null and deleted_by is null and drive_trashed_at is null)
    or (deletion_state = 'DELETE_FAILED'
      and delete_started_at is not null and delete_operation_token is null and delete_lease_expires_at is null
      and delete_error_category is not null and deleted_at is null and deleted_by is null and drive_trashed_at is null)
    or (deletion_state = 'DELETED'
      and delete_started_at is not null and delete_operation_token is null and delete_lease_expires_at is null
      and delete_error_category is null and deleted_at is not null and deleted_by is not null)
  );

create index documents_active_deletion_state_idx
  on public.documents (created_at desc)
  where deletion_state = 'ACTIVE';

drop policy if exists "Authorized active users can read documents" on public.documents;
create policy "Authorized active users can read active documents"
  on public.documents for select to authenticated
  using (
    deletion_state = 'ACTIVE'
    and exists (
      select 1 from public.users
      where email = lower(coalesce(auth.jwt() ->> 'email', '')) and status = 'ACTIVE'
    )
  );

create or replace function public.admin_claim_document_deletion(
  p_document_id uuid,
  p_actor_id uuid,
  p_operation_token uuid,
  p_lease_seconds integer default 60
)
returns table (outcome text, drive_file_id text, operation_token uuid)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare target public.documents%rowtype;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 300 then raise exception 'VALIDATION_ERROR'; end if;
  if p_operation_token is null then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  select * into target from public.documents where document_id = p_document_id for update;
  if not found then return query select 'NOT_FOUND'::text, null::text, null::uuid; return; end if;
  if target.deletion_state = 'DELETED' then return query select 'ALREADY_DELETED'::text, target.drive_file_id, null::uuid; return; end if;
  if target.deletion_state = 'DELETE_PENDING' and target.delete_lease_expires_at > now() then
    return query select 'IN_PROGRESS'::text, target.drive_file_id, null::uuid; return;
  end if;
  update public.documents set deletion_state = 'DELETE_PENDING', delete_started_at = now(), delete_operation_token = p_operation_token,
    delete_lease_expires_at = now() + pg_catalog.make_interval(secs => p_lease_seconds), delete_error_category = null
  where document_id = p_document_id;
  return query select 'CLAIMED'::text, target.drive_file_id, p_operation_token;
end;
$$;

create or replace function public.admin_finalize_document_deletion(
  p_document_id uuid, p_actor_id uuid, p_operation_token uuid, p_drive_trashed boolean
)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  update public.documents set deletion_state = 'DELETED', deleted_at = now(), deleted_by = p_actor_id,
    drive_trashed_at = case when p_drive_trashed then now() else null end,
    delete_operation_token = null, delete_lease_expires_at = null, delete_error_category = null
  where document_id = p_document_id and deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token;
  return found;
end;
$$;

create or replace function public.admin_mark_document_delete_failed(
  p_document_id uuid, p_actor_id uuid, p_operation_token uuid, p_error_category text
)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if p_error_category not in ('DRIVE_PERMISSION', 'DRIVE_UNAVAILABLE', 'DRIVE_UNKNOWN', 'REGISTRY_FINALIZATION') then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from public.users actor where actor.id = p_actor_id and actor.role = 'ADMIN' and actor.status = 'ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  update public.documents set deletion_state = 'DELETE_FAILED', delete_operation_token = null, delete_lease_expires_at = null, delete_error_category = p_error_category
  where document_id = p_document_id and deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token;
  return found;
end;
$$;

revoke all on function public.admin_claim_document_deletion(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_finalize_document_deletion(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_mark_document_delete_failed(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_claim_document_deletion(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.admin_finalize_document_deletion(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.admin_mark_document_delete_failed(uuid, uuid, uuid, text) to service_role;
