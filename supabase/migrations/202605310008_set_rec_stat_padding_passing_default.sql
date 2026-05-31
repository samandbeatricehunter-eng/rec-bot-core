update public.rec_league_configuration
set stat_padding_thresholds = jsonb_set(
  stat_padding_thresholds,
  '{maxPassingYards}',
  '600'::jsonb,
  true
)
where stat_padding_thresholds->>'maxPassingYards' is null
   or (stat_padding_thresholds->>'maxPassingYards')::integer = 500;

alter table public.rec_league_configuration
  alter column stat_padding_thresholds set default '{
    "evaluationMode": "cascading",
    "pointSpread": 35,
    "maxPassingYards": 600,
    "maxRushingYards": 400,
    "yardageTrigger": "either",
    "notes": "REC default: flag for commissioner review when point spread is 35+ and either passing yards exceed 600 or rushing yards exceed 400."
  }'::jsonb;
