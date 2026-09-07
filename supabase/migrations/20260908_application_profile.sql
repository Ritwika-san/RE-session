alter table public.critical_sessions
  add column if not exists application text not null default 'browser';

alter publication supabase_realtime add table public.screenshots;