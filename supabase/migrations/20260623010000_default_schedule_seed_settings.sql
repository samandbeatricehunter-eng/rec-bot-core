alter table public.rec_league_configuration
  add column if not exists default_schedule_seed_requested boolean not null default false,
  add column if not exists default_schedule_seeded_at timestamptz;

comment on column public.rec_league_configuration.default_schedule_seed_requested is
  'Commissioner confirmed franchise Year 1 during setup; allows pre-seeding the default NFL regular-season schedule.';
comment on column public.rec_league_configuration.default_schedule_seeded_at is
  'When the default NFL regular-season schedule was last seeded for this league.';

alter table public.rec_league_configuration enable row level security;
