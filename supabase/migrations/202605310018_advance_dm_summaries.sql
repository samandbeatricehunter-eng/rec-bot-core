create table if not exists public.rec_advance_dm_summaries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  advance_log_id uuid references public.rec_advance_logs(id) on delete cascade,
  discord_id text not null,
  week_number integer not null,
  earned_total integer not null default 0,
  spent_total integer not null default 0,
  net_total integer not null default 0,
  breakdown jsonb not null default '[]'::jsonb,
  dm_status text not null default 'pending',
  dm_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists rec_advance_dm_summaries_user_idx
  on public.rec_advance_dm_summaries(league_id, discord_id, created_at);
