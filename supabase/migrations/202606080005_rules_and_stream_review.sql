alter table public.rec_server_routes
  add column if not exists commissioner_role_id text,
  add column if not exists comp_committee_role_id text;

create table if not exists public.rec_rule_sections (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.rec_leagues(id) on delete cascade,
  rule_key text not null,
  title text not null,
  body text not null,
  scope text not null default 'global_locked' check (scope in ('global_locked', 'league_setup_option', 'server_editable')),
  is_editable boolean not null default false,
  source text not null default 'rec_default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, rule_key)
);

create table if not exists public.rec_stream_payout_reviews (
  id uuid primary key default gen_random_uuid(),
  stream_log_id uuid references public.rec_stream_compliance_logs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  team_id uuid references public.rec_teams(id),
  season_number integer not null,
  week_number integer not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'issued')),
  amount integer not null default 5,
  discord_channel_id text,
  discord_message_id text,
  reviewed_by_discord_id text,
  denied_reason text,
  issued_ledger_id uuid references public.rec_dollar_ledger(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  issued_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(stream_log_id)
);
