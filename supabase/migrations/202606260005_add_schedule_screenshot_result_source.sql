-- The weekly-scores schedule-screenshot pre-log writes rec_game_results with a
-- distinct source so the advance can treat those games as already resolved
-- (RESOLVED_RESULT_SOURCES in advance-results.service.ts). Add the enum value.
alter type public.rec_import_mode add value if not exists 'schedule_screenshot';
