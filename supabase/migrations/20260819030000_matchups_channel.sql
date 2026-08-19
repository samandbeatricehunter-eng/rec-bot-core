-- Weekly "Matchups" channel: one posted/edited-in-place embed per league per week listing every
-- H2H matchup, tagging both coaches, with a live scheduling status and stream links per row.
alter table public.rec_server_routes add column if not exists matchups_channel_id text;

create table if not exists public.rec_matchups_channel_posts (
  league_id uuid primary key references public.rec_leagues(id) on delete cascade,
  week_number integer not null,
  channel_id text not null,
  message_id text not null,
  updated_at timestamptz not null default now()
);
alter table public.rec_matchups_channel_posts enable row level security;
