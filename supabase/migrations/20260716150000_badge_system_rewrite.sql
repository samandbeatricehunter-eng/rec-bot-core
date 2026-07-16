-- Badge system rewrite (2026-07-16): removes streak tracking in favor of plain
-- season occurrence counts, adds positive/negative polarity, and drops the
-- season->career-trophy conversion pipeline (career-scope badges are now always
-- computed continuously from all-time stored games — see
-- box-score-intelligence/persistence.ts — so nothing needs converting at season end).
--
-- rec_badge_ownership.badge_scope values change from weekly/season/global to
-- game/season/career, and the badge catalog itself changed substantially (removed,
-- renamed, and re-thresholded badges), so a data-level rename would leave stale
-- rows referencing badge keys that no longer exist. Wiping both tables is safe —
-- they're fully re-derived from rec_team_game_stats on the next badge recompute
-- (import-time, or the whole-league batch recompute already used on advance).
truncate table public.rec_badge_ownership;
truncate table public.rec_badge_events;

alter table public.rec_badge_ownership
  add column if not exists polarity text not null default 'positive',
  drop column if exists current_streak,
  drop column if exists best_streak,
  drop column if exists active;

drop table if exists public.rec_user_season_badge_trophies;
