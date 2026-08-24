-- Self-serve propose/accept/counter scheduling for tournament matches, mirroring the league's
-- rec_game_scheduling/rec_game_time_proposals (20260916050000_matchup_scheduling.sql) but keyed
-- by match_id instead of game_id, and dropping every Discord-tracking column -- this is site-only,
-- nothing here posts to Discord.
create table if not exists public.rec_site_tournament_match_scheduling (
  match_id uuid primary key references public.rec_site_tournament_matches(id) on delete cascade,
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  status text not null default 'not_scheduled'
    check (status in ('not_scheduled', 'proposed', 'confirmed', 'reschedule_requested')),
  scheduled_for timestamptz,
  confirmed_at timestamptz,
  proposed_by_user_id uuid references public.rec_users(id),
  accepted_by_user_id uuid references public.rec_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_site_tournament_match_scheduling enable row level security;
create index if not exists rec_site_tournament_match_scheduling_tournament_id_idx
  on public.rec_site_tournament_match_scheduling (tournament_id);

create table if not exists public.rec_site_tournament_match_time_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.rec_site_tournament_matches(id) on delete cascade,
  proposed_by_user_id uuid not null references public.rec_users(id),
  proposed_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'countered', 'rejected', 'withdrawn')),
  counter_to_id uuid references public.rec_site_tournament_match_time_proposals(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table public.rec_site_tournament_match_time_proposals enable row level security;
create index if not exists rec_site_tournament_match_time_proposals_match_id_idx
  on public.rec_site_tournament_match_time_proposals (match_id, created_at desc);
-- At most one pending offer per match at a time (same guarantee as the league table's
-- rec_game_time_proposals_one_pending_uidx, 20260819040000_one_pending_proposal.sql).
create unique index if not exists rec_site_tournament_match_proposals_one_pending_uidx
  on public.rec_site_tournament_match_time_proposals (match_id) where status = 'pending';
