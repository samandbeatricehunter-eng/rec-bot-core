-- EA only allows one active Blaze session per persona. rec_ea_connections stored an independent
-- token+session per LEAGUE, so two REC leagues sharing one EA account (persona) each held their
-- own token/session -- reconnecting or importing one silently invalidated the other's session on
-- EA's side (confirmed live: reconnecting league A killed league B's refresh_token within
-- minutes, then A itself failed shortly after). Snallabot (the reverse-engineered Blaze protocol
-- this integration is built on) keys its token/session store by persona and shares it across every
-- league under that account -- this migration mirrors that: the token/session moves to a new
-- persona-keyed table, and rec_ea_connections keeps only per-league state (which franchise this
-- league is bound to, its import settings/health) plus the blaze_persona_id it points at.

create table if not exists public.rec_ea_persona_sessions (
  blaze_persona_id text primary key,
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
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_ea_persona_sessions enable row level security;

-- Backfill one row per persona from the existing per-league rows, keeping whichever connection
-- was updated most recently (its token/session is the freshest).
insert into public.rec_ea_persona_sessions
  (blaze_persona_id, persona_display_name, ea_namespace, console, token_ciphertext, token_iv,
   token_tag, token_expires_at, session_key, session_blaze_id, session_request_id,
   last_refreshed_at, created_at, updated_at)
select distinct on (blaze_persona_id)
  blaze_persona_id, persona_display_name, ea_namespace, console, token_ciphertext, token_iv,
  token_tag, token_expires_at, session_key, session_blaze_id, session_request_id,
  last_refreshed_at, created_at, updated_at
from public.rec_ea_connections
order by blaze_persona_id, updated_at desc
on conflict (blaze_persona_id) do nothing;

alter table public.rec_ea_connections
  drop column if exists persona_display_name,
  drop column if exists ea_namespace,
  drop column if exists console,
  drop column if exists token_ciphertext,
  drop column if exists token_iv,
  drop column if exists token_tag,
  drop column if exists token_expires_at,
  drop column if exists session_key,
  drop column if exists session_blaze_id,
  drop column if exists session_request_id,
  drop column if exists last_refreshed_at;
