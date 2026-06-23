-- Fix box-score approval DB contracts used by the API.
--
-- PostgREST upsert cannot target the previous partial unique index on
-- records_apply_key. Use a normal unique index instead; Postgres still allows
-- multiple null values, so unmatched/manual results remain unaffected.
drop index if exists public.rec_game_results_records_apply_key;
create unique index if not exists rec_game_results_records_apply_key
  on public.rec_game_results(records_apply_key);

-- Wallet helper used by box score, stream, and highlight payouts. It is
-- idempotent for the exact same payout reference so retrying an approval does
-- not double-pay a user.
create or replace function public.add_to_wallet(
  p_user_id uuid,
  p_amount integer,
  p_league_id uuid default null,
  p_description text default null,
  p_transaction_type text default 'payout',
  p_source public.rec_source_type default 'manual_admin_entry',
  p_source_reference jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_existing_ledger_id uuid;
  v_ledger_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount is null then
    raise exception 'p_amount is required';
  end if;

  select id
    into v_existing_ledger_id
  from public.rec_dollar_ledger
  where user_id = p_user_id
    and amount = p_amount
    and transaction_type = p_transaction_type
    and source = p_source
    and source_reference = coalesce(p_source_reference, '{}'::jsonb)
  limit 1;

  if v_existing_ledger_id is not null then
    return v_existing_ledger_id;
  end if;

  insert into public.rec_wallets as w (
    user_id,
    wallet_balance,
    savings_balance,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    p_amount,
    0,
    now(),
    now()
  )
  on conflict (user_id) do update
    set wallet_balance = w.wallet_balance + excluded.wallet_balance,
        updated_at = now();

  insert into public.rec_dollar_ledger (
    user_id,
    league_id,
    amount,
    transaction_type,
    description,
    source,
    source_reference
  )
  values (
    p_user_id,
    p_league_id,
    p_amount,
    p_transaction_type,
    p_description,
    p_source,
    coalesce(p_source_reference, '{}'::jsonb)
  )
  returning id into v_ledger_id;

  return v_ledger_id;
end;
$$;

revoke all on function public.add_to_wallet(uuid, integer, uuid, text, text, public.rec_source_type, jsonb) from public;
