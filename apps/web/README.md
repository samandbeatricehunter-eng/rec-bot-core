# @rec/web — Web Dashboard

The web frontend for REC Bot's League Mgmt workflows. Opened as a normal external browser
tab (not a Discord-embedded iframe): a commissioner or co-commissioner clicks "Open Web
Dashboard" in Discord's League Mgmt panel, the bot mints a short-lived signed session
token and hands back a link, and that link opens this app with the token in the URL.
Coexists with the existing Discord-native League Mgmt workflow; it does not replace it.

## Local development

No special setup needed — this is a plain SPA. Run `pnpm --filter @rec/web dev`
(defaults to `http://localhost:5173`) and open it directly with a `?token=...` from a
real mint (or a manually-crafted test JWT signed with the same `ACTIVITY_JWT_SECRET`
apps/api uses).

## Build & deploy

Same conventions as `apps/api`/`apps/bot`: `dev` / `build` / `start` / `typecheck` scripts,
deployed as a third Railway service pointing at the repo root with Start Command
`node apps/web/server/serve.js`. See the root `nixpacks.toml` comment for how the three
services share one build (`pnpm -r build`) but differ only by Start Command.
