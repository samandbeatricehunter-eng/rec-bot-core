-- CFB postseason/offseason structure correction (see packages/shared/src/league-stage.ts):
-- drops the unconfirmed "cfp_bye_week" stage (CFP is 4 straight bowl weeks, no scheduled bye
-- between semifinals and the championship), and replaces CFB's borrowed Madden franchise-mode
-- offseason names with real dynasty-mode stages: players_leaving, transfer_portal, signing_day,
-- training_results.

alter table public.rec_leagues
  drop constraint if exists rec_leagues_season_stage_valid;

alter table public.rec_leagues
  add constraint rec_leagues_season_stage_valid
    check (season_stage = any (array[
      'preseason_training_camp',
      'preseason',
      'regular_season',
      'wild_card',
      'divisional',
      'conference_championship',
      'super_bowl',
      'cfp_first_round',
      'cfp_quarterfinals',
      'cfp_semifinals',
      'national_championship',
      'offseason',
      'coach_hiring',
      'final_resigning',
      'free_agency',
      'draft',
      'players_leaving',
      'transfer_portal',
      'signing_day',
      'training_results'
    ]));
