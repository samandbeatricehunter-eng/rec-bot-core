-- Atomic default-team replacement.
-- Previously createDefaultTeamsForGuild / resetDefaultTeamsForGuild ran:
--   DELETE assignments, DELETE teams, then INSERT teams
-- as separate PostgREST calls. A failure after the deletes left the league
-- with no teams (or assignments/teams out of sync). This RPC runs the
-- destructive DB portion in one transaction; Discord/recruiting/audit side
-- effects stay in application code after a successful commit.

create or replace function public.rec_replace_league_default_teams(
  p_league_id uuid,
  p_teams jsonb,
  p_block_if_relocated boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_relocated_count integer;
  v_team_count integer;
  v_inserted jsonb;
begin
  if p_league_id is null then
    raise exception 'DEFAULT_TEAMS_LEAGUE_REQUIRED';
  end if;

  if jsonb_typeof(p_teams) is distinct from 'array' or jsonb_array_length(p_teams) = 0 then
    raise exception 'DEFAULT_TEAMS_EMPTY_PAYLOAD';
  end if;

  if p_block_if_relocated then
    select count(*)::integer
      into v_relocated_count
      from public.rec_teams
     where league_id = p_league_id
       and is_relocated = true;
    if coalesce(v_relocated_count, 0) > 0 then
      raise exception 'DEFAULT_TEAMS_BLOCKED_BY_RELOCATED'
        using errcode = 'P0001';
    end if;
  end if;

  delete from public.rec_team_assignments
   where league_id = p_league_id;

  delete from public.rec_teams
   where league_id = p_league_id;

  insert into public.rec_teams (
    league_id,
    name,
    abbreviation,
    conference,
    division,
    display_city,
    display_nick,
    display_abbr,
    is_relocated,
    original_abbreviation,
    source,
    primary_color
  )
  select
    p_league_id,
    nullif(t->>'name', ''),
    nullif(t->>'abbreviation', ''),
    nullif(t->>'conference', ''),
    nullif(t->>'division', ''),
    nullif(t->>'display_city', ''),
    nullif(t->>'display_nick', ''),
    nullif(t->>'display_abbr', ''),
    coalesce((t->>'is_relocated')::boolean, false),
    nullif(t->>'original_abbreviation', ''),
    coalesce(nullif(t->>'source', ''), 'manual_admin_entry'),
    coalesce(nullif(t->>'primary_color', ''), '#FFFFFF')
  from jsonb_array_elements(p_teams) as t;

  get diagnostics v_team_count = row_count;
  if v_team_count = 0 then
    raise exception 'DEFAULT_TEAMS_INSERT_EMPTY';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.name, r.abbreviation), '[]'::jsonb)
    into v_inserted
    from public.rec_teams r
   where r.league_id = p_league_id;

  return jsonb_build_object(
    'teams', v_inserted,
    'teamCount', coalesce(jsonb_array_length(v_inserted), 0)
  );
end;
$$;

revoke all on function public.rec_replace_league_default_teams(uuid, jsonb, boolean) from public;
grant execute on function public.rec_replace_league_default_teams(uuid, jsonb, boolean) to service_role;

