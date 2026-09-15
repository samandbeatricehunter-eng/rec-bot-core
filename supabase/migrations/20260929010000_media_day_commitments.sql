-- Dev Promotion / Media Overhaul plan (MEDIA-004/005): Media Day commitment ledger.
-- Every submitted Media Day answer is tied 1:1 to that side's already-issued, frozen weekly
-- Gold challenge (see media-day-interview.service.ts's submitMyMediaDayAnswer /
-- weekly-challenge-issuance.service.ts's resolveIssuedEntry) -- the content bank's answer
-- options carry no separate "how bold is this claim" signal today (every family is flavor/tone,
-- not a numeric prediction), so the commitment IS the interview itself: going on record about
-- that week's already-frozen Gold bar. This table makes that promise durable and gradeable
-- instead of living only as a media_statement event with no resolution.
create table if not exists public.rec_media_day_commitments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  period_id uuid not null references public.rec_media_day_periods(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  subject_key text not null default 'team',
  side text not null check (side in ('offense', 'defense')),
  commitment_type text not null default 'weekly_challenge_gold',
  challenge_id text not null,
  question_id text not null,
  question_text text not null,
  answer_key text not null,
  answer_text text not null,
  target_season_number int not null,
  target_week_number int not null,
  status text not null default 'pending' check (status in ('pending', 'defended', 'missed', 'void')),
  result_evidence jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (period_id, user_id, subject_key, side)
);

alter table public.rec_media_day_commitments enable row level security;

create index if not exists rec_media_day_commitments_league_status_idx
  on public.rec_media_day_commitments (league_id, status);

-- The advance-triggered resolution sweep's lookup pattern: every still-pending commitment
-- targeting the week that just advanced.
create index if not exists rec_media_day_commitments_target_pending_idx
  on public.rec_media_day_commitments (league_id, target_season_number, target_week_number)
  where status = 'pending';
