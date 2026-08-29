-- Allow one independent initial fantasy draft and one annual rookie-draft tracker per league.
-- Existing rows remain fantasy sessions. Annual pick order is resolved from rec_draft_picks,
-- so it does not duplicate the league's traded-pick ownership ledger.
alter table public.rec_fantasy_draft_sessions
  add column if not exists draft_kind text not null default 'fantasy'
    check (draft_kind in ('fantasy', 'annual')),
  add column if not exists season_number integer;

drop index if exists public.rec_fantasy_draft_sessions_one_active_idx;
create unique index rec_fantasy_draft_sessions_one_active_idx
  on public.rec_fantasy_draft_sessions (league_id, draft_kind)
  where status <> 'concluded';

create index if not exists rec_fantasy_draft_sessions_annual_season_idx
  on public.rec_fantasy_draft_sessions (league_id, season_number)
  where draft_kind = 'annual';
