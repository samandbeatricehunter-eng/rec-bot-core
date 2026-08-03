create table if not exists public.rec_user_league_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid not null,
  league_name text not null,
  game text not null,
  first_joined_at timestamptz,
  last_active_at timestamptz,
  archived_at timestamptz,
  is_active boolean not null default true,
  was_owner boolean not null default false,
  roles text[] not null default '{}',
  seasons_participated integer not null default 0,
  first_season integer,
  last_season integer,
  record jsonb not null default '{}'::jsonb,
  statistics jsonb not null default '{}'::jsonb,
  achievements jsonb not null default '{}'::jsonb,
  economy jsonb not null default '{}'::jsonb,
  wager_house jsonb not null default '{}'::jsonb,
  wager_peer jsonb not null default '{}'::jsonb,
  snapshot_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, league_id)
);

alter table public.rec_user_league_history enable row level security;
create index if not exists rec_user_league_history_user_idx
  on public.rec_user_league_history(user_id, last_active_at desc);
create index if not exists rec_user_league_history_league_idx
  on public.rec_user_league_history(league_id);

create table if not exists public.rec_user_league_team_tenures (
  id uuid primary key default gen_random_uuid(),
  history_id uuid not null references public.rec_user_league_history(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid not null,
  team_id uuid references public.rec_teams(id) on delete set null,
  team_name text,
  team_abbreviation text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  archived_at timestamptz,
  restored_at timestamptz,
  end_reason text,
  is_active boolean not null default true,
  first_season integer,
  last_season integer,
  record jsonb not null default '{}'::jsonb,
  statistics jsonb not null default '{}'::jsonb,
  economy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_user_league_team_tenures enable row level security;
create index if not exists rec_user_league_team_tenures_history_idx
  on public.rec_user_league_team_tenures(history_id, started_at);
create index if not exists rec_user_league_team_tenures_user_league_idx
  on public.rec_user_league_team_tenures(user_id, league_id, started_at);
create unique index if not exists rec_user_league_team_tenures_one_active_idx
  on public.rec_user_league_team_tenures(user_id, league_id)
  where is_active and ended_at is null;

create table if not exists public.rec_admin_incidents (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.rec_leagues(id) on delete set null,
  guild_id text,
  process text not null,
  severity text not null default 'high',
  status text not null default 'open',
  title text not null,
  detail text,
  error_name text,
  error_message text,
  error_stack text,
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_admin_incidents enable row level security;
create index if not exists rec_admin_incidents_open_idx
  on public.rec_admin_incidents(status, severity, occurred_at desc);
create index if not exists rec_admin_incidents_league_idx
  on public.rec_admin_incidents(league_id, occurred_at desc);

-- History and incidents deliberately survive the generic league wipe. Every other
-- public table carrying league_id remains part of the hard-delete sweep.
create or replace function public.rec_delete_league(p_league_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_table text; v_count int; v_total int := 0; v_deleted jsonb := '{}'::jsonb;
begin
  if p_league_id is null then raise exception 'p_league_id is required'; end if;
  update public.rec_user_league_team_tenures set team_id = null, updated_at = now() where league_id = p_league_id;
  set local session_replication_role = 'replica';
  for v_table in
    select distinct c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'league_id'
      and a.attnum > 0 and not a.attisdropped and c.relname <> 'rec_leagues'
      and c.relname not in ('rec_user_league_history','rec_user_league_team_tenures','rec_admin_incidents')
    order by c.relname
  loop
    execute format('delete from public.%I where league_id = $1', v_table) using p_league_id;
    get diagnostics v_count = row_count;
    if v_count > 0 then v_deleted := v_deleted || jsonb_build_object(v_table, v_count); v_total := v_total + v_count; end if;
  end loop;
  delete from public.rec_leagues where id = p_league_id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('league_id', p_league_id, 'rows_deleted', v_total, 'league_deleted', (v_count > 0), 'tables', v_deleted);
end; $$;
revoke execute on function public.rec_delete_league(uuid) from public, anon, authenticated;

alter table public.rec_highlight_posts add column if not exists discord_attachment_index integer not null default 0;
drop index if exists public.rec_highlight_posts_discord_message_key;
create unique index if not exists rec_highlight_posts_discord_attachment_key
  on public.rec_highlight_posts (league_id, discord_channel_id, discord_message_id, discord_attachment_index)
  where discord_channel_id is not null and discord_message_id is not null;
