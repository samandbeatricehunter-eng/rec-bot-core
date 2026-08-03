create table if not exists public.rec_league_suspensions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  target_type text not null check (target_type in ('user','player')),
  user_id uuid references public.rec_users(id) on delete cascade,
  player_id uuid references public.rec_players(id) on delete cascade,
  season_number integer not null check (season_number >= 1),
  start_week integer not null check (start_week >= 1),
  end_week integer not null check (end_week >= start_week),
  reason text not null check (length(trim(reason)) >= 3),
  active boolean not null default true,
  public_story_id uuid references public.rec_game_stories(id) on delete set null,
  created_by_user_id uuid not null references public.rec_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  lifted_by_user_id uuid references public.rec_users(id) on delete set null,
  lifted_at timestamptz,
  constraint rec_league_suspensions_target_check check (
    (target_type='user' and user_id is not null and player_id is null)
    or (target_type='player' and player_id is not null)
  )
);

alter table public.rec_league_suspensions enable row level security;
create index if not exists rec_league_suspensions_user_lookup_idx
  on public.rec_league_suspensions(league_id,user_id,season_number,start_week,end_week,active);
create index if not exists rec_league_suspensions_player_lookup_idx
  on public.rec_league_suspensions(league_id,player_id,season_number,start_week,end_week,active);
revoke all on table public.rec_league_suspensions from anon, authenticated;
