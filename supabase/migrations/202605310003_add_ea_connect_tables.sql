create table if not exists public.rec_ea_accounts (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null,
  ea_persona_id text,
  ea_display_name text,
  connection_status text not null default 'pending',
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  raw_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(discord_id)
);

create table if not exists public.rec_ea_franchises (
  id uuid primary key default gen_random_uuid(),
  ea_account_id uuid not null references public.rec_ea_accounts(id) on delete cascade,
  external_league_id text not null,
  external_league_name text not null,
  season_number integer,
  season_stage text,
  current_week integer,
  platform text,
  raw_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(ea_account_id, external_league_id)
);

create index if not exists rec_ea_accounts_discord_id_idx on public.rec_ea_accounts(discord_id);
create index if not exists rec_ea_franchises_account_idx on public.rec_ea_franchises(ea_account_id);
