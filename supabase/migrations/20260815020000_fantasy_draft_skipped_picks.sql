-- Tracks a team's turn that a commissioner skipped mid-draft (real Madden fantasy drafts
-- don't always show every other team's pick in-game) — the draft clock still advances
-- normally, but the slot stays open to fill in later (mid-draft once it's known, or during
-- wrap-up) instead of forcing an immediate guess or blocking the draft's progress.
create table if not exists public.rec_fantasy_draft_skipped_picks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  round integer not null,
  pick_in_round integer not null,
  overall_pick_number integer not null,
  skipped_by_user_id uuid references public.rec_users(id) on delete set null,
  resolved_at timestamptz,
  resolved_pick_id uuid references public.rec_fantasy_draft_picks(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.rec_fantasy_draft_skipped_picks enable row level security;
create index if not exists rec_fantasy_draft_skipped_picks_session_idx
  on public.rec_fantasy_draft_skipped_picks(session_id, resolved_at);
