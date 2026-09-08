-- Non-RTI Media Day: structured weekly interview replacing the old free-text "Submit an
-- Interview" flow. Every non-RTI user represents a TEAM (no player-prospect entities like RTI
-- has), so answers are team-scoped, not user/prospect-scoped. season_stage is part of the
-- identity key (same reason as rec_immortality_owner_interview_answers) since offseason stages
-- can each independently start counting weeks from 1.
create table if not exists public.rec_media_day_answers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  season_number integer not null,
  season_stage text not null,
  week_number integer not null,
  slot integer not null,
  question_id text not null,
  question_text text not null,
  question_category text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  unique (team_id, season_number, season_stage, week_number, slot)
);
alter table public.rec_media_day_answers enable row level security;
create index if not exists rec_media_day_answers_league_idx
  on public.rec_media_day_answers(league_id, season_number, week_number);
create index if not exists rec_media_day_answers_team_idx
  on public.rec_media_day_answers(team_id, season_number);
