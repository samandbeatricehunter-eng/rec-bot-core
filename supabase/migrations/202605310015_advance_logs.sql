create table if not exists public.rec_advance_logs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  advanced_from_week integer not null,
  advanced_to_week integer not null,
  requested_by_discord_id text not null,
  next_advance_at timestamptz,
  next_advance_timezone text,
  announcement_text text not null,
  checklist jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
