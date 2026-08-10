-- Tracks the single live-edited "league post" recruiting-board embed per league, posted in the
-- per-game-type management-guild channel configured in rec_site_discord_config. One row per
-- league; the ad is deleted (row + Discord message) once the league has zero open teams.
create table if not exists rec_league_recruiting_ads (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references rec_leagues(id) on delete cascade,
  game text not null,
  channel_id text not null,
  message_id text,
  updated_at timestamptz not null default now(),
  unique (league_id)
);

alter table rec_league_recruiting_ads enable row level security;
