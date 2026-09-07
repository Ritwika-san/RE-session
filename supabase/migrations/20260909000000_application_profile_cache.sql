alter table public.critical_sessions
  add column if not exists application text not null default 'browser';

notify pgrst, 'reload schema';