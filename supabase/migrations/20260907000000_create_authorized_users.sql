-- Phase 1 authorization foundation. This table is intentionally separate from
-- auth.users: Google identity alone never grants KWD application access.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null check (role in ('ADMIN', 'STAFF', 'VIEWER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_lowercase check (email = lower(email))
);

alter table public.users enable row level security;

-- A signed-in person may read only their own authorization record. There are no
-- client write policies; later admin mutations must be authorized server-side.
create policy "Users can read their own authorization record"
  on public.users for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

grant usage on schema public to authenticated;
grant select on public.users to authenticated;
