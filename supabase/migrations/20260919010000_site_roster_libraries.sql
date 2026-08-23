-- Global, named roster libraries (e.g. "M27 Baseline") that tournaments can link to for
-- displaying real per-team rosters, seeded from an in-game/companion-app export.
create table if not exists public.rec_site_roster_libraries (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('madden_26','madden_27','cfb_27')),
  name text not null,
  is_baseline boolean not null default false,
  source_note text,
  created_by_user_id uuid not null references public.rec_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game, name)
);
alter table public.rec_site_roster_libraries enable row level security;

-- attributes jsonb (not flat columns) since an arbitrary export tool's column set isn't known
-- ahead of time -- every non-core CSV header lands here verbatim, keyed by its source header.
create table if not exists public.rec_site_roster_library_players (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.rec_site_roster_libraries(id) on delete cascade,
  team_abbr text not null,
  team_name text not null,
  full_name text not null,
  position text,
  jersey_number integer,
  overall_rating integer,
  attributes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.rec_site_roster_library_players enable row level security;
create index if not exists rec_site_roster_library_players_library_team_idx
  on public.rec_site_roster_library_players (library_id, team_abbr);

alter table public.rec_site_tournaments
  add column if not exists roster_library_id uuid references public.rec_site_roster_libraries(id);
