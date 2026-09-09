-- Phase 2 document registry. Supabase/PostgreSQL is the application metadata
-- source of truth; this table never stores document file content.
create table if not exists public.documents (
  document_id uuid primary key default gen_random_uuid(),
  document_type text not null,
  document_number text,
  document_date date not null,
  subject text not null,
  persons_involved text,
  drive_file_id text,
  drive_url text,
  file_name text,
  file_type text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;

-- The application also verifies authorization server-side. This policy prevents
-- a signed-in but unauthorized or inactive identity from reading registry data.
create policy "Authorized active users can read documents"
  on public.documents for select to authenticated
  using (
    exists (
      select 1
      from public.users
      where email = lower(coalesce(auth.jwt() ->> 'email', ''))
        and status = 'ACTIVE'
    )
  );

grant select on public.documents to authenticated;
