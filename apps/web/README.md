# @rec/web — Discord Activity

The web frontend for REC Bot, meant to run as a Discord Activity (an embedded web app
loaded in an iframe inside Discord via the Embedded App SDK). Coexists with the existing
Discord-native bot flows; it does not replace them.

## Local development

Discord Activities require HTTPS + iframe embedding even in local dev — plain
`localhost` won't load inside Discord. To develop against the real Discord client:

1. Run the dev server: `pnpm --filter @rec/web dev` (defaults to `http://localhost:5173`).
2. Start an HTTPS tunnel to it (e.g. `cloudflared tunnel --url http://localhost:5173` or
   `ngrok http 5173`).
3. In the Discord Developer Portal, set this Activity's URL Mapping root to the tunnel's
   URL for local testing, then open the Activity from within Discord.

This is the one real departure from `apps/api`/`apps/bot`'s plain `localhost` dev loop.

## Build & deploy

Same conventions as `apps/api`/`apps/bot`: `dev` / `build` / `start` / `typecheck` scripts,
deployed as a third Railway service pointing at the repo root with Start Command
`node apps/web/server/serve.js`. See the root `nixpacks.toml` comment for how the three
services share one build (`pnpm -r build`) but differ only by Start Command.
