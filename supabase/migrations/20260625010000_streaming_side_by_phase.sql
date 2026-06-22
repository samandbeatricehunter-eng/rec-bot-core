alter table public.rec_league_configuration
  add column if not exists regular_season_streaming_side rec_streaming_side,
  add column if not exists postseason_streaming_side rec_streaming_side;

update public.rec_league_configuration
set
  regular_season_streaming_side = coalesce(regular_season_streaming_side, streaming_side, 'either'::rec_streaming_side),
  postseason_streaming_side = coalesce(postseason_streaming_side, streaming_side, 'either'::rec_streaming_side)
where regular_season_streaming_side is null
   or postseason_streaming_side is null;

comment on column public.rec_league_configuration.regular_season_streaming_side is
  'Who must stream during the regular season when streaming is required or recommended (home, away, either, both).';
comment on column public.rec_league_configuration.postseason_streaming_side is
  'Who must stream during the postseason when streaming is required or recommended (home, away, either, both).';
