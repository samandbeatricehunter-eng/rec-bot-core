-- Fantasy draft check-ins (draft presence). Users check in before/during the draft so
-- commissioners can see who is present (by team name) and skip anyone who never checked in.
-- One row per team per draft session; the row exists (checked_in false) as soon as a
-- check-in/out happens and persists for the rest of the session.
create table public.rec_fantasy_draft_checkins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  user_id uuid references public.rec_users(id) on delete set null,
  discord_id text,
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now(),
  unique (session_id, team_id)
);
alter table public.rec_fantasy_draft_checkins enable row level security;
create index rec_fantasy_draft_checkins_session_idx on public.rec_fantasy_draft_checkins(session_id);

-- Where the live check-in embed lives in Discord, so both the bot (button clicks) and the
-- API (commissioner overrides from the site) can refresh the exact same message.
alter table public.rec_fantasy_draft_sessions add column if not exists checkin_message_channel_id text;
alter table public.rec_fantasy_draft_sessions add column if not exists checkin_message_id text;
