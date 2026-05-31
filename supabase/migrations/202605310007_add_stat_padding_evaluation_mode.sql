update public.rec_league_configuration
set stat_padding_thresholds = jsonb_build_object(
  'evaluationMode', coalesce(stat_padding_thresholds->>'evaluationMode', 'cascading'),
  'pointSpread', case
    when coalesce((stat_padding_thresholds->>'pointSpread')::integer, 28) <= 21 then 21
    when coalesce((stat_padding_thresholds->>'pointSpread')::integer, 28) <= 28 then 28
    when coalesce((stat_padding_thresholds->>'pointSpread')::integer, 28) <= 35 then 35
    when coalesce((stat_padding_thresholds->>'pointSpread')::integer, 28) <= 42 then 42
    else 49
  end,
  'maxPassingYards', case
    when coalesce((stat_padding_thresholds->>'maxPassingYards')::integer, 500) <= 450 then 450
    when coalesce((stat_padding_thresholds->>'maxPassingYards')::integer, 500) <= 500 then 500
    when coalesce((stat_padding_thresholds->>'maxPassingYards')::integer, 500) <= 550 then 550
    when coalesce((stat_padding_thresholds->>'maxPassingYards')::integer, 500) <= 600 then 600
    when coalesce((stat_padding_thresholds->>'maxPassingYards')::integer, 500) <= 650 then 650
    else 700
  end,
  'maxRushingYards', case
    when coalesce((stat_padding_thresholds->>'maxRushingYards')::integer, 400) <= 350 then 350
    when coalesce((stat_padding_thresholds->>'maxRushingYards')::integer, 400) <= 400 then 400
    when coalesce((stat_padding_thresholds->>'maxRushingYards')::integer, 400) <= 450 then 450
    else 500
  end,
  'yardageTrigger', coalesce(stat_padding_thresholds->>'yardageTrigger', 'either'),
  'notes', 'Separate mode flags any selected threshold independently. Cascading mode requires the point spread threshold plus passing and/or rushing threshold.'
);

alter table public.rec_league_configuration
  alter column stat_padding_thresholds set default '{
    "evaluationMode": "cascading",
    "pointSpread": 28,
    "maxPassingYards": 500,
    "maxRushingYards": 400,
    "yardageTrigger": "either",
    "notes": "Separate mode flags any selected threshold independently. Cascading mode requires the point spread threshold plus passing and/or rushing threshold."
  }'::jsonb;

comment on column public.rec_league_configuration.stat_padding_thresholds is 'Stat padding thresholds. evaluationMode: separate or cascading. Point spread options: 21,28,35,42,49. Passing options: 450,500,550,600,650,700. Rushing options: 350,400,450,500. yardageTrigger: passing, rushing, either, or both.';
