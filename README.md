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
