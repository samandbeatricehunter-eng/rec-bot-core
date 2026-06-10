-- Add 'final_resigning' as a valid season_stage value so the offseason
-- advance flow can transition through: coach_hiring → final_resigning →
-- free_agency → draft → preseason_training_camp → regular_season.

alter table public.rec_leagues
  drop constraint if exists rec_leagues_season_stage_valid;

alter table public.rec_leagues
  add constraint rec_leagues_season_stage_valid
    check (season_stage = any (array[
      'preseason_training_camp',
      'regular_season',
      'wild_card',
      'divisional',
      'conference_championship',
      'super_bowl',
      'offseason',
      'coach_hiring',
      'final_resigning',
      'free_agency',
      'draft'
    ]));
