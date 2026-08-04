-- Recruiting board rebuild: recruit rows gain height/weight, and a per-team "board" (saved
-- watch-list, distinct from the full recruit pool) becomes possible via a join table — a
-- recruit can be on any number of teams' boards pre-commit, same as real recruiting.
alter table public.rec_recruiting_profiles add column if not exists height_inches integer;
alter table public.rec_recruiting_profiles add column if not exists weight_lbs integer;

create table if not exists public.rec_recruiting_board_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  recruit_id uuid not null references public.rec_recruiting_profiles(id) on delete cascade,
  added_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, recruit_id)
);

alter table public.rec_recruiting_board_entries enable row level security;

create index if not exists rec_recruiting_board_entries_team_idx on public.rec_recruiting_board_entries (team_id);
