# REC Bot Core

Clean rebuild for REC League. REC Core API is the source of truth; Discord bot is a thin menu/UI client.

## One Command

```txt
/menu
```

All features branch through select menus, buttons, and modals.

## Install

```bash
pnpm install --network-concurrency 1
pnpm --filter @rec/shared build
pnpm typecheck
```

## Run

```bash
pnpm dev:api
pnpm --filter @rec/bot register
pnpm dev:bot
```

## Railway Deployment

Two separate Railway services, one per app.

### API service

- **Root directory**: `apps/api`
- **Build command**: `cd ../.. && pnpm install --network-concurrency 1 && pnpm --filter @rec/shared build && pnpm --filter @rec/api build`
- **Start command**: `node dist/index.js`

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key (not anon) |
| `NODE_ENV` | yes | `production` |
| `REC_INTERNAL_API_KEY` | recommended | Shared secret between API and bot |
| `API_PORT` | no | Defaults to `3000`; Railway sets `PORT` — set `API_PORT=${{PORT}}` |
| `API_HOST` | no | Defaults to `0.0.0.0` |
| `EA_MCA_CLIENT_SECRET` | yes (EA import) | EA/Blaze client secret |
| `EA_MCA_DEFAULT_CONSOLE` | no | Defaults to `pc` |

### Bot service

- **Root directory**: `apps/bot`
- **Build command**: `cd ../.. && pnpm install --network-concurrency 1 && pnpm --filter @rec/shared build && pnpm --filter @rec/bot build`
- **Start command**: `node dist/index-timeout.js`

| Variable | Required | Notes |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token from Discord developer portal |
| `DISCORD_CLIENT_ID` | yes | Application ID |
| `DISCORD_GUILD_ID` | no | Omit for global commands; set for guild-scoped (faster deploys) |
| `REC_CORE_API_URL` | yes | Internal Railway URL of the API service |
| `REC_INTERNAL_API_KEY` | recommended | Must match the API service value |

### Register slash commands (one-time or on change)

```bash
# Locally
pnpm --filter @rec/bot register

# On Railway (run in bot service shell)
node dist/register-commands.js
```
