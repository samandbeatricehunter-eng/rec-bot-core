-- Trade Center backlog (#44) — draft-pick assets.
-- Each team's own draft pick, per season/round, is one row. league_id + season_number
-- (not a rec_seasons FK — that table is effectively unused everywhere else in the app;
-- every other table tracks seasons as a plain integer) so the "next 3 seasons" rolling
-- window Madden itself shows is just a live query (season_number between current and
-- current+2), not stored state that needs decrementing every year.
--
-- Commissioners manually enter each team's first 3 seasons of picks (a new franchise's
-- inaugural draft classes have no prior-season standings to derive an order from — and
-- ideally get pre-seeded from Madden's real default assignment once that data is
-- sourced; deferred, not part of this migration). Season 4+ picks are bulk-generated in
-- standard order (worst record picks first, same order every round, no snake) once that
-- season's final regular-season standings are known — pick_number is left null until then
-- so the pick can still be traded as a future asset before the order is set.
--
-- manual_lock marks a row a commissioner has hand-edited so a later auto-generation pass
-- won't silently overwrite it. current_team_id (not original_team_id) is what a trade
-- actually reassigns.
create table if not exists public.rec_draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  round integer not null check (round between 1 and 7),
  original_team_id uuid not null references public.rec_teams(id) on delete cascade,
  current_team_id uuid not null references public.rec_teams(id) on delete cascade,
  pick_number integer check (pick_number is null or pick_number between 1 and 32),
  source text not null default 'manual' check (source in ('manual', 'generated')),
  manual_lock boolean not null default false,
  admin_notes text,
  created_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, round, original_team_id)
);

alter table public.rec_draft_picks enable row level security;

create index if not exists rec_draft_picks_league_season_idx on public.rec_draft_picks (league_id, season_number);
create index if not exists rec_draft_picks_current_team_idx on public.rec_draft_picks (current_team_id);

-- Append-only history — same shape as rec_custom_player_audit_log.
create table if not exists public.rec_draft_pick_audit (
  id uuid primary key default gen_random_uuid(),
  draft_pick_id uuid not null references public.rec_draft_picks(id) on delete cascade,
  changed_by_user_id uuid references public.rec_users(id) on delete set null,
  change_type text not null,
  previous_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.rec_draft_pick_audit enable row level security;

create index if not exists rec_draft_pick_audit_pick_idx on public.rec_draft_pick_audit (draft_pick_id);
