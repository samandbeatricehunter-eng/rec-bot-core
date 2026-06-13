# REC Bot Core

pnpm monorepo: `apps/api` (Fastify, port 3000), `apps/bot` (discord.js), `packages/shared`.

- After pulling, rebuild shared before typechecking: `pnpm --filter @rec/shared build` (`@rec/shared` resolves to `dist/`; a stale build causes phantom TS2305 missing-export errors).
- The API talks to Supabase exclusively through the service role key (`apps/api/src/lib/supabase.ts`). There is no anon-key client.

## Database migrations

- **Every `create table` in `public` must include `alter table ... enable row level security`.** All existing tables have RLS enabled (2026-06-09), and a database event trigger (`trg_enforce_rls_on_new_tables`) auto-enables it on new public tables as a backstop — but write it in the migration anyway so the SQL is self-documenting and portable.
- RLS has no policies defined: the service role bypasses it, and direct anon-key access is intentionally blocked. Any future anon-key client needs per-table policies.
- Migrations are applied to the remote project via the Supabase MCP; keep a matching `.sql` file in `supabase/migrations/` (local file names don't always match remote migration names).
