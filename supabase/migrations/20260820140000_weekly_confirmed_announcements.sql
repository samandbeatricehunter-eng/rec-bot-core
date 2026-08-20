create table if not exists public.rec_weekly_confirmed_announcements (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id),
  season_number integer not null,
  week_number integer not null,
  channel_id text,
  message_id text,
  confirmed_games jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, week_number)
);

alter table public.rec_weekly_confirmed_announcements enable row level security;
