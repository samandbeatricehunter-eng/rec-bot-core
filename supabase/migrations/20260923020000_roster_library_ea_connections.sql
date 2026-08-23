-- Parallel to rec_ea_connections/rec_ea_pending_auth (see 20260822000000_ea_oauth_connections.sql)
-- but scoped to a roster library instead of a league -- a roster library has no Discord guild,
-- so it gets its own EA session rather than piggybacking on a league's connection.
create table if not exists public.rec_site_roster_library_ea_connections (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.rec_site_roster_libraries(id) on delete cascade,
  blaze_persona_id text not null,
  persona_display_name text,
  console text not null,
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  token_expires_at timestamptz not null,
  session_key text,
  session_blaze_id bigint,
  session_request_id integer not null default 1,
  ea_league_id text,
  ea_league_name text,
  ea_season_year integer,
  status text not null default 'active',
  last_error text,
  last_import_at timestamptz,
  last_refreshed_at timestamptz,
  connected_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_site_roster_library_ea_connections_status_valid check (status in ('active', 'needs_reauth', 'disabled', 'error')),
  unique (library_id)
);
alter table public.rec_site_roster_library_ea_connections enable row level security;
create index if not exists rec_site_roster_library_ea_connections_library_idx
  on public.rec_site_roster_library_ea_connections(library_id);

create table if not exists public.rec_site_roster_library_ea_pending_auth (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.rec_site_roster_libraries(id) on delete cascade,
  requested_by_user_id uuid references public.rec_users(id) on delete set null,
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  personas jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.rec_site_roster_library_ea_pending_auth enable row level security;
create index if not exists rec_site_roster_library_ea_pending_auth_library_idx
  on public.rec_site_roster_library_ea_pending_auth(library_id);
create index if not exists rec_site_roster_library_ea_pending_auth_expiry_idx
  on public.rec_site_roster_library_ea_pending_auth(expires_at);
