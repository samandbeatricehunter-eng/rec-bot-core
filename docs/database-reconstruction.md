# Database Reconstruction

The repo should be able to recreate a development database from the checked-in
Supabase migrations. If a schema change is applied remotely, add the matching
SQL migration under `supabase/migrations/` before relying on it from the API or
bot.

## Rebuild Order

1. Apply the Supabase migrations from `supabase/migrations/` in filename order.
2. Rebuild shared package exports:

   ```bash
   pnpm --filter @rec/shared build
   ```

3. Typecheck the API and bot against the rebuilt shared package:

   ```bash
   pnpm --filter @rec/api typecheck
   pnpm --filter @rec/bot typecheck
   ```

## Fresh-Replay Guardrails

- Public tables created by migrations must include `alter table ... enable row
  level security`.
- Migrations that repair or supersede earlier table definitions should be
  idempotent. Avoid later `create table` statements without `if not exists`
  when an earlier migration may already have created that table.
- When a column name changes, add a forward repair migration that handles both
  possible states: only the old column exists, or both old and new columns
  exist.

## Active Check Schema Note

The active-check schema previously drifted between `active_check_id` and
`event_id`. The current canonical shape is:

- `rec_active_check_responses.event_id`
- `rec_active_check_misses.event_id`
- unique response key: `(event_id, user_id)`
- at most one open active check per league

The repair migration `202606160001_repair_active_check_schema.sql` normalizes
older databases and protects fresh rebuilds from duplicate open active checks.
