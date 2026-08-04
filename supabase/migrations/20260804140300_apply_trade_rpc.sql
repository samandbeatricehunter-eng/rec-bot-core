-- Trade Center backlog (#44) — atomic trade application, mirrors apply_custom_player_build:
-- locks the trade row, re-validates every leg is still where the trade thinks it is (a
-- player could have left the roster, a pick could already be used or re-traded since this
-- trade was proposed), reassigns players/picks, moves coins between wallets, marks the
-- trade applied, and writes an audit-log row — all in one transaction so a partial trade can
-- never land.
create or replace function public.apply_trade(
  p_trade_id uuid,
  p_reviewer_discord_id text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trade public.rec_trades%rowtype;
  v_leg record;
  v_now timestamptz := now();
  v_proposing_ledger_id uuid;
  v_receiving_ledger_id uuid;
begin
  select * into v_trade from public.rec_trades where id = p_trade_id for update;
  if not found then raise exception 'Trade not found'; end if;
  if v_trade.status not in ('accepted', 'pending_review') then
    raise exception 'Trade is not ready to apply (status: %)', v_trade.status;
  end if;

  for v_leg in select * from public.rec_trade_legs where trade_id = v_trade.id loop
    if v_leg.leg_type = 'player' then
      if not exists (
        select 1 from public.rec_players
        where id = v_leg.player_id and team_id = v_leg.from_team_id and roster_status = 'active'
      ) then
        raise exception 'A traded player is no longer active on the expected roster — trade can no longer be applied as proposed';
      end if;
      update public.rec_players set team_id = v_leg.to_team_id, updated_at = v_now where id = v_leg.player_id;
    else
      if not exists (
        select 1 from public.rec_draft_picks
        where id = v_leg.draft_pick_id and current_team_id = v_leg.from_team_id
      ) then
        raise exception 'A traded draft pick is no longer owned by the expected team';
      end if;
      update public.rec_draft_picks set current_team_id = v_leg.to_team_id, updated_at = v_now where id = v_leg.draft_pick_id;
      insert into public.rec_draft_pick_audit (draft_pick_id, changed_by_user_id, change_type, previous_value, new_value, reason)
      values (v_leg.draft_pick_id, null, 'traded', jsonb_build_object('currentTeamId', v_leg.from_team_id), jsonb_build_object('currentTeamId', v_leg.to_team_id), 'Trade ' || v_trade.id::text);
    end if;
  end loop;

  if v_trade.proposing_coins > 0 then
    v_proposing_ledger_id := public.add_to_wallet(
      v_trade.proposing_user_id, -v_trade.proposing_coins, v_trade.league_id,
      'Trade coins sent', 'trade_coins_sent', 'trade', jsonb_build_object('tradeId', v_trade.id)
    );
    perform public.add_to_wallet(
      v_trade.receiving_user_id, v_trade.proposing_coins, v_trade.league_id,
      'Trade coins received', 'trade_coins_received', 'trade', jsonb_build_object('tradeId', v_trade.id, 'from', 'proposing')
    );
  end if;
  if v_trade.receiving_coins > 0 then
    v_receiving_ledger_id := public.add_to_wallet(
      v_trade.receiving_user_id, -v_trade.receiving_coins, v_trade.league_id,
      'Trade coins sent', 'trade_coins_sent', 'trade', jsonb_build_object('tradeId', v_trade.id)
    );
    perform public.add_to_wallet(
      v_trade.proposing_user_id, v_trade.receiving_coins, v_trade.league_id,
      'Trade coins received', 'trade_coins_received', 'trade', jsonb_build_object('tradeId', v_trade.id, 'from', 'receiving')
    );
  end if;

  update public.rec_trades set
    status = 'applied',
    applied_at = v_now,
    updated_at = v_now,
    reviewed_by_discord_id = coalesce(p_reviewer_discord_id, reviewed_by_discord_id),
    review_note = coalesce(p_review_note, review_note),
    proposing_coins_ledger_id = coalesce(v_proposing_ledger_id, proposing_coins_ledger_id),
    receiving_coins_ledger_id = coalesce(v_receiving_ledger_id, receiving_coins_ledger_id)
  where id = v_trade.id;

  insert into public.rec_trade_audit_log (trade_id, action, actor_discord_id, previous_status, next_status, details)
  values (v_trade.id, 'applied', p_reviewer_discord_id, v_trade.status, 'applied', jsonb_build_object('reviewNote', p_review_note));

  return jsonb_build_object('status', 'applied', 'tradeId', v_trade.id);
end;
$$;

revoke all on function public.apply_trade(uuid, text, text) from public;
grant execute on function public.apply_trade(uuid, text, text) to service_role;
