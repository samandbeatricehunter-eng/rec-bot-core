-- Audit log for every write-side EA Blaze admin command REC triggers (advance, clear cap
-- penalties, boot/admin a user, force a result, toggle autopilot) -- fired either from a
-- League Mgmt Tools button ('tool') or as a side effect of an action REC already performs
-- ('auto': Discord leave, co-commish change, Force Win/Fair Sim grant, autopilot grant).
create table if not exists public.rec_ea_admin_actions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  command_name text not null,
  target_description text,
  request_payload jsonb not null default '{}'::jsonb,
  trigger_source text not null check (trigger_source in ('tool', 'auto')),
  triggered_by_user_id uuid references public.rec_users(id),
  triggered_by_discord_id text,
  status text not null check (status in ('success', 'error')),
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);
alter table public.rec_ea_admin_actions enable row level security;
create index if not exists rec_ea_admin_actions_league_id_created_at_idx
  on public.rec_ea_admin_actions (league_id, created_at desc);

-- Record of an in-game autopilot grant. EA itself expires the in-game autopilot after `weeks`
-- (confirmed against EA's own behavior, not enforced by REC), so this table is purely an
-- audit/record -- not a scheduler REC needs to run an expiry job against.
create table if not exists public.rec_autopilot_grants (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  weeks integer not null default 1,
  granted_by_user_id uuid references public.rec_users(id),
  source text not null check (source in ('discord', 'site', 'tool')),
  created_at timestamptz not null default now()
);
alter table public.rec_autopilot_grants enable row level security;
create index if not exists rec_autopilot_grants_game_id_idx on public.rec_autopilot_grants (game_id);
