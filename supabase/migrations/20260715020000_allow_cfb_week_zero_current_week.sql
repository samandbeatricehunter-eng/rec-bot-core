alter table public.rec_leagues
  drop constraint if exists rec_leagues_current_week_valid;

alter table public.rec_leagues
  add constraint rec_leagues_current_week_valid
    check (current_week is null or (current_week >= 0 and current_week <= 30));
