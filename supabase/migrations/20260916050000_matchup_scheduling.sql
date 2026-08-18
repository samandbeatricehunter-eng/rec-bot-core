-- REC Game Scheduling System, Phase 2/3: per-matchup scheduling state, time proposals,
-- immutable event history, kickoff check-ins, and reminder de-dupe tracking. One row per
-- rec_games.id in rec_game_scheduling — created lazily the first time either surface (site or
-- Discord) touches a game's scheduling.

create table if not exists public.rec_game_scheduling (
  game_id uuid primary key references public.rec_games(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  status text not null default 'not_scheduled' check (status in (
    'not_scheduled', 'proposed', 'confirmed', 'reschedule_requested',
    'no_shared_availability', 'needs_commissioner_help', 'completed'
  )),
  response_started_at timestamptz,
  home_responded_at timestamptz,
  away_responded_at timestamptz,
  scheduled_for timestamptz,
  confirmed_at timestamptz,
  proposed_by_user_id uuid references public.rec_users(id),
  accepted_by_user_id uuid references public.rec_users(id),
  reschedule_requested_at timestamptz,
  stream_started_at timestamptz,
  -- Set true the moment either coach clicks the post-kickoff "Request Force Win" checkmark.
  -- FW is a manual-apply label only (see rec_game_scheduling_events for the evidence trail) --
  -- this flag exists purely so Advance Readiness can badge the matchup for the commissioner.
  fw_flagged boolean not null default false,
  fw_flagged_for_user_id uuid references public.rec_users(id),
  fw_flagged_at timestamptz,
  attention_required boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists rec_game_scheduling_league_idx on public.rec_game_scheduling (league_id, status);
alter table public.rec_game_scheduling enable row level security;

create table if not exists public.rec_game_time_proposals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.rec_games(id) on delete cascade,
  proposed_by_user_id uuid not null references public.rec_users(id),
  proposed_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'countered', 'withdrawn')),
  counter_to_id uuid references public.rec_game_time_proposals(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists rec_game_time_proposals_game_idx on public.rec_game_time_proposals (game_id, created_at desc);
alter table public.rec_game_time_proposals enable row level security;

-- rec_game_scheduling_events already exists (id, game_id, user_id, event_type, payload,
-- created_at) from earlier gameday-scheduling scaffolding that predates this migration and has
-- no application code referencing it yet -- exactly the "second generation of scheduling
-- concepts beside an older unused one" to avoid, so this system reuses it as-is for its
-- immutable event log (availability submitted, proposal created/accepted/countered, reminder
-- sent, checked in, FW flagged, commissioner intervention, etc.) instead of creating a parallel
-- table. No DDL needed here.
create index if not exists rec_game_scheduling_events_game_idx on public.rec_game_scheduling_events (game_id, created_at asc);

-- Post-kickoff "I'm ready" checkmark, separate from the (unused/legacy) rec_game_channel_checkins
-- message-activity tracker. One row per user per game.
create table if not exists public.rec_game_kickoff_checkins (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.rec_games(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  checked_in_at timestamptz not null default now(),
  unique (game_id, user_id)
);
alter table public.rec_game_kickoff_checkins enable row level security;

-- De-dupe log so the 60s reminder poller never double-sends a given reminder across restarts.
-- reminder_type examples: availability_nag_4h, contact_4h, contact_8h, contact_escalate_12h,
-- game_30m, game_10m, game_kickoff, game_kickoff_followup_30m, game_reset_2h.
create table if not exists public.rec_scheduling_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.rec_games(id) on delete cascade,
  user_id uuid references public.rec_users(id) on delete cascade,
  reminder_type text not null,
  sent_at timestamptz not null default now()
);
-- Postgres never treats two NULLs as equal for uniqueness, so a plain composite unique
-- constraint wouldn't actually de-dupe the game_id-less "set your availability" nag (which
-- repeats per user every 4h) or a hypothetical user_id-less case. Partial indexes cover both.
create unique index if not exists rec_scheduling_reminders_sent_game_uidx on public.rec_scheduling_reminders_sent (game_id, user_id, reminder_type) where game_id is not null and user_id is not null;
create unique index if not exists rec_scheduling_reminders_sent_user_only_uidx on public.rec_scheduling_reminders_sent (user_id, reminder_type) where game_id is null and user_id is not null;
alter table public.rec_scheduling_reminders_sent enable row level security;
