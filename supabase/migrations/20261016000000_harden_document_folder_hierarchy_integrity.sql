create or replace function public.admin_claim_hierarchy_folder_creation(
  p_actor_id uuid, p_idempotency_key uuid, p_parent_folder_id uuid, p_logical_parent_key text,
  p_drive_parent_id text, p_department_key text, p_hierarchy_kind text, p_filing_year integer,
  p_category text, p_subcategory text, p_name text, p_normalized_name text, p_logical_key text,
  p_operation_token uuid, p_lease_seconds integer default 60
) returns table (outcome text, folder_id uuid, drive_folder_id text, operation_token uuid)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare target public.document_folders%rowtype;
declare v_parent public.document_folders%rowtype;
begin
  if p_operation_token is null or p_lease_seconds < 1 or p_lease_seconds > 300 then raise exception 'VALIDATION_ERROR'; end if;
  if p_hierarchy_kind is null or p_hierarchy_kind not in ('YEAR','CATEGORY','SUBCATEGORY','WORKING_FOLDER') then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from public.users actor where actor.id=p_actor_id and actor.role='ADMIN' and actor.status='ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  if p_hierarchy_kind='YEAR' then
    if p_parent_folder_id is not null or p_department_key is null or p_filing_year is null or p_category is not null or p_subcategory is not null then raise exception 'INVALID_HIERARCHY_PARENT'; end if;
  else
    if p_parent_folder_id is null then raise exception 'INVALID_HIERARCHY_PARENT'; end if;
    select * into v_parent from public.document_folders where id=p_parent_folder_id for update;
    if not found or v_parent.status<>'ACTIVE' or v_parent.drive_folder_id is null then raise exception 'INVALID_HIERARCHY_PARENT'; end if;
    if p_drive_parent_id is distinct from v_parent.drive_folder_id or p_department_key is distinct from v_parent.department_key then raise exception 'HIERARCHY_PARENT_MISMATCH'; end if;
    if p_hierarchy_kind='CATEGORY' then
      if v_parent.hierarchy_kind is distinct from 'YEAR' or p_filing_year is distinct from v_parent.filing_year or p_category is null or p_subcategory is not null then raise exception 'INVALID_HIERARCHY_RELATIONSHIP'; end if;
    elsif p_hierarchy_kind='SUBCATEGORY' then
      if v_parent.hierarchy_kind is distinct from 'CATEGORY' or p_filing_year is distinct from v_parent.filing_year or p_category is distinct from v_parent.category or p_subcategory is null then raise exception 'INVALID_HIERARCHY_RELATIONSHIP'; end if;
    elsif p_hierarchy_kind='WORKING_FOLDER' then
      if v_parent.hierarchy_kind='CATEGORY' then
        if p_filing_year is distinct from v_parent.filing_year or p_category is distinct from v_parent.category or p_subcategory is not null then raise exception 'HIERARCHY_CONTEXT_MISMATCH'; end if;
      elsif v_parent.hierarchy_kind='SUBCATEGORY' then
        if p_filing_year is distinct from v_parent.filing_year or p_category is distinct from v_parent.category or p_subcategory is distinct from v_parent.subcategory then raise exception 'HIERARCHY_CONTEXT_MISMATCH'; end if;
      else raise exception 'INVALID_HIERARCHY_RELATIONSHIP'; end if;
    end if;
  end if;
  select * into target from public.document_folders where idempotency_key=p_idempotency_key for update;
  if found then
    if target.created_by is distinct from p_actor_id
      or target.department_key is distinct from p_department_key
      or target.hierarchy_kind is distinct from p_hierarchy_kind
      or target.parent_folder_id is distinct from p_parent_folder_id
      or target.logical_parent_key is distinct from p_logical_parent_key
      or target.drive_parent_id is distinct from p_drive_parent_id
      or target.filing_year is distinct from p_filing_year
      or target.category is distinct from p_category
      or target.subcategory is distinct from p_subcategory
      or target.logical_key is distinct from p_logical_key
      or target.name is distinct from p_name
      or target.normalized_name is distinct from p_normalized_name
    then raise exception 'IDEMPOTENCY_MISMATCH'; end if;
    if target.status='ACTIVE' then return query select 'ACTIVE'::text,target.id,target.drive_folder_id,null::uuid; return; end if;
    if target.status='CREATING' and target.lease_expires_at>now() then return query select 'IN_PROGRESS'::text,target.id,target.drive_folder_id,null::uuid; return; end if;
    update public.document_folders set status='CREATING',operation_token=p_operation_token,lease_expires_at=now()+pg_catalog.make_interval(secs=>p_lease_seconds),error_category=null where id=target.id;
    return query select 'CLAIMED'::text,target.id,target.drive_folder_id,p_operation_token; return;
  end if;
  begin
    insert into public.document_folders (idempotency_key,parent_folder_id,logical_parent_key,drive_parent_id,department_key,hierarchy_kind,filing_year,category,subcategory,name,normalized_name,logical_key,status,operation_token,lease_expires_at,created_by,source)
    values (p_idempotency_key,p_parent_folder_id,p_logical_parent_key,p_drive_parent_id,p_department_key,p_hierarchy_kind,p_filing_year,p_category,p_subcategory,p_name,p_normalized_name,p_logical_key,'CREATING',p_operation_token,now()+pg_catalog.make_interval(secs=>p_lease_seconds),p_actor_id,'DYNAMIC') returning * into target;
  exception when unique_violation then return query select 'DUPLICATE_NAME'::text,null::uuid,null::text,null::uuid; return; end;
  return query select 'CLAIMED'::text,target.id,null::text,p_operation_token;
