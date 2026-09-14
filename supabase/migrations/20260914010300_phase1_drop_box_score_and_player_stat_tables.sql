-- Phase 1 cleanup: legacy league box-score submission infrastructure, its OCR label-alias
-- cache, the (always-empty, unwritten) box-score career-stats materialization, and the manual
-- player-stat/watched-player tagging system are all removed. Every application caller was
-- decoupled first (hub.service.ts, team-schedule.service.ts, team-schedule-transaction.service.ts,
-- advance-results.service.ts, manual-scores.service.ts, game-intelligence/persistence.ts) and the
-- watched-players API module was deleted. No external FKs reference any of these tables
-- (verified via information_schema.table_constraints before this migration).
drop table if exists public.rec_player_stat_audit cascade;
drop table if exists public.rec_player_stat_lines cascade;
drop table if exists public.rec_player_stat_submissions cascade;
drop table if exists public.rec_game_performance_tags cascade;
drop table if exists public.rec_watched_players cascade;
drop table if exists public.rec_box_score_submissions cascade;
drop table if exists public.rec_user_box_score_profile_stats cascade;
drop table if exists public.rec_ocr_label_aliases cascade;
