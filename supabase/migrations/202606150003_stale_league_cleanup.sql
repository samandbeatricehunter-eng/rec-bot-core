alter table public.rec_leagues
  add column if not exists last_advanced_at timestamptz;

update public.rec_leagues
set last_advanced_at = coalesce(last_advanced_at, updated_at, created_at)
where last_advanced_at is null;

alter table public.rec_leagues enable row level security;

create or replace function public.rec_cleanup_stale_leagues(
  p_stale_days integer default 21,
  p_dry_run boolean default false
)
returns table (
  league_id uuid,
  league_name text,
  last_advanced_at timestamptz,
  deleted boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_stale_days < 1 then
    raise exception 'p_stale_days must be at least 1';
  end if;

  if p_dry_run then
    return query
      select
        l.id,
        l.name,
        l.last_advanced_at,
        false
      from public.rec_leagues l
      where coalesce(l.last_advanced_at, l.updated_at, l.created_at) < now() - make_interval(days => p_stale_days)
      order by coalesce(l.last_advanced_at, l.updated_at, l.created_at);
    return;
  end if;

  return query
    with stale as (
      select
        l.id,
        l.name,
        l.last_advanced_at
      from public.rec_leagues l
      where coalesce(l.last_advanced_at, l.updated_at, l.created_at) < now() - make_interval(days => p_stale_days)
    ),
    deleted_holds as (
      delete from public.rec_purchase_holds h
      using stale s
      where h.league_id = s.id
      returning h.id
    ),
    deleted_leagues as (
      delete from public.rec_leagues l
      using stale s
      where l.id = s.id
      returning s.id, s.name, s.last_advanced_at
    )
    select
      d.id,
      d.name,
      d.last_advanced_at,
      true
    from deleted_leagues d
    order by d.last_advanced_at;
end;
$$;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rec_cleanup_stale_leagues_daily') then
    perform cron.unschedule('rec_cleanup_stale_leagues_daily');
  end if;
end;
$$;

select cron.schedule(
  'rec_cleanup_stale_leagues_daily',
  '17 9 * * *',
  'select public.rec_cleanup_stale_leagues(21, false);'
);
