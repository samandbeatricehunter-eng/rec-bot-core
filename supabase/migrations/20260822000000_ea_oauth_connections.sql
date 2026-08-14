-- REC's own EA (Madden) import connection, an alternative to the Companion App.
--
-- Tokens are sealed with AES-256-GCM in the API before they reach this table (see
-- apps/api/src/modules/madden-ea/ea-token-vault.ts); this table never holds plaintext EA
-- credentials. The Blaze session is cached because establishing one costs an extra round trip
-- and EA rate limits logins.

create table if not exists public.rec_ea_connections (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  -- EA persona that authorized the connection.
  blaze_persona_id text not null,
  persona_display_name text,
  ea_namespace text,
  console text not null,
  -- Sealed EA token pair (AES-256-GCM).
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  token_expires_at timestamptz not null,
  -- Cached Blaze session; cleared when EA invalidates it.
  session_key text,
  session_blaze_id bigint,
  session_request_id integer not null default 1,
  -- The EA franchise this REC league is bound to.
  ea_league_id text,
  ea_league_name text,
  ea_season_year integer,
  -- Datasets the commissioner wants imported, and whether the refresher may auto-import.
  enabled_datasets jsonb not null default '[]'::jsonb,
  auto_import boolean not null default false,
  status text not null default 'active',
  last_error text,
  last_import_at timestamptz,
  last_refreshed_at timestamptz,
  connected_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_ea_connections_status_valid check (status in ('active', 'needs_reauth', 'disabled', 'error')),
  -- One EA connection per league keeps import ownership unambiguous.
  unique (league_id)
);

alter table public.rec_ea_connections enable row level security;

create index if not exists rec_ea_connections_league_idx on public.rec_ea_connections(league_id);
create index if not exists rec_ea_connections_persona_idx on public.rec_ea_connections(blaze_persona_id);
create index if not exists rec_ea_connections_auto_import_idx
  on public.rec_ea_connections(auto_import) where auto_import and status = 'active';

-- Short-lived handoff between "paste your EA URL" and "pick a persona". Holds the temporary
-- EA token from step 2 of the auth flow, which is only used to list entitlements/personas and
-- is discarded once a persona-scoped token is issued.
create table if not exists public.rec_ea_pending_auth (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  requested_by_user_id uuid references public.rec_users(id) on delete set null,
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  personas jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.rec_ea_pending_auth enable row level security;

create index if not exists rec_ea_pending_auth_league_idx on public.rec_ea_pending_auth(league_id);
create index if not exists rec_ea_pending_auth_expiry_idx on public.rec_ea_pending_auth(expires_at);
