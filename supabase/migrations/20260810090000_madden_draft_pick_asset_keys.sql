-- A future draft can contain supplemental/compensatory assets in the same round for the
-- same original club. Give each asset a stable identity rather than silently dropping it.
alter table public.rec_draft_picks add column if not exists asset_key text;

update public.rec_draft_picks
set asset_key = original_team_id::text || ':r' || round::text
where asset_key is null;

alter table public.rec_draft_picks alter column asset_key set not null;
alter table public.rec_draft_picks drop constraint if exists rec_draft_picks_league_id_season_number_round_original_team_id_key;
alter table public.rec_draft_picks drop constraint if exists rec_draft_picks_league_id_season_number_round_original_team_key;
alter table public.rec_draft_picks add constraint rec_draft_picks_league_season_asset_key_key unique (league_id, season_number, asset_key);
alter table public.rec_draft_picks drop constraint if exists rec_draft_picks_source_check;
alter table public.rec_draft_picks add constraint rec_draft_picks_source_check
  check (source = 'manual' or source = 'generated' or source like 'baseline:%');
create index if not exists rec_draft_picks_original_round_idx
  on public.rec_draft_picks (league_id, season_number, original_team_id, round);
