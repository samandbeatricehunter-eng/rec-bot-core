-- Registration windows, game rules, team/gamer-tag on entrants, match evidence.

alter table public.rec_site_tournaments
  add column if not exists registration_opens_at timestamptz not null default now(),
  add column if not exists registration_closes_at timestamptz,
  add column if not exists kickoff_at timestamptz,
  add column if not exists rules jsonb not null default '{}'::jsonb,
  add column if not exists ticker_announcement_id uuid;

alter table public.rec_site_tournament_entrants
  add column if not exists team_abbr text,
  add column if not exists team_name text,
  add column if not exists gamer_tag text;

alter table public.rec_site_tournament_matches
  add column if not exists result_method text
    check (result_method is null or result_method in ('final_screenshot', 'concede', 'bye')),
  add column if not exists screenshot_url text,
  add column if not exists conceded_by_user_id uuid references public.rec_users(id);
