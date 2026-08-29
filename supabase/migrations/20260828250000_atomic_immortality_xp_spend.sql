-- Serialize Player XP debits per prospect so concurrent requests cannot overspend.
create or replace function public.rec_immortality_spend_xp(
  p_prospect_id uuid,
  p_event_type text,
  p_source_id text,
  p_player_xp_delta integer,
  p_team_xp_delta integer,
  p_formula_version text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_player_xp integer;
begin
  perform 1
  from public.rec_immortality_prospects
  where id = p_prospect_id
  for update;

  if not found then
    return false;
  end if;

  select coalesce(sum(player_xp_delta), 0)::integer
  into current_player_xp
  from public.rec_immortality_xp_ledger
  where prospect_id = p_prospect_id;

  if current_player_xp + p_player_xp_delta < 0 then
    return false;
  end if;

  insert into public.rec_immortality_xp_ledger (
    prospect_id, event_type, source_id, player_xp_delta, team_xp_delta, formula_version
  ) values (
    p_prospect_id, p_event_type, p_source_id, p_player_xp_delta, p_team_xp_delta, p_formula_version
  );

  return true;
end;
$$;

revoke all on function public.rec_immortality_spend_xp(uuid, text, text, integer, integer, text) from public;
grant execute on function public.rec_immortality_spend_xp(uuid, text, text, integer, integer, text) to service_role;
