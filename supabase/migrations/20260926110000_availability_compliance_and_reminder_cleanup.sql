-- Scheduling reminder rework: availability compliance becomes advance-triggered (not a 60s
-- poll), and a real "marked Unavailable" fact is added so a day with no data can be told apart
-- from a day the user explicitly cleared. See fantasy-draft-style commissioner tooling notes in
-- apps/api/src/modules/scheduling for the reminder-poller simplification this pairs with.

-- Presence of a row = "explicitly marked unavailable this day" -- mirrors how
-- rec_user_availability_windows already uses row-presence (not a boolean column) as its signal,
-- and follows the same global (league_id null) vs league-scoped convention.
create table public.rec_user_availability_day_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  marked_at timestamptz not null default now()
);
create unique index rec_user_availability_day_marks_scoped_uidx
  on public.rec_user_availability_day_marks (user_id, weekday, coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.rec_user_availability_day_marks enable row level security;

-- warning_count >= 3 (2 free warnings already given) means this user's future payouts are held
-- until they set their availability again -- checked by economy-backlog.ts's creditOrBacklog.
-- No separate boolean needed; the count itself is the state, and resets to 0 the moment the user
-- becomes fully compliant again (see availability-compliance.service.ts).
create table public.rec_availability_compliance (
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  warning_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, league_id)
);
alter table public.rec_availability_compliance enable row level security;

-- The post-kickoff check-in system (30m/2h/1h follow-ups + auto-reset-to-Fair-Sim safety net) is
-- retired entirely in favor of a simple proactive Game Started/Game Ended prompt at kickoff --
-- this table has no remaining readers or writers.
drop table if exists public.rec_game_kickoff_checkins;
