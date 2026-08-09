-- A non-commissioner drafting a player submits a request instead of logging the pick directly;
-- the commissioner approves (logs it for real) or denies it. Only meaningful while a request is
-- pending, so old rows are cheap to keep around for history — no cleanup job needed.
create table public.rec_fantasy_draft_pick_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id),
  player_id uuid not null references public.rec_players(id),
  requested_by_user_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid
);
alter table public.rec_fantasy_draft_pick_requests enable row level security;

-- At most one live request per team at a time (they can't queue a second while one's pending).
create unique index rec_fantasy_draft_pick_requests_one_pending_per_team_idx
  on public.rec_fantasy_draft_pick_requests(session_id, team_id) where status = 'pending';

create index rec_fantasy_draft_pick_requests_session_idx
  on public.rec_fantasy_draft_pick_requests(session_id, status);
