# Madden 27 EA Export Notes

Findings from the M26 → M27 EA/companion data export comparison. These are the differences REC's
data-import pipeline needs to account for when ingesting M27 exports.

## Schema / field changes

- **New field (M27 only):** `signatureSlotList[].signatureAbility.mentalAbilityGroup`. Not present
  in M26 — most player attributes are otherwise identical between the two games.
- **`extra` section:** minor shape changes between M26 and M27. Nothing structural — verify the
  exact keys when normalizing; no confirmed field renames beyond the ones below.

## Position codes (renamed in M27)

- **M26 writes `LEDGE` / `REDGE`** (left/right defensive edge).
- **M27 writes `LEDG` / `REDG`.**
- REC already normalizes both spellings to the display labels (`LEDG`→`LEDGE`, `REDG`→`REDGE`) in
  `packages/shared/src/roster.ts` (`normalizeCfbPosition`) and maps them in
  `packages/shared/src/player-builder/ovr-model.ts` and `catalog.ts`, so no code change was needed.

## EA client / companion-app connection (snallabot reference)

snallabot's EA companion client (snallabot/snallabot-service PR #150, commit `3687f0c`) updated the
Blaze session calls for M27:

- `componentName: "careermode"` → `"franchisemode"` (3 call sites in `ea_client.ts`).
- `YEAR: "2026"` → `"2027"` in `ea_constants.ts`.

REC's own side is a single-URL receiver (`/v1/import/madden/companion/:connectionToken`) that splits
an export bundle by envelope key into `league_metadata/teams/standings/schedule/rosters/
player_stats/team_stats` (`apps/api/src/modules/madden-companion/`). If the upstream exporter now
emits the export under a renamed envelope/key (e.g. the `CareerMode_teamExport` → `FranchiseMode_
teamExport` rename), `madden-companion.adapters.ts` alias lists may need the new key name added.
