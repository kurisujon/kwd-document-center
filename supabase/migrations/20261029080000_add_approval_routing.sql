-- Milestone 7: Document Approval Routing, Sequential Workflows, and Task Management.
-- Enforces ordered approval sequence (no skipping), role authorization, and audit logging.

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
    'REPORT_EXPORT_CSV',
    'APPROVAL_ROUTE_START',
    'APPROVAL_STEP_APPROVE',
    'APPROVAL_STEP_RETURN'
  )
);

-- 2. Approval Route Templates table
create table if not exists public.approval_routes (
  id uuid primary key default gen_random_uuid(),
  document_type text not null unique,
  name text not null,
  description text,
  steps jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.approval_routes enable row level security;

create policy "Authenticated users can read approval routes"
  on public.approval_routes
  for select
  to authenticated
  using (true);

grant select on public.approval_routes to authenticated;
grant all on public.approval_routes to service_role;

-- Seed default approval route templates for KWD document categories
insert into public.approval_routes (document_type, name, description, steps)
values
  (
    'CONTRACTS',
    'Contract Review & Approval Route',
    'Three-stage procurement and legal review for KWD agreements.',
    '[
      {"step_number": 1, "title": "Division Head Initial Review", "role": "STAFF"},
      {"step_number": 2, "title": "Legal / Administrative Clearance", "role": "ADMIN"},
      {"step_number": 3, "title": "General Manager Final Approval", "role": "ADMIN"}
    ]'::jsonb
  ),
  (
    'MEMORANDUM',
    'District Memorandum Route',
    'Administrative sign-off route for official memos and circulars.',
    '[
      {"step_number": 1, "title": "Originating Officer Verification", "role": "STAFF"},
      {"step_number": 2, "title": "General Manager Sign-off", "role": "ADMIN"}
    ]'::jsonb
  ),
  (
    'BOARD RESOLUTION',
    'Board Resolution Certification Route',
    'Governance certification sequence for enacted board resolutions.',
    '[
      {"step_number": 1, "title": "Board Secretary Verification", "role": "STAFF"},
      {"step_number": 2, "title": "Presiding Officer Certification", "role": "ADMIN"}
    ]'::jsonb
  ),
  (
    'BAC',
    'Bids and Awards Committee Route',
    'Procurement resolution and bidding document sign-off.',
    '[
      {"step_number": 1, "title": "BAC Secretariat Review", "role": "STAFF"},
      {"step_number": 2, "title": "BAC Chairman Approval", "role": "ADMIN"}
    ]'::jsonb
  )
on conflict (document_type) do nothing;

-- 3. Document Concrete Approval Steps table
create table if not exists public.document_approval_steps (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(document_id) on delete cascade,
  step_number integer not null check (step_number >= 1),
  title text not null,
  approver_id uuid references public.users(id),
  approver_role text check (approver_role in ('STAFF', 'ADMIN')),
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'APPROVED', 'RETURNED')),
  notes text,
  action_at timestamptz,
  action_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint document_approval_steps_doc_step_unique unique (document_id, step_number)
);

create index if not exists document_approval_steps_lookup_idx
  on public.document_approval_steps (document_id, step_number asc);

create index if not exists document_approval_steps_approver_idx
  on public.document_approval_steps (approver_id, status);

create index if not exists document_approval_steps_role_idx
  on public.document_approval_steps (approver_role, status);

alter table public.document_approval_steps enable row level security;

drop policy if exists "Users can read approval steps for accessible documents" on public.document_approval_steps;
create policy "Users can read approval steps for accessible documents"
  on public.document_approval_steps
  for select
  using (
    exists (
      select 1 from public.documents d
      where d.document_id = document_approval_steps.document_id
        and public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)
    )
  );

grant select on public.document_approval_steps to authenticated;
grant all on public.document_approval_steps to service_role;

