-- EOS award ballot progress tracking. Per-category votes are already auto-saved directly to
-- rec_eos_award_votes (see castEosAwardVote) — this table only adds the session-level state a
-- one-category-at-a-time ballot flow needs on top of that: resume position, and an explicit
-- submitted milestone distinct from "has a pick on every currently-open category so far".
create table public.rec_eos_ballot_sessions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  voter_user_id uuid not null references public.rec_users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  last_poll_id uuid references public.rec_eos_award_polls(id),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, voter_user_id)
);

alter table public.rec_eos_ballot_sessions enable row level security;

create index rec_eos_ballot_sessions_voter_idx
  on public.rec_eos_ballot_sessions (voter_user_id, league_id, season_number);
