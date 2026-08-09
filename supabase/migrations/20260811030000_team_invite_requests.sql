-- A linked member requesting the commissioner send them a Discord/game invite (they submit
-- their PSN/Gamertag so the commissioner knows who to invite in-game). Routed through the same
-- rec_commissioners_inbox pending-action pattern as every other commissioner review queue.
create table public.rec_team_invite_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  guild_id text not null,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  discord_id text not null,
  tag text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cannot_send', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_discord_id text
);
alter table public.rec_team_invite_requests enable row level security;

create unique index rec_team_invite_requests_one_pending_per_user_idx
  on public.rec_team_invite_requests (league_id, user_id) where status = 'pending';

create index rec_team_invite_requests_league_idx
  on public.rec_team_invite_requests (league_id, status);