-- 4. RPC: start_document_approval
create or replace function public.start_document_approval(
  p_actor_id uuid,
  p_document_id uuid,
  p_custom_steps jsonb default null
)
returns table (
  id uuid,
  document_id uuid,
  step_number integer,
  title text,
  approver_id uuid,
  approver_role text,
  status text,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
  v_doc public.documents%rowtype;
  v_steps_json jsonb;
  v_step record;
  v_first boolean := true;
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

  -- Remove prior steps if any
  delete from public.document_approval_steps
  where public.document_approval_steps.document_id = p_document_id;

  -- Resolve steps configuration
  if p_custom_steps is not null and jsonb_array_length(p_custom_steps) > 0 then
    v_steps_json := p_custom_steps;
  else
    select steps into v_steps_json
    from public.approval_routes
    where document_type = v_doc.document_type;

    if v_steps_json is null or jsonb_array_length(v_steps_json) = 0 then
      -- Default two-step route if no explicit template
      v_steps_json := '[
        {"step_number": 1, "title": "Staff Preliminary Review", "role": "STAFF"},
        {"step_number": 2, "title": "Administrative Final Approval", "role": "ADMIN"}
      ]'::jsonb;
    end if;
  end if;

  -- Insert steps sequentially
  for v_step in select * from jsonb_to_recordset(v_steps_json) as x(
    step_number integer,
    title text,
    role text,
    approver_id uuid
  ) loop
    insert into public.document_approval_steps (
      document_id,
      step_number,
      title,
      approver_role,
      approver_id,
      status
    ) values (
      p_document_id,
      v_step.step_number,
      v_step.title,
      coalesce(v_step.role, 'ADMIN'),
      v_step.approver_id,
      case when v_first then 'IN_PROGRESS' else 'PENDING' end
    );
    v_first := false;
  end loop;

  -- Transition document status to UNDER_REVIEW
  update public.documents
  set
    status = 'UNDER_REVIEW',
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
    'APPROVAL_ROUTE_START',
    'DOCUMENT',
    p_document_id::text,
    jsonb_build_object(
      'document_type', v_doc.document_type,
      'step_count', jsonb_array_length(v_steps_json)
    )
  );

  return query
  select
    s.id,
    s.document_id,
    s.step_number,
    s.title,
    s.approver_id,
    s.approver_role,
    s.status,
    s.notes,
    s.created_at
  from public.document_approval_steps s
  where s.document_id = p_document_id
  order by s.step_number asc;
end;
$$;

revoke all on function public.start_document_approval(uuid, uuid, jsonb) from public, anon;
grant execute on function public.start_document_approval(uuid, uuid, jsonb) to authenticated, service_role;

