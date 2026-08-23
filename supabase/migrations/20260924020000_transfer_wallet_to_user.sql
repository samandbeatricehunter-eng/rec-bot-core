-- Atomic peer-to-peer coin transfer: both legs (sender debit, recipient credit) in one
-- transaction, unlike wager settlement's two separate add_to_wallet calls, so a mid-transfer
-- crash can't leave a sender debited with no matching credit. Idempotent on source_reference,
-- same convention as add_to_wallet.
create or replace function public.transfer_wallet_to_user(
  p_sender_user_id uuid,
  p_recipient_user_id uuid,
  p_amount integer,
  p_league_id uuid default null,
  p_description text default null,
  p_source_reference jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_rows integer;
  v_existing_id uuid;
begin
  if p_sender_user_id is null or p_recipient_user_id is null then
    raise exception 'sender and recipient are required';
  end if;
  if p_sender_user_id = p_recipient_user_id then
    raise exception 'cannot send coins to yourself';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be a positive integer';
  end if;

  select id into v_existing_id
  from public.rec_dollar_ledger
  where user_id = p_sender_user_id
    and transaction_type = 'p2p_transfer_sent'
    and source = 'p2p_transfer'
    and source_reference = coalesce(p_source_reference, '{}'::jsonb)
  limit 1;
  if v_existing_id is not null then
    return;
  end if;

  update public.rec_wallets
    set wallet_balance = wallet_balance - p_amount,
        updated_at = now()
    where user_id = p_sender_user_id
      and wallet_balance >= p_amount;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'insufficient_balance_for_transfer' using errcode = 'REC02';
  end if;

  insert into public.rec_wallets as w (user_id, wallet_balance, savings_balance, created_at, updated_at)
  values (p_recipient_user_id, p_amount, 0, now(), now())
  on conflict (user_id) do update
    set wallet_balance = w.wallet_balance + excluded.wallet_balance,
        updated_at = now();

  insert into public.rec_dollar_ledger (user_id, league_id, amount, transaction_type, description, source, source_reference)
  values
    (p_sender_user_id, p_league_id, -p_amount, 'p2p_transfer_sent', p_description, 'p2p_transfer', coalesce(p_source_reference, '{}'::jsonb)),
    (p_recipient_user_id, p_league_id, p_amount, 'p2p_transfer_received', p_description, 'p2p_transfer', coalesce(p_source_reference, '{}'::jsonb));
end;
$$;

revoke all on function public.transfer_wallet_to_user(uuid, uuid, integer, uuid, text, jsonb) from public;
grant execute on function public.transfer_wallet_to_user(uuid, uuid, integer, uuid, text, jsonb) to service_role;
