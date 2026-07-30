-- Attribute purchase caps become fully symmetric between Core and Non-Core: each group can
-- have BOTH a pooled group-wide total AND per-attribute individual overrides, enforced
-- together (not either/or). Previously only Core had per-attribute overrides (plus a default)
-- and only Non-Core had a group total — this fills in the missing halves.
alter table public.rec_league_configuration
  add column if not exists core_attribute_group_cap integer not null default 0,
  add column if not exists non_core_attribute_cap_overrides jsonb not null default '{}'::jsonb;

-- The existing 0-20 check constraints predate the Zod schema's already-declared 0-99 range
-- (setup.schemas.ts), so a commissioner-entered value between 21 and 99 would pass client
-- validation and then fail at the database with a constraint violation. Widen to match.
alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_core_attribute_purchases_season_cap_check,
  drop constraint if exists rec_league_configuration_non_core_attribute_purchases_season_cap_check,
  drop constraint if exists rec_league_configuration_core_attribute_group_cap_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_core_attribute_purchases_season_cap_check
    check (core_attribute_purchases_season_cap between 0 and 99),
  add constraint rec_league_configuration_non_core_attribute_purchases_season_cap_check
    check (non_core_attribute_purchases_season_cap between 0 and 99),
  add constraint rec_league_configuration_core_attribute_group_cap_check
    check (core_attribute_group_cap between 0 and 99);

comment on column public.rec_league_configuration.core_attribute_group_cap is
  'Season-long pooled cap across ALL Core attribute points combined (0 = unlimited). Enforced in addition to, not instead of, each attribute''s own cap (core_attribute_purchases_season_cap default or its override).';
comment on column public.rec_league_configuration.non_core_attribute_purchases_season_cap is
  'Season-long pooled cap across ALL Non-Core attribute points combined (0 = unlimited). Enforced alongside non_core_attribute_cap_overrides, not instead of it.';
comment on column public.rec_league_configuration.non_core_attribute_cap_overrides is
  'Per-attribute season cap overrides within the Non-Core group (0 = unlimited for that attribute). Non-Core attributes without an entry here have no individual cap, only the pooled group total.';
