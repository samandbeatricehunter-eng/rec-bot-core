-- Retire Coin-based per-league attribute-purchase season caps.
--
-- The upcoming ordinary non-RTI Player XP system (Master Handoff Plan Phase 3/6) makes XP
-- scarcity itself the pacing limit on attribute upgrades, so the old Coin-purchase season caps
-- (core/non-core per-attribute caps, per-attribute overrides, group pools, and the commissioner
-- "Reset Spend Cap" tool that reset them) are no longer needed. This does not touch attribute
-- purchases themselves, their Coin pricing, or the core/non-core price-tier classification
-- (rec_league_configuration.core_attributes stays) -- only the season-cap enforcement/config is
-- removed. Application code (purchases.service.ts, purchases.routes.ts, AttributePurchaseBuilder.tsx,
-- ResetSpendCapModal.tsx) was updated in the same change to stop reading/writing these.
--
-- rec_attribute_cap_resets (68 rows as of this migration) was pure bookkeeping for the
-- now-removed "Reset Spend Cap" commissioner tool and the offseason auto-reset -- safe to drop
-- outright, nothing else reads it.
drop table if exists public.rec_attribute_cap_resets;

alter table public.rec_league_configuration
  drop column if exists core_attribute_purchases_season_cap,
  drop column if exists core_attribute_cap_overrides,
  drop column if exists core_attribute_group_cap,
  drop column if exists non_core_attribute_purchases_season_cap,
  drop column if exists non_core_attribute_cap_overrides,
  drop column if exists non_core_attribute_cap_mode;
