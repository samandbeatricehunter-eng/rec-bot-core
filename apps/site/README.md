# @rec/site

Canonical frontend application for REC.

This is the Vite app that runs and builds the public website, authenticated app shell, and
league experience. League UI lives under `src/features/league/*` — routing, chassis, top rails,
and route bodies are site-owned.

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

Add new site-facing league chrome to `src/features/league`. See `docs/frontend-consolidation-and-league-chassis-plan.md`.
