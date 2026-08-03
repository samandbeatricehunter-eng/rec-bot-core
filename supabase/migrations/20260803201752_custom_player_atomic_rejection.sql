create or replace function public.reject_custom_player_build(
  p_build_id uuid,
  p_reviewer_discord_id text,
  p_review_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_build public.rec_custom_player_builds%rowtype;
  v_refund_ledger_id uuid;
  v_now timestamptz := now();
begin
  if nullif(trim(p_review_note), '') is null then raise exception 'A rejection reason is required'; end if;
  select * into v_build from public.rec_custom_player_builds where id = p_build_id for update;
  if not found then raise exception 'Custom-player build not found'; end if;
  if v_build.status <> 'pending_review' then raise exception 'Custom-player build is already %', v_build.status; end if;

  v_refund_ledger_id := public.add_to_wallet(
    v_build.user_id, v_build.coin_price, v_build.league_id, 'Rejected custom-player refund',
    'purchase_refund', 'purchase', jsonb_build_object('customPlayerBuildId', v_build.id, 'rejected', true)
  );
  update public.rec_custom_player_builds set status = 'rejected', rejected_at = v_now,
    reviewed_by_discord_id = p_reviewer_discord_id, review_note = trim(p_review_note), updated_at = v_now
  where id = v_build.id;
  update public.rec_purchases set status = 'rejected', refund_ledger_id = v_refund_ledger_id,
    denied_reason = trim(p_review_note), updated_at = v_now where id = v_build.purchase_id;
  insert into public.rec_custom_player_audit_log
    (build_id, action, actor_discord_id, previous_status, next_status, details)
  values (v_build.id, 'rejected', p_reviewer_discord_id, v_build.status, 'rejected',
    jsonb_build_object('note', trim(p_review_note), 'refundLedgerId', v_refund_ledger_id));
  return jsonb_build_object('status', 'rejected', 'refunded', v_build.coin_price, 'refundLedgerId', v_refund_ledger_id);
end;
$$;

revoke all on function public.reject_custom_player_build(uuid, text, text) from public;
grant execute on function public.reject_custom_player_build(uuid, text, text) to service_role;
