alter table public.rec_leagues
  add column if not exists is_online boolean not null default true;
