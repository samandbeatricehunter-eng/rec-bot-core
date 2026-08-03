-- Adds two CFB dynasty-offseason stages either side of the existing pipeline (see
-- packages/shared/src/league-stage.ts for the full sequence): end_of_season_recap (right
-- after national_championship, now the true "first offseason stage" boundary for EOS
-- payouts/awards automation) and offseason_phase (Encourage Transfers & Edit Conferences,
-- right before preseason). transfer_portal itself is unchanged here — it now loops for 4
-- advances via current_week as a counter instead of always being a single advance, which
-- needs no new season_stage value, just a wider CHECK-constraint-unrelated code change.

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
      'training_results',
      'end_of_season_recap',
      'offseason_phase'
    ]));

-- Lets generateAdvanceDms (advance-dm.service.ts) gate "EOS team-stat progress" content by
-- the actual destination stage instead of guessing from the week number alone — needed now
-- that transfer_portal's week counter (1-4) overlaps with real regular-season week numbers,
-- which the old `toWeek >= 2` heuristic could no longer disambiguate.
alter table public.rec_advance_dm_runs
  add column if not exists from_stage text,
  add column if not exists to_stage text;
