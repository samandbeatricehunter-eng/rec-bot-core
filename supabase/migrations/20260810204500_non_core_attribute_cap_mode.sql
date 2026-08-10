alter table public.rec_league_configuration
  add column if not exists non_core_attribute_cap_mode text not null default 'group';

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_non_core_attribute_cap_mode_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_non_core_attribute_cap_mode_check
  check (non_core_attribute_cap_mode in ('group', 'individual'));

comment on column public.rec_league_configuration.non_core_attribute_cap_mode is
  'Mutually exclusive Non-Core purchase-cap strategy: one pooled group cap or per-attribute individual caps.';
