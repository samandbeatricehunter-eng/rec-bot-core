alter table public.rec_league_configuration
  add column if not exists custom_playbooks_allowed boolean not null default false;
