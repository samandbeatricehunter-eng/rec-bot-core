-- Flip the identity→column mapping for created custom players. Previously CFB custom players
-- were written with hometown_city/hometown_state (college null) and Madden custom players with
-- college only. The Madden wizard now collects hometown, state, AND college for every Madden
-- build; CFB builds collect none of them. So created players store hometown/state/college for
-- MADDEN and null for CFB.
create or replace function public.apply_custom_player_build(
  p_build_id uuid,
  p_reviewer_discord_id text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_build public.rec_custom_player_builds%rowtype;
  v_identity jsonb;
  v_player_id uuid;
  v_refund_ledger_id uuid;
  v_now timestamptz := now();
begin
  select * into v_build from public.rec_custom_player_builds where id = p_build_id for update;
  if not found then raise exception 'Custom-player build not found'; end if;
  if v_build.status <> 'pending_review' then raise exception 'Custom-player build is already %', v_build.status; end if;
  if v_build.replacement_player_id is not null and not exists (
    select 1 from public.rec_players
    where id = v_build.replacement_player_id and league_id = v_build.league_id
      and team_id = v_build.team_id and roster_status = 'active'
  ) then raise exception 'The selected replacement player is no longer active on this roster'; end if;

  v_identity := v_build.identity;
  insert into public.rec_players (
    league_id, team_id, madden_player_id, first_name, last_name, full_name, position,
    height_inches, weight_lbs, hometown_city, hometown_state, college, jersey_number,
    handedness, dev_trait, overall_rating, archetype, attributes, raw_payload,
    player_source, custom_player_build_id, contract_years_left, contract_salary,
    contract_bonus, is_xfactor, ability_count, roster_status, is_default_player
  ) values (
    v_build.league_id, v_build.team_id, null, trim(v_identity->>'firstName'), trim(v_identity->>'lastName'),
    trim(v_identity->>'firstName') || ' ' || trim(v_identity->>'lastName'), v_build.position,
    (v_identity->>'heightInches')::integer, (v_identity->>'weightLbs')::integer,
    case when v_build.game_family = 'MADDEN' then nullif(v_identity->>'hometownCity','') else null end,
    case when v_build.game_family = 'MADDEN' then nullif(v_identity->>'hometownState','') else null end,
    case when v_build.game_family = 'MADDEN' then nullif(v_identity->>'college','') else null end,
    (v_identity->>'jerseyNumber')::integer, v_identity->>'handedness', v_build.development_trait,
    v_build.estimated_ovr, v_build.inferred_archetype_key, v_build.attributes,
    jsonb_build_object('customPlayer', true, 'buildId', v_build.id), 'custom_player', v_build.id,
    case when v_build.game_family = 'MADDEN' then 3 else null end,
    case when v_build.game_family = 'MADDEN' then 0 else null end,
    case when v_build.game_family = 'MADDEN' then 0 else null end,
    case when v_build.game_family = 'MADDEN' then v_build.development_trait = 'xfactor' else null end,
    null, 'active', false
  ) returning id into v_player_id;

  if v_build.replacement_player_id is not null then
    delete from public.rec_players
    where id = v_build.replacement_player_id and league_id = v_build.league_id and team_id = v_build.team_id;
  end if;

  if v_build.unused_cp_refund_coins > 0 then
    v_refund_ledger_id := public.add_to_wallet(
      v_build.user_id, v_build.unused_cp_refund_coins, v_build.league_id,
      'Unused custom-player creation point refund', 'custom_player_unused_cp_refund', 'purchase',
      jsonb_build_object('customPlayerBuildId', v_build.id, 'unusedCp', v_build.creation_points_remaining)
    );
  end if;

  update public.rec_custom_player_builds set status = 'applied', approved_at = v_now, applied_at = v_now,
    created_player_id = v_player_id, unused_cp_refund_ledger_id = v_refund_ledger_id,
    reviewed_by_discord_id = p_reviewer_discord_id, review_note = p_review_note, updated_at = v_now
  where id = v_build.id;
  update public.rec_purchases set status = 'fulfilled', approved_at = v_now, fulfilled_at = v_now, updated_at = v_now
  where id = v_build.purchase_id;
  insert into public.rec_custom_player_audit_log
    (build_id, action, actor_discord_id, previous_status, next_status, details)
  values (v_build.id, 'approved_and_applied', p_reviewer_discord_id, v_build.status, 'applied',
    jsonb_build_object('createdPlayerId', v_player_id, 'unusedCpRefundCoins', v_build.unused_cp_refund_coins));

  return jsonb_build_object('status', 'applied', 'playerId', v_player_id,
    'unusedCpRefundCoins', v_build.unused_cp_refund_coins, 'unusedCpRefundLedgerId', v_refund_ledger_id);
end;
$$;

revoke all on function public.apply_custom_player_build(uuid, text, text) from public;
grant execute on function public.apply_custom_player_build(uuid, text, text) to service_role;
