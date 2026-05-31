alter table public.rec_league_configuration
  add column if not exists stat_padding_thresholds jsonb not null default '{
    "leadMargin": 28,
    "startsInQuarter": 4,
    "clockMinutesRemaining": 6,
    "maxPassAttemptsAfterThreshold": 3,
    "maxDeepPassesAfterThreshold": 0,
    "maxNoHuddleAfterThreshold": 0,
    "maxFourthDownAttemptsAfterThreshold": 0,
    "allowBackups": true,
    "allowChewClock": true,
    "notes": "Commissioners may review games where a user continues aggressive stat-focused play after the threshold is reached."
  }'::jsonb;

comment on column public.rec_league_configuration.stat_padding_thresholds is 'Per-league stat padding thresholds, including lead margin, quarter/time trigger, and allowed play limits after threshold.';
