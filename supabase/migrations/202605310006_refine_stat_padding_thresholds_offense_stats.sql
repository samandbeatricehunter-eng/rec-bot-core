update public.rec_league_configuration
set stat_padding_thresholds = jsonb_build_object(
  'pointSpread', coalesce((stat_padding_thresholds->>'leadMargin')::integer, 28),
  'maxPassingYards', coalesce((stat_padding_thresholds->>'maxPassingYards')::integer, 350),
  'maxRushingYards', coalesce((stat_padding_thresholds->>'maxRushingYards')::integer, 225),
  'notes', coalesce(stat_padding_thresholds->>'notes', 'Flag for commissioner review when a team wins by more than the point spread threshold and exceeds either offensive yardage cap.')
);

alter table public.rec_league_configuration
  alter column stat_padding_thresholds set default '{
    "pointSpread": 28,
    "maxPassingYards": 350,
    "maxRushingYards": 225,
    "notes": "Flag for commissioner review when a team wins by more than the point spread threshold and exceeds either offensive yardage cap."
  }'::jsonb;

comment on column public.rec_league_configuration.stat_padding_thresholds is 'Per-league stat padding thresholds based on point spread plus team passing and rushing yard caps.';
