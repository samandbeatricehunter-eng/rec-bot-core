-- Fantasy draft sessions + pool (docs/madden-fantasy-draft-plan.md §2, §4).
-- rec_players is the shared pool table; "drafted" is derived — a player counts as
-- drafted when a rec_fantasy_draft_picks row exists for it. These tables are deliberately
-- named rec_fantasy_draft_* to avoid colliding with rec_draft_picks (rookie pick assets).
-- Also adds rec_players.photo_url for the League Mgmt per-player headshot upload (§11).

create table public.rec_fantasy_draft_sessions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  status text not null default 'not_scheduled'
    check (status in ('not_scheduled','scheduled','live','wrap_up','concluded')),
  order_mode text check (order_mode in ('standard','snake')),
  scheduled_at timestamptz,
  current_round integer not null default 1,
  current_pick_in_round integer not null default 1,
  commenced_by_user_id uuid,
  commenced_at timestamptz,
  concluded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_fantasy_draft_sessions enable row level security;
create unique index rec_fantasy_draft_sessions_one_active_idx
  on public.rec_fantasy_draft_sessions(league_id) where status != 'concluded';

create table public.rec_fantasy_draft_pick_order (
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  pick_in_round integer not null check (pick_in_round between 1 and 32),
  team_id uuid not null references public.rec_teams(id),
  primary key (session_id, pick_in_round)
);
alter table public.rec_fantasy_draft_pick_order enable row level security;

create table public.rec_fantasy_draft_picks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  round integer not null,
  pick_in_round integer not null,
  overall_pick_number integer not null,
  team_id uuid not null references public.rec_teams(id),
  player_id uuid not null references public.rec_players(id),
  is_wrapup_pick boolean not null default false,
  logged_by_user_id uuid not null,
  logged_at timestamptz not null default now(),
  unique (session_id, player_id)
);
alter table public.rec_fantasy_draft_picks enable row level security;
create index rec_fantasy_draft_picks_session_idx on public.rec_fantasy_draft_picks(session_id, overall_pick_number);

-- League Mgmt per-player custom headshot upload (plan §11). Overwritten by
-- POST /v1/roster/player/photo; also populated from the Madden baseline on league apply.
alter table public.rec_players add column if not exists photo_url text;
