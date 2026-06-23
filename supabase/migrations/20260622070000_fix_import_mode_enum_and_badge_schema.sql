-- 1. Add box-score and advance sources to rec_import_mode so rec_game_results.source
--    can hold these values without PostgREST cast errors.
do $$ begin
  alter type public.rec_import_mode add value if not exists 'box_score';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_import_mode add value if not exists 'box_score_screenshot';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_import_mode add value if not exists 'commissioner_advance';
exception when duplicate_object then null;
end $$;

-- 2. Add tier column to rec_user_badges (the API selects it; column was never created).
alter table public.rec_user_badges
  add column if not exists tier text;
