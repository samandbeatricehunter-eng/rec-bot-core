# Custom-player config source of truth

## What is authoritative

1. **Shared package algorithms/rules** - `packages/shared/src/player-builder/` (`catalog.ts`, `build-validator.ts` / `REC_PACKAGE_RULES`, archetypes, OVR model, name corpus). Catalog default coin prices are `[500, 750, 1000, 1500, 2000]`.
2. **Global economy JSON** - live coin prices for the five tiers (overrides catalog defaults at runtime via `configuredPackages` in the API).
3. **Submitted builds** - store configuration version snapshots (`package_configuration_version`, `cost_configuration_version`, etc.) so historical purchases stay interpretable after shared catalog changes.

## What is not used at runtime

- **`rec_custom_player_packages`** - legacy table from the original custom-player migration. No API/bot path reads it; shared catalog + economy overrides are the only package source.

## League toggles (orthogonal)

League-level enablement and season caps live in `rec_league_configuration` (`custom_players_enabled`, `custom_players_season_cap`, purchase deadlines). Those gate purchases; they do not define package tiers or CP budgets.
