create table if not exists public.rec_roster_edit_proposals (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  player_id uuid not null references public.rec_players(id) on delete cascade,
  proposed_by_user_id uuid not null references public.rec_users(id),
  proposed_changes jsonb not null,
  status text not null default 'pending_review',
  commissioner_note text,
  reviewed_by_user_id uuid references public.rec_users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_roster_edit_proposals
  add constraint rec_roster_edit_proposals_status_check
  check (status = any (array['pending_review', 'approved', 'rejected']));

alter table public.rec_roster_edit_proposals enable row level security;

create index if not exists rec_roster_edit_proposals_league_status_idx
  on public.rec_roster_edit_proposals (league_id, status);
