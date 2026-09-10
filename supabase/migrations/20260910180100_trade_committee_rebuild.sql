-- Trade committee rebuild, step 2. Context: trades are moving from a 3-way league setting
-- (no approval / commissioner review / committee review) to a 2-way one -- trades are either
-- "not_allowed" or go through competition-committee voting, always. Every league that currently
-- allows trades in any form is normalized onto committee review; "not_allowed" is new and only
-- ever chosen going forward via league settings.
update public.rec_league_configuration
set trade_approval_policy = 'competition_committee_review'
where trade_approval_policy in ('no_approval_required', 'commissioner_review');

-- Discord channels for the new proposed/finalized/rejected trade posting flow. finalized_trades
-- already existed as a channel column (previously used only for a one-way announcement); the two
-- new ones are proposed (committee-vote post, checkmark/X reactions) and rejected.
alter table public.rec_server_routes
  add column if not exists proposed_trades_channel_id text,
  add column if not exists rejected_trades_channel_id text;

-- Tracks the live committee-vote message so Discord reaction adds/removes on it can be resolved
-- back to a trade, and whether the coin portion of an applied trade has been released yet.
alter table public.rec_trades
  add column if not exists vote_channel_id text,
  add column if not exists vote_message_id text,
  add column if not exists coins_released_at timestamptz;

-- apply_trade now only reassigns players/picks and, for any coins involved, DEBITS the sending
-- side into holding (mirrors the wager hold pattern) -- it no longer credits the receiving side.
-- A trade with no coins involved is fully settled the moment it applies (coins_released_at is
-- stamped immediately since there's nothing left to release). A trade with coins stays "applied"
-- but unreleased until a commissioner confirms the trade actually went through in-game and calls
-- release_trade_coins below.
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
  v_has_coins boolean;
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

  v_has_coins := v_trade.proposing_coins > 0 or v_trade.receiving_coins > 0;

  if v_trade.proposing_coins > 0 then
    v_proposing_ledger_id := public.add_to_wallet(
      v_trade.proposing_user_id, -v_trade.proposing_coins, v_trade.league_id,
      'Trade coins held pending in-game confirmation', 'trade_coins_hold', 'trade', jsonb_build_object('tradeId', v_trade.id)
    );
  end if;
  if v_trade.receiving_coins > 0 then
    v_receiving_ledger_id := public.add_to_wallet(
      v_trade.receiving_user_id, -v_trade.receiving_coins, v_trade.league_id,
      'Trade coins held pending in-game confirmation', 'trade_coins_hold', 'trade', jsonb_build_object('tradeId', v_trade.id)
    );
  end if;

  update public.rec_trades set
    status = 'applied',
    applied_at = v_now,
    updated_at = v_now,
    reviewed_by_discord_id = coalesce(p_reviewer_discord_id, reviewed_by_discord_id),
    review_note = coalesce(p_review_note, review_note),
    proposing_coins_ledger_id = coalesce(v_proposing_ledger_id, proposing_coins_ledger_id),
    receiving_coins_ledger_id = coalesce(v_receiving_ledger_id, receiving_coins_ledger_id),
    coins_released_at = case when v_has_coins then null else v_now end
  where id = v_trade.id;

  insert into public.rec_trade_audit_log (trade_id, action, actor_discord_id, previous_status, next_status, details)
  values (v_trade.id, 'applied', p_reviewer_discord_id, v_trade.status, 'applied', jsonb_build_object('reviewNote', p_review_note, 'coinsHeld', v_has_coins));

  return jsonb_build_object('status', 'applied', 'tradeId', v_trade.id, 'coinsHeld', v_has_coins);
end;
$$;

revoke all on function public.apply_trade(uuid, text, text) from public;
grant execute on function public.apply_trade(uuid, text, text) to service_role;

-- Commissioner-only release step: credits the coins that apply_trade put into holding to their
-- actual recipients. Only callable once, only on an applied trade that still has coins pending.
create or replace function public.release_trade_coins(
  p_trade_id uuid,
  p_reviewer_discord_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trade public.rec_trades%rowtype;
  v_now timestamptz := now();
begin
  select * into v_trade from public.rec_trades where id = p_trade_id for update;
  if not found then raise exception 'Trade not found'; end if;
  if v_trade.status <> 'applied' then raise exception 'Trade is not in an applied state (status: %)', v_trade.status; end if;
  if v_trade.coins_released_at is not null then raise exception 'Trade coins were already released'; end if;
  if v_trade.proposing_coins <= 0 and v_trade.receiving_coins <= 0 then raise exception 'This trade has no coins to release'; end if;

  if v_trade.proposing_coins > 0 then
    perform public.add_to_wallet(
      v_trade.receiving_user_id, v_trade.proposing_coins, v_trade.league_id,
      'Trade coins received', 'trade_coins_received', 'trade', jsonb_build_object('tradeId', v_trade.id, 'from', 'proposing')
    );
  end if;
  if v_trade.receiving_coins > 0 then
    perform public.add_to_wallet(
      v_trade.proposing_user_id, v_trade.receiving_coins, v_trade.league_id,
      'Trade coins received', 'trade_coins_received', 'trade', jsonb_build_object('tradeId', v_trade.id, 'from', 'receiving')
    );
  end if;

  update public.rec_trades set
    coins_released_at = v_now,
    updated_at = v_now,
    reviewed_by_discord_id = coalesce(p_reviewer_discord_id, reviewed_by_discord_id)
  where id = v_trade.id;

  insert into public.rec_trade_audit_log (trade_id, action, actor_discord_id, previous_status, next_status, details)
  values (v_trade.id, 'coins_released', p_reviewer_discord_id, 'applied', 'applied', jsonb_build_object('reviewNote', 'Confirmed sent in-game — coins released'));

  return jsonb_build_object('status', 'coins_released', 'tradeId', v_trade.id);
end;
$$;

revoke all on function public.release_trade_coins(uuid, text) from public;
grant execute on function public.release_trade_coins(uuid, text) to service_role;
