-- Game of the Year: the regular-season game with the most "like" reactions
-- (rec_game_reactions) wins. Unlike Play of the Year (which auto-splits ties),
-- GOTY ties are NOT auto-resolved: every tied game gets its own pending row here,
-- and the commissioner picks the winner by approving one and denying the rest
-- from the Pending Payouts inbox, same as any other season-end review.
create table if not exists public.rec_game_of_year_reviews (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  season_number integer not null,
  like_count integer not null default 0,
  home_user_id uuid references public.rec_users(id),
  home_team_id uuid references public.rec_teams(id),
  home_team_label text,
  away_user_id uuid references public.rec_users(id),
  away_team_id uuid references public.rec_teams(id),
  away_team_label text,
  amount integer not null default 250,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'issued')),
  reviewed_by_discord_id text,
  denied_reason text,
  issued_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, season_number, game_id)
);

alter table public.rec_game_of_year_reviews enable row level security;

create index if not exists rec_game_of_year_reviews_league_season_idx
  on public.rec_game_of_year_reviews(league_id, season_number, status);
