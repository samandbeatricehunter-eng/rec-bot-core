# Frontend Consolidation + League Chassis Plan

`apps/site` is the canonical frontend application. The old `apps/web` tree is legacy hub UI
source consumed through `@rec/hub-ui`; it should be retired by moving league code into
`apps/site/src/features/league/*`.

This migration should also shrink the league hub as it moves. Do not move `HubHome.tsx`
intact into `apps/site`. Each slice should extract one clear route family or primitive, wire it
through the site-owned chassis, then delete or reduce the legacy dependency path.

Target shape:

```text
apps/site/src/
  app/
    routing/
    providers/
    shell/
  features/
    league/
      chassis/
      home/
      gameday/
      team/
      roster/
      trades/
      stats/
      standings/
      history/
      records/
      store/
      wagers/
      rules/
      management/
  components/
    ui/
    design-system/
  lib/
  styles/
```

Migration rules:

1. Keep `packages/shared` separate for domain logic used by API, bot, and frontend.
2. Move site-facing league chrome into `apps/site/src/features/league/chassis`.
3. Move one route family at a time from `apps/web` into `apps/site/src/features/league`.
4. When moving a family, split route rail, data hooks, body component, modals, and UI primitives
   into explicit local modules instead of preserving a large hub component.
5. Replace `@rec/hub-ui` imports in `apps/site` with local feature imports as each slice moves.
6. Move hub CSS into the site style system alongside the migrated feature.
7. Keep route navigation cache-first where practical: render stable chrome immediately, show
   body skeletons only inside the chassis, then revalidate data quietly.
8. After each slice, verify `@rec/site`, `@rec/web`, and `@rec/hub-ui` typechecks until the legacy
   packages are removed.
9. Once no code imports `@rec/hub-ui`, remove the workspace dependency and delete the obsolete
   `packages/hub-ui` boundary.
10. Once no active source or asset path depends on `apps/web`, remove `apps/web` from the
    workspace.

## Chassis phase status (complete)

Site owns the league route shell. `LeagueHub` mounts feature modules; it no longer uses a
multi-section `HubHomeBridge`.

| Family | Rail | Body |
|--------|------|------|
| Home | season snapshot in page | `features/league/home/LeagueHomePage` |
| Game Day | `gameday/GameDayRouteRail` | `gameday/GameDayPage` → site-owned `GameDayHome` (matchups-only) |
| Team | `team/TeamRouteRail` | `TeamHomePage` + roster/store/trades placeholders |
| Stats | `stats/StatsRouteRail` | site re-exports of web page modules |
| Rules | — | site re-export of `RulesHome` |
| Mgmt | `management/MgmtRouteRail` | mgmt pages still via `@rec/hub-ui` providers/pages |

Retired from the product surface:

- League **buzz** / **news** destinations (redirect to `/home`)
- Public **demo league** preview (`/demo` + `/v1/demo-league/*`)

Default league landing is `/l/:leagueId/home`.

## Next (physical move / delete hub-ui)

1. ~~Finish Game Day: move `GameDayHome` into `features/league/gameday`, delete `HubHome.tsx`.~~ Done.
2. Move stats/standings/records/history/rules/mgmt page source files into site features
   (replace deep re-exports).
3. Move hub CSS bundles into `apps/site/src/styles` per feature.
4. Collapse `@rec/hub-ui` to providers-only, then remove the package and `apps/web`.
5. Move remaining Game Day leaf components (`MatchupCard`, wager helpers, empty states) out of
   `apps/web` deep imports into site-local modules.