-- 5. RPC: process_approval_action
create or replace function public.process_approval_action(
  p_actor_id uuid,
  p_step_id uuid,
  p_action text,
  p_notes text default ''
)
returns table (
  id uuid,
  document_id uuid,
  step_number integer,
  title text,
  status text,
  notes text,
  document_status text,
  is_completed boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
  v_step public.document_approval_steps%rowtype;
  v_doc public.documents%rowtype;
  v_prior_incomplete boolean;
  v_has_next boolean;
  v_action_time timestamptz := now();
  v_new_doc_status text;
  v_is_done boolean := false;
begin
  select * into v_actor from public.users where public.users.id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' then
    raise exception 'ACTOR_NOT_AUTHORIZED';
  end if;

  if p_action not in ('APPROVE', 'RETURN') then
    raise exception 'INVALID_APPROVAL_ACTION';
  end if;

  select * into v_step from public.document_approval_steps where public.document_approval_steps.id = p_step_id;
  if not found then
    raise exception 'STEP_NOT_FOUND';
  end if;

  if v_step.status not in ('PENDING', 'IN_PROGRESS') then
    raise exception 'STEP_ALREADY_PROCESSED';
  end if;

  select * into v_doc from public.documents where public.documents.document_id = v_step.document_id;
  if not found or v_doc.deletion_state <> 'ACTIVE' then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if not public.can_read_document(p_actor_id, v_step.document_id) then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;

  -- Authorization check: Actor must be assigned approver_id, or match role, or be an ADMIN
  if v_step.approver_id is not null and v_step.approver_id <> p_actor_id and v_actor.role <> 'ADMIN' then
    raise exception 'UNAUTHORIZED_APPROVER';
  end if;

  if v_step.approver_id is null and v_actor.role <> v_step.approver_role and v_actor.role <> 'ADMIN' then
    raise exception 'UNAUTHORIZED_APPROVER_ROLE';
  end if;

  -- Sequential validation: No skipping! All previous steps must be APPROVED
  select exists (
    select 1 from public.document_approval_steps prev
    where prev.document_id = v_step.document_id
      and prev.step_number < v_step.step_number
      and prev.status <> 'APPROVED'
  ) into v_prior_incomplete;

  if v_prior_incomplete then
    raise exception 'PRIOR_STEP_UNAPPROVED';
  end if;

  v_new_doc_status := v_doc.status;

  if p_action = 'APPROVE' then
    -- Mark current step approved
    update public.document_approval_steps
    set
      status = 'APPROVED',
      action_at = v_action_time,
      action_by = p_actor_id,
      notes = coalesce(p_notes, '')
    where public.document_approval_steps.id = p_step_id;

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
      'APPROVAL_STEP_APPROVE',
      'DOCUMENT',
      v_step.document_id::text,
      jsonb_build_object(
        'step_id', p_step_id,
        'step_number', v_step.step_number,
        'step_title', v_step.title,
        'notes', coalesce(p_notes, '')
      )
    );

    -- Check if there is a subsequent step
    select exists (
      select 1 from public.document_approval_steps next_step
      where next_step.document_id = v_step.document_id
        and next_step.step_number = v_step.step_number + 1
    ) into v_has_next;

    if v_has_next then
      -- Activate next step
      update public.document_approval_steps
      set status = 'IN_PROGRESS'
      where document_id = v_step.document_id
        and step_number = v_step.step_number + 1;
    else
      -- Final step completed! Auto-promote document status to APPROVED
      v_new_doc_status := 'APPROVED';
      v_is_done := true;

      update public.documents
      set
        status = 'APPROVED',
        updated_at = v_action_time
      where public.documents.document_id = v_step.document_id;
    end if;

  elsif p_action = 'RETURN' then
    -- Mark current step returned
    update public.document_approval_steps
    set
      status = 'RETURNED',
      action_at = v_action_time,
      action_by = p_actor_id,
      notes = coalesce(p_notes, '')
    where public.document_approval_steps.id = p_step_id;

    -- Document remains UNDER_REVIEW
    v_new_doc_status := 'UNDER_REVIEW';

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
      'APPROVAL_STEP_RETURN',
      'DOCUMENT',
      v_step.document_id::text,
      jsonb_build_object(
        'step_id', p_step_id,
        'step_number', v_step.step_number,
        'step_title', v_step.title,
        'return_notes', coalesce(p_notes, '')
      )
    );
  end if;

  return query
  select
    v_step.id,
    v_step.document_id,
    v_step.step_number,
    v_step.title,
    (case when p_action = 'APPROVE' then 'APPROVED' else 'RETURNED' end) as status,
    coalesce(p_notes, '') as notes,
    v_new_doc_status as document_status,
    v_is_done as is_completed;
end;
$$;

revoke all on function public.process_approval_action(uuid, uuid, text, text) from public, anon;
grant execute on function public.process_approval_action(uuid, uuid, text, text) to authenticated, service_role;

-- 6. RPC: get_user_approval_tasks
create or replace function public.get_user_approval_tasks(
  p_actor_id uuid
)
returns table (
  step_id uuid,
  document_id uuid,
  step_number integer,
  step_title text,
  step_status text,
  approver_id uuid,
  approver_role text,
  document_number text,
  document_type text,
  subject text,
  confidential boolean,
  file_name text,
  file_type text,
  document_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where public.users.id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' then
    return;
  end if;

  return query
  select
    s.id as step_id,
    s.document_id,
    s.step_number,
    s.title as step_title,
    s.status as step_status,
    s.approver_id,
    s.approver_role,
    d.document_number,
    d.document_type,
    d.subject,
    d.confidential,
    d.file_name,
    d.file_type,
    d.status as document_status,
    s.created_at
  from public.document_approval_steps s
  join public.documents d on d.document_id = s.document_id
  where d.deletion_state = 'ACTIVE'
    and s.status = 'IN_PROGRESS'
    and public.can_read_document(p_actor_id, d.document_id)
    and (
      v_actor.role = 'ADMIN'
      or s.approver_id = p_actor_id
      or (s.approver_id is null and s.approver_role = v_actor.role)
    )
  order by s.created_at asc, s.step_number asc;
end;
$$;

revoke all on function public.get_user_approval_tasks(uuid) from public, anon;
grant execute on function public.get_user_approval_tasks(uuid) to authenticated, service_role;

