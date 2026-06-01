create table if not exists public.rec_ea_accounts (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null,
  console text not null default 'xbsx',
  blaze_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(discord_id, console)
);

create table if not exists public.rec_ea_franchises (
  id uuid primary key default gen_random_uuid(),
  ea_account_id uuid references public.rec_ea_accounts(id) on delete cascade,
  external_league_id text not null,
  league_name text not null,
  console text,
  season_text text,
  season_sort integer,
  calendar_year integer,
  num_members integer,
  user_team_external_id text,
  user_team_name text,
  is_importable boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  last_discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(external_league_id, console)
);

alter table public.rec_ea_franchises add column if not exists last_discovered_at timestamptz not null default now();
alter table public.rec_ea_franchises add column if not exists raw_payload jsonb not null default '{}'::jsonb;
create index if not exists rec_ea_franchises_account_idx on public.rec_ea_franchises(ea_account_id);
