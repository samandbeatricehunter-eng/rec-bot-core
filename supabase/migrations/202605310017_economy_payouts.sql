create table if not exists public.rec_economy_payouts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  advance_log_id uuid references public.rec_advance_logs(id) on delete set null,
  week_number integer not null,
  discord_id text not null,
  amount integer not null,
  reason text not null,
  source text not null default 'advance_week',
  created_at timestamptz not null default now()
);

create index if not exists rec_economy_payouts_week_idx
  on public.rec_economy_payouts(league_id, week_number);
