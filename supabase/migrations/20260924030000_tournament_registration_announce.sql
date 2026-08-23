alter table public.rec_site_tournaments
  add column if not exists registration_open_announced_at timestamptz;
