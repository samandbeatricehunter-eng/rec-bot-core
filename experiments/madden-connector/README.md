# Madden Direct Sync connector (experiment)

This package is intentionally **not** part of the production pnpm workspace.

Why it was quarantined:
- There is no `src/index.ts` entrypoint despite package scripts claiming one.
- The token vault still uses in-memory placeholders (`TODO: Implement with Supabase client`).
- No other app imports `@rec/madden-connector`.
- Railway only deploys `site`, `bot`, and `api`.

Do not move this back under `apps/` until Direct Sync has a real entrypoint, durable token storage, and an integrating consumer.

To work on it locally without rejoining the monorepo build/CI surface:
```bash
cd experiments/madden-connector
pnpm install
```
