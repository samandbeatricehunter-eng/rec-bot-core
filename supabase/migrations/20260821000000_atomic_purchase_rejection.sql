-- Atomic purchase rejection: the old deny flow in reviewPurchase refunded via add_to_wallet
-- FIRST and only then flipped status to 'rejected'. If the refund RPC errored, the whole deny
-- aborted BEFORE the status update, leaving the purchase stranded 'pending' — which still counts
-- against the season cap (ACTIVE_STATUSES = pending/approved/fulfilled), so the buyer could not
-- re-submit, and no refund had landed either. This RPC closes that window: it locks the row, issues
-- the refund (best-effort, so the rejection is never held hostage by a wallet failure), always
-- marks the purchase 'rejected', resolves the commissioner inbox item, and reports the refund
-- outcome so the caller can surface any refund failure. Calling it again on an already-rejected
-- purchase that still owes a refund retries exactly the missing refund.

create or replace function public.reject_purchase_request(
  p_purchase_id uuid,
  p_reviewer_discord_id text,
  p_denied_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.rec_purchases%rowtype;
  v_refund_ledger_id uuid;
  v_refunded integer := 0;
  v_refund_error text := null;
  v_reason text := nullif(trim(p_denied_reason), '');
  v_now timestamptz := now();
begin
  if p_reviewer_discord_id is null then raise exception 'A reviewer is required'; end if;

  select * into v_purchase from public.rec_purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found'; end if;

  -- Idempotent retry: the prior deny already rejected the purchase but its refund failed, so
  -- finish just the missing refund now (add_to_wallet is idempotent on source_reference).
  if v_purchase.status = 'rejected' then
    if v_purchase.already_deducted and coalesce(v_purchase.cost, 0) > 0 and v_purchase.refund_ledger_id is null then
      begin
        v_refund_ledger_id := public.add_to_wallet(
          v_purchase.user_id, v_purchase.cost, v_purchase.league_id,
          'Purchase refund', 'purchase_refund', 'purchase',
          jsonb_build_object('purchaseId', v_purchase.id, 'refund', true)
        );
        v_refunded := v_purchase.cost;
        update public.rec_purchases set refund_ledger_id = v_refund_ledger_id, updated_at = v_now
        where id = v_purchase.id;
      exception when others then
        v_refund_error := sqlerrm;
      end;
    end if;
    return jsonb_build_object('status', 'rejected', 'refunded', v_refunded,
      'refundLedgerId', coalesce(v_refund_ledger_id, v_purchase.refund_ledger_id), 'refundError', v_refund_error);
  end if;

  if v_purchase.status <> 'pending' then raise exception 'Purchase is already %', v_purchase.status; end if;

  if v_purchase.already_deducted and coalesce(v_purchase.cost, 0) > 0 then
    begin
      v_refund_ledger_id := public.add_to_wallet(
        v_purchase.user_id, v_purchase.cost, v_purchase.league_id,
        'Purchase refund', 'purchase_refund', 'purchase',
        jsonb_build_object('purchaseId', v_purchase.id, 'refund', true)
      );
      v_refunded := v_purchase.cost;
    exception when others then
      v_refund_error := sqlerrm;
    end;
  end if;

  update public.rec_purchases set
    status = 'rejected',
    denied_reason = coalesce(v_reason, 'Denied by commissioner review.'),
    admin_notes = v_reason,
    reviewed_by_discord_id = p_reviewer_discord_id,
    refund_ledger_id = v_refund_ledger_id,
    updated_at = v_now
  where id = v_purchase.id;

  update public.rec_commissioners_inbox set
    status = 'denied',
    reviewed_by_discord_id = p_reviewer_discord_id,
    reviewed_at = v_now,
    review_reason = v_reason
  where source_table = 'rec_purchases' and source_id = v_purchase.id;

  return jsonb_build_object('status', 'rejected', 'refunded', v_refunded,
    'refundLedgerId', v_refund_ledger_id, 'refundError', v_refund_error);
end;
$$;

revoke all on function public.reject_purchase_request(uuid, text, text) from public;
grant execute on function public.reject_purchase_request(uuid, text, text) to service_role;
