-- Enable required extensions
create extension if not exists "uuid-ossp";

-- critical_sessions: tracks the user-initiated lifecycle of a critical task.
-- This blocks cross-user reads or writes because each row is scoped to auth.uid().
create type public.category_enum as enum ('code', 'email', 'form', 'doc_notion', 'terminal', 'autosave');

create table if not exists public.critical_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_name text not null,
  category public.category_enum not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- checkpoints: stores the latest browser and filesystem state, keyed to a session and the user.
-- This blocks unauthorized access from other users or session ids that do not belong to auth.uid().
create table if not exists public.checkpoints (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.critical_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

-- screenshots: stores checkpoint screenshots as private bucket objects.
-- This blocks access to another user's screenshots or storage paths by making row ownership user-scoped.
create table if not exists public.screenshots (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.critical_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  captured_at timestamptz not null default now()
);

alter table public.critical_sessions enable row level security;
alter table public.checkpoints enable row level security;
alter table public.screenshots enable row level security;

-- Policies are intentionally explicit and narrow. They allow only the owner to read or alter their own data.
create policy "critical_sessions_select_own_rows"
  on public.critical_sessions
  for select
  using (auth.uid() = user_id);

create policy "critical_sessions_insert_own_rows"
  on public.critical_sessions
  for insert
  with check (auth.uid() = user_id);

create policy "critical_sessions_update_own_rows"
  on public.critical_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "critical_sessions_delete_own_rows"
  on public.critical_sessions
  for delete
  using (auth.uid() = user_id);

create policy "checkpoints_select_own_rows"
  on public.checkpoints
  for select
  using (auth.uid() = user_id);

create policy "checkpoints_insert_own_rows"
  on public.checkpoints
  for insert
  with check (auth.uid() = user_id);

create policy "checkpoints_update_own_rows"
  on public.checkpoints
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "checkpoints_delete_own_rows"
  on public.checkpoints
  for delete
  using (auth.uid() = user_id);

create policy "screenshots_select_own_rows"
  on public.screenshots
  for select
  using (auth.uid() = user_id);

create policy "screenshots_insert_own_rows"
  on public.screenshots
  for insert
  with check (auth.uid() = user_id);

create policy "screenshots_update_own_rows"
  on public.screenshots
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "screenshots_delete_own_rows"
  on public.screenshots
  for delete
  using (auth.uid() = user_id);

create publication if not exists supabase_realtime for table public.checkpoints;
