# REC Bot Core

REC Bot Core is the clean rebuild for REC League Discord/backend connectivity.

## Architecture

REC Core is the source of truth.

```txt
apps/api  = REC Core API
apps/bot  = REC Discord Bot client
packages/shared = shared types, validation, constants
supabase/migrations = REC Core database migrations
docs = planning and operating notes
```

The Discord bot should remain a thin client. It should handle Discord interactions, call the API, and render responses. Business logic belongs in the API/services layer.

## Current Status

- REC Core database schema has been installed in Supabase.
- Approved legacy user baselines have been imported.
- This repository starts the fresh codebase that will connect the API and bot to that database.

## First Build Goals

1. API health check
2. Bot login and `/menu`
3. Bot-to-API connection test
4. Server setup flow
5. League creation/linking flow
6. Manual user/team linking flow
7. Import run logging shell

## Development

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env` and fill in the required values before running.
