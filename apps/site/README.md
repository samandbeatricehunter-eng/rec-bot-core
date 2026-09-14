# @rec/site

Canonical frontend application for REC.

This is the Vite app that runs and builds the public website, authenticated app shell, and
league experience. League UI lives under `src/features/league/*` — routing, chassis, top rails,
and route bodies are site-owned. Some page implementations still deep-import legacy source from
`apps/web` through local feature re-exports or `@rec/hub-ui` providers until those files move.

```text
src/
  features/
    league/
      chassis/
      gameday/
      home/
      stats/
      standings/
      records/
      history/
      team/
      roster/
      store/
      trades/
      rules/
      management/
  components/
  lib/
  styles/
```

Do not add new site-facing league chrome to `apps/web` or `packages/hub-ui`; put it in
`src/features/league` instead. See `docs/frontend-consolidation-and-league-chassis-plan.md`.
