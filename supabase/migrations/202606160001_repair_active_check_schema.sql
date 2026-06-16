do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_responses'
      and column_name = 'active_check_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_responses'
      and column_name = 'event_id'
  ) then
    alter table public.rec_active_check_responses rename column active_check_id to event_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_responses'
      and column_name = 'active_check_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_responses'
      and column_name = 'event_id'
  ) then
    update public.rec_active_check_responses
    set event_id = coalesce(event_id, active_check_id)
    where event_id is null;

    alter table public.rec_active_check_responses drop column active_check_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_misses'
      and column_name = 'active_check_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_misses'
      and column_name = 'event_id'
  ) then
    alter table public.rec_active_check_misses rename column active_check_id to event_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_misses'
      and column_name = 'active_check_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rec_active_check_misses'
      and column_name = 'event_id'
  ) then
    update public.rec_active_check_misses
    set event_id = coalesce(event_id, active_check_id)
    where event_id is null;

    alter table public.rec_active_check_misses drop column active_check_id;
  end if;
end;
$$;

alter table public.rec_active_check_events
  add column if not exists season_number integer,
  add column if not exists week_number integer,
  add column if not exists status text not null default 'open',
  add column if not exists discord_channel_id text,
  add column if not exists discord_message_id text,
  add column if not exists created_by_discord_id text,
  add column if not exists closes_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.rec_active_check_responses
  add column if not exists event_id uuid references public.rec_active_check_events(id) on delete cascade,
  add column if not exists league_id uuid,
  add column if not exists user_id uuid,
  add column if not exists discord_id text,
  add column if not exists team_id uuid,
  add column if not exists responded_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.rec_active_check_misses
  add column if not exists event_id uuid references public.rec_active_check_events(id) on delete cascade,
  add column if not exists league_id uuid,
  add column if not exists user_id uuid,
  add column if not exists team_id uuid,
  add column if not exists missed_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();

update public.rec_active_check_responses r
set user_id = da.user_id,
    updated_at = now()
from public.rec_discord_accounts da
where r.user_id is null
  and r.discord_id is not null
  and da.discord_id = r.discord_id;

with ranked_responses as (
  select
    id,
    row_number() over (
      partition by event_id, user_id
      order by responded_at nulls last, created_at nulls last, id
    ) as rn
  from public.rec_active_check_responses
  where event_id is not null
    and user_id is not null
)
delete from public.rec_active_check_responses r
using ranked_responses rr
where r.id = rr.id
  and rr.rn > 1;

with ranked_misses as (
  select
    id,
    row_number() over (
      partition by event_id, user_id
      order by missed_at nulls last, created_at nulls last, id
    ) as rn
  from public.rec_active_check_misses
  where event_id is not null
    and user_id is not null
)
delete from public.rec_active_check_misses m
using ranked_misses rm
where m.id = rm.id
  and rm.rn > 1;

with ranked_open as (
  select
    id,
    row_number() over (
      partition by league_id
      order by created_at desc nulls last, closes_at desc nulls last, id desc
    ) as rn
  from public.rec_active_check_events
  where status = 'open'
)
update public.rec_active_check_events e
set status = 'cancelled',
    closed_at = coalesce(e.closed_at, now()),
    updated_at = now()
from ranked_open ro
where e.id = ro.id
  and ro.rn > 1;

create unique index if not exists rec_active_check_responses_event_user_key
  on public.rec_active_check_responses(event_id, user_id);

create unique index if not exists rec_active_check_misses_event_user_key
  on public.rec_active_check_misses(event_id, user_id);

create index if not exists rec_active_check_events_open_idx
  on public.rec_active_check_events(league_id, status, closes_at);

create unique index if not exists rec_active_check_one_open_per_league_idx
  on public.rec_active_check_events(league_id)
  where status = 'open';

alter table public.rec_active_check_events enable row level security;
alter table public.rec_active_check_responses enable row level security;
alter table public.rec_active_check_misses enable row level security;
