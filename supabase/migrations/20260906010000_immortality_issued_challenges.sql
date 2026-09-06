-- Rise to Immortality Pass 3 (Structured Challenges): freezes which challenge was actually
-- issued to a prospect for a given scope/period, so a later catalog edit (a rebalance, a bug
-- fix, a TFL-style removal) never reshuffles an already-graded week/season/career out from
-- under XP that was already credited. See player-identity.service.ts's regradeProspectHistory
-- (Pass 2) for why this matters -- without it, re-grading a past week after the catalog changes
-- would silently grade it against a *different* challenge than the one it was actually graded
-- against the first time.
create table if not exists public.rec_immortality_issued_challenges (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  scope text not null check (scope in ('weekly', 'season', 'career')),
  -- Sentinel 0 (never null) for the scope's unused period column, so a single plain unique
  -- index works with no partial-index/NULL-uniqueness trap (multiple NULLs are never equal to
  -- each other under a standard unique constraint, which already bit this codebase once for
  -- rec_commissioners_inbox -- see submitProspectForReview's doc comment in
  -- immortality.service.ts): weekly -> real season_number + real week_number; season -> real
  -- season_number, week_number=0; career -> season_number=0, week_number=0.
  season_number int not null default 0,
  week_number int not null default 0,
  tier text not null,
  label text not null,
  condition jsonb not null,
  created_at timestamptz not null default now(),
  unique (prospect_id, scope, tier, season_number, week_number)
);

alter table public.rec_immortality_issued_challenges enable row level security;

create index if not exists rec_immortality_issued_challenges_prospect_idx
  on public.rec_immortality_issued_challenges (prospect_id);
