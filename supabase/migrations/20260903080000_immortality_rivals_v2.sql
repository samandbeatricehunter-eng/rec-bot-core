-- Rise to Immortality Rivals v2: up to 2 rival teams per prospect side (was 1), with per-slot
-- streak tracking and a once-per-season change limit. Table was empty in production, so this
-- drops and recreates rather than a careful column-by-column migration.
--
-- unchanged_since_season is the season number this slot's CURRENT rival_team_id was first set
-- (or last changed) -- streak length is always derived live as
-- (currentSeason - unchanged_since_season + 1), so no per-season maintenance job is needed.
-- last_changed_season is the season an actual CHANGE (not the initial pick) last happened in --
-- a further change is blocked while last_changed_season equals the current season.
drop table if exists public.rec_immortality_rivals;
create table public.rec_immortality_rivals (
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  side text not null check (side in ('offense','defense')),
  slot smallint not null check (slot in (1,2)),
  rival_team_id uuid not null references public.rec_teams(id) on delete cascade,
  unchanged_since_season integer not null,
  last_changed_season integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (immortality_league_id, user_id, side, slot)
);
alter table public.rec_immortality_rivals enable row level security;
