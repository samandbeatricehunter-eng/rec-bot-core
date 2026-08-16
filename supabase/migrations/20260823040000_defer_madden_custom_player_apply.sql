-- Madden defers the actual roster swap to the next EA import: the commissioner recreates
-- this player inside the Madden save on the designated roster slot, and the import naturally
-- pulls the new identity in under that slot's real EA id. Approving here only records sign-off
-- and the designated replacement — no rec_players write yet. The API's
-- reconcileApprovedMaddenPurchases (run after every EA import) marks this 'applied' once that
-- identity shows up in imported data. This also removes the old insert-then-delete race
-- entirely for Madden: there's nothing to insert here anymore.
-- CFB is unchanged — CFB has no live franchise-import cycle to defer to, so approval is still
-- the only moment the swap can happen.
create or replace function public.apply_custom_player_build(p_build_id uuid, p_reviewer_discord_id text, p_review_note text default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_build public.rec_custom_player_builds%rowtype;
  v_identity jsonb;
  v_player_id uuid;
  v_reward_ledger_id uuid;
  v_now timestamptz := now();
begin
  select * into v_build from public.rec_custom_player_builds where id = p_build_id for update;
  if not found then raise exception 'Custom-player build not found'; end if;
  if v_build.status <> 'pending_review' then raise exception 'Custom-player build is already %', v_build.status; end if;
  v_identity := v_build.identity;

  if v_build.unused_cp_refund_coins = 500 then
    v_reward_ledger_id := public.add_to_wallet(
      v_build.user_id, 500, v_build.league_id,
      'Custom-player unspent creation point reward', 'custom_player_unspent_cp_reward', 'purchase',
      jsonb_build_object('customPlayerBuildId', v_build.id, 'unusedCp', v_build.creation_points_remaining,
        'creationPointBudget', v_build.creation_point_budget, 'rewardThresholdPercent', 10)
    );
  end if;

  if v_build.game_family = 'MADDEN' then
    update public.rec_custom_player_builds set status = 'approved', approved_at = v_now,
      unused_cp_refund_ledger_id = v_reward_ledger_id,
      reviewed_by_discord_id = p_reviewer_discord_id, review_note = p_review_note, updated_at = v_now
    where id = v_build.id;
    update public.rec_purchases set status = 'approved', approved_at = v_now, updated_at = v_now
    where id = v_build.purchase_id;
    insert into public.rec_custom_player_audit_log
      (build_id, action, actor_discord_id, previous_status, next_status, details)
    values (v_build.id, 'approved_pending_import', p_reviewer_discord_id, 'pending_review', 'approved',
      jsonb_build_object('replacementPlayerId', v_build.replacement_player_id, 'unspentCpRewardCoins', v_build.unused_cp_refund_coins));
    return jsonb_build_object('status', 'approved', 'playerId', null,
      'unspentCpRewardCoins', v_build.unused_cp_refund_coins, 'unspentCpRewardLedgerId', v_reward_ledger_id);
  end if;

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
    null, null, null,
    (v_identity->>'jerseyNumber')::integer, v_identity->>'handedness', v_build.development_trait,
    v_build.estimated_ovr, v_build.inferred_archetype_key, v_build.attributes,
    jsonb_build_object('customPlayer', true, 'buildId', v_build.id), 'custom_player', v_build.id,
    null, null, null, null,
    null, 'active', false
  ) returning id into v_player_id;

  if v_build.replacement_player_id is not null then
    delete from public.rec_players
    where id = v_build.replacement_player_id and league_id = v_build.league_id and team_id = v_build.team_id;
  end if;

  update public.rec_custom_player_builds set status = 'applied', approved_at = v_now, applied_at = v_now,
    created_player_id = v_player_id, unused_cp_refund_ledger_id = v_reward_ledger_id,
    reviewed_by_discord_id = p_reviewer_discord_id, review_note = p_review_note, updated_at = v_now
  where id = v_build.id;
  update public.rec_purchases set status = 'fulfilled', approved_at = v_now, fulfilled_at = v_now, updated_at = v_now
  where id = v_build.purchase_id;
  insert into public.rec_custom_player_audit_log
    (build_id, action, actor_discord_id, previous_status, next_status, details)
  values (v_build.id, 'approved_and_applied', p_reviewer_discord_id, 'pending_review', 'applied',
    jsonb_build_object('createdPlayerId', v_player_id, 'unspentCpRewardCoins', v_build.unused_cp_refund_coins));

  return jsonb_build_object('status', 'applied', 'playerId', v_player_id,
    'unspentCpRewardCoins', v_build.unused_cp_refund_coins, 'unspentCpRewardLedgerId', v_reward_ledger_id);
end;
$function$;
