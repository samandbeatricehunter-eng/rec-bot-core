-- The season_stage check constraint was never updated when CFB support (and later CFB's
-- Week 0 / CFP postseason renumbering) was added — it only allowed Madden's stage names.
-- Any CFB league reaching the postseason, or even just starting at "preseason", would fail
-- this constraint. Add CFB's stages: preseason, cfp_first_round, cfp_quarterfinals,
-- cfp_semifinals, cfp_bye_week, national_championship.

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
      'cfp_bye_week',
      'national_championship',
      'offseason',
      'coach_hiring',
      'final_resigning',
      'free_agency',
      'draft'
    ]));
