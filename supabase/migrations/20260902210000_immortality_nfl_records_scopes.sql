-- Adds single-game and single-season record boards alongside the existing career one --
-- existing rows default to 'career' so nothing already seeded/posted needs to change.
alter table public.rec_immortality_nfl_records
  add column if not exists scope text not null default 'career' check (scope in ('game', 'season', 'career'));

alter table public.rec_immortality_nfl_records
  drop constraint if exists rec_immortality_nfl_records_immortality_league_id_category__key;

alter table public.rec_immortality_nfl_records
  add constraint rec_immortality_nfl_records_league_category_scope_rank_key unique (immortality_league_id, category, scope, rank);
