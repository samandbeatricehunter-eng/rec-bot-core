-- Moves the daily Spotlight Reel refresh off a Railway HTTP cron (which required a
-- cross-service shared secret between Railway services that kept drifting out of sync) onto
-- pg_cron running natively in Postgres. The core selection logic (top 5 highlights by
-- like/love reactions across leagues with at least one active team assignment) is pure
-- reads/writes with no external HTTP calls, so it ports directly — no secret needed at all.
-- Mirrors refreshSpotlightReel() in apps/api/src/modules/site-home/site-home.service.ts.
-- Dead-video cleanup (pruneDeadHighlightsOnceDaily, which calls Cloudflare's API) does NOT
-- port here — it stays a separate, best-effort concern reachable via the existing API route.
create or replace function public.refresh_spotlight_reel()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  has_active_leagues boolean;
  has_candidates boolean;
begin
  select exists (
    select 1 from rec_team_assignments
    where assignment_status = 'active' and ended_at is null
  ) into has_active_leagues;

  if not has_active_leagues then
    delete from rec_spotlight_reel;
    return;
  end if;

  select exists (
    select 1
    from rec_highlight_posts hp
    where hp.hub_visible = true
      and hp.media_status = 'ready'
      and hp.league_id in (
        select distinct league_id from rec_team_assignments
        where assignment_status = 'active' and ended_at is null
      )
  ) into has_candidates;

  if not has_candidates then
    delete from rec_spotlight_reel;
    return;
  end if;

  delete from rec_spotlight_reel;

  insert into rec_spotlight_reel (id, highlight_post_id, rank, like_count, selected_at)
  select
    gen_random_uuid(),
    scored.highlight_post_id,
    row_number() over (order by scored.like_count desc, scored.highlight_post_id::text asc),
    scored.like_count,
    now()
  from (
    select
      hp.id as highlight_post_id,
      count(hr.id) filter (where hr.reaction_key in ('like', 'love')) as like_count
    from rec_highlight_posts hp
    left join rec_highlight_reactions hr on hr.highlight_post_id = hp.id
    where hp.hub_visible = true
      and hp.media_status = 'ready'
      and hp.league_id in (
        select distinct league_id from rec_team_assignments
        where assignment_status = 'active' and ended_at is null
      )
    group by hp.id
    order by like_count desc, hp.id::text asc
    limit 5
  ) scored;
end;
$$;

select cron.schedule(
  'refresh_spotlight_reel_daily',
  '0 13 * * *', -- 8:00 AM America/Chicago (CDT = UTC-5)
  $$select public.refresh_spotlight_reel();$$
);