end; $$;

revoke all on function public.admin_claim_hierarchy_folder_creation(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.admin_claim_hierarchy_folder_creation(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text,text,uuid,integer) to service_role;

create or replace function public.admin_register_static_document_folder(
  p_actor_id uuid,p_parent_folder_id uuid,p_logical_parent_key text,p_drive_parent_id text,
  p_department_key text,p_hierarchy_kind text,p_filing_year integer,p_category text,p_subcategory text,
  p_name text,p_normalized_name text,p_logical_key text,p_drive_folder_id text,p_upload_enabled boolean default false
) returns table (folder_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare target public.document_folders%rowtype;
declare v_parent public.document_folders%rowtype;
begin
  if not exists (select 1 from public.users actor where actor.id=p_actor_id and actor.role='ADMIN' and actor.status='ACTIVE') then raise exception 'ADMIN_REQUIRED'; end if;
  if p_hierarchy_kind is null or p_hierarchy_kind not in ('YEAR','CATEGORY','SUBCATEGORY','WORKING_FOLDER') or p_name='' or p_normalized_name='' or p_logical_key='' or p_drive_folder_id='' then raise exception 'VALIDATION_ERROR'; end if;
  if p_hierarchy_kind='YEAR' then
    if p_parent_folder_id is not null or p_department_key is null or p_filing_year is null or p_category is not null or p_subcategory is not null then raise exception 'INVALID_HIERARCHY_PARENT'; end if;
  else
    if p_parent_folder_id is null then raise exception 'INVALID_HIERARCHY_PARENT'; end if;
    select * into v_parent from public.document_folders where id=p_parent_folder_id for update;
    if not found or v_parent.status<>'ACTIVE' or v_parent.drive_folder_id is null then raise exception 'INVALID_HIERARCHY_PARENT'; end if;
    if p_drive_parent_id is distinct from v_parent.drive_folder_id or p_department_key is distinct from v_parent.department_key then raise exception 'HIERARCHY_PARENT_MISMATCH'; end if;
    if p_hierarchy_kind='CATEGORY' then
      if v_parent.hierarchy_kind is distinct from 'YEAR' or p_filing_year is distinct from v_parent.filing_year or p_category is null or p_subcategory is not null then raise exception 'INVALID_HIERARCHY_RELATIONSHIP'; end if;
    elsif p_hierarchy_kind='SUBCATEGORY' then
      if v_parent.hierarchy_kind is distinct from 'CATEGORY' or p_filing_year is distinct from v_parent.filing_year or p_category is distinct from v_parent.category or p_subcategory is null then raise exception 'INVALID_HIERARCHY_RELATIONSHIP'; end if;
    elsif p_hierarchy_kind='WORKING_FOLDER' then
      if v_parent.hierarchy_kind='CATEGORY' then
        if p_filing_year is distinct from v_parent.filing_year or p_category is distinct from v_parent.category or p_subcategory is not null then raise exception 'HIERARCHY_CONTEXT_MISMATCH'; end if;
      elsif v_parent.hierarchy_kind='SUBCATEGORY' then
        if p_filing_year is distinct from v_parent.filing_year or p_category is distinct from v_parent.category or p_subcategory is distinct from v_parent.subcategory then raise exception 'HIERARCHY_CONTEXT_MISMATCH'; end if;
      else raise exception 'INVALID_HIERARCHY_RELATIONSHIP'; end if;
    end if;
  end if;
  select * into target from public.document_folders where logical_key=p_logical_key for update;
  if found then
    if target.status<>'ACTIVE'
      or target.source is distinct from 'STATIC'
      or target.drive_folder_id is null
      or target.drive_folder_id is distinct from p_drive_folder_id
      or target.parent_folder_id is distinct from p_parent_folder_id
      or target.logical_parent_key is distinct from p_logical_parent_key
      or target.drive_parent_id is distinct from p_drive_parent_id
      or target.department_key is distinct from p_department_key
      or target.hierarchy_kind is distinct from p_hierarchy_kind
      or target.filing_year is distinct from p_filing_year
      or target.category is distinct from p_category
      or target.subcategory is distinct from p_subcategory
      or target.name is distinct from p_name
      or target.normalized_name is distinct from p_normalized_name
    then raise exception 'STATIC_ID_MISMATCH'; end if;
    return query select target.id,false; return;
  end if;
  if exists (select 1 from public.document_folders where drive_folder_id=p_drive_folder_id) then raise exception 'STATIC_DRIVE_ID_CONFLICT'; end if;
  insert into public.document_folders (idempotency_key,parent_folder_id,logical_parent_key,drive_parent_id,department_key,hierarchy_kind,filing_year,category,subcategory,name,normalized_name,logical_key,drive_folder_id,status,operation_token,lease_expires_at,created_by,error_category,upload_enabled,source)
  values (gen_random_uuid(),p_parent_folder_id,p_logical_parent_key,p_drive_parent_id,p_department_key,p_hierarchy_kind,p_filing_year,p_category,p_subcategory,p_name,p_normalized_name,p_logical_key,p_drive_folder_id,'ACTIVE',null,null,p_actor_id,null,p_upload_enabled,'STATIC') returning * into target;
  return query select target.id,true;
end; $$;

revoke all on function public.admin_register_static_document_folder(uuid,uuid,text,text,text,text,integer,text,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_register_static_document_folder(uuid,uuid,text,text,text,text,integer,text,text,text,text,text,text,boolean) to service_role;
