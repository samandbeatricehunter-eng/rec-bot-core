-- Closes a wallet-overdraft race: every debit path (wager holds, purchase debits, wallet-to-
-- savings transfers) used to SELECT the balance, check it in application code, then call
-- add_to_wallet separately — two concurrent requests could both pass the check against the same
-- starting balance and both debit, driving the wallet negative. add_to_wallet's own UPSERT never
-- bounded the result either. Fixed here at the single choke point every economy feature already
-- calls through: a debit (negative p_amount) now only succeeds via a conditional UPDATE that
-- requires the resulting balance to stay >= 0, so a losing concurrent request fails atomically
-- instead of succeeding. Credits (and explicit p_allow_negative admin corrections) keep the
-- existing unbounded upsert behavior. A CHECK constraint backstops any other write path.

alter table public.rec_wallets
  add constraint rec_wallets_balance_nonneg check (wallet_balance >= 0),
  add constraint rec_wallets_savings_nonneg check (savings_balance >= 0);

-- Adding a trailing parameter changes the signature, so CREATE OR REPLACE would leave the old
-- 7-arg overload in place alongside this one — ambiguous for any caller omitting the new
-- optional arg. Drop the old signature explicitly first.
drop function if exists public.add_to_wallet(uuid, integer, uuid, text, text, public.rec_source_type, jsonb);

create or replace function public.add_to_wallet(
  p_user_id uuid,
  p_amount integer,
  p_league_id uuid default null,
  p_description text default null,
  p_transaction_type text default 'payout',
  p_source public.rec_source_type default 'manual_admin_entry',
  p_source_reference jsonb default '{}'::jsonb,
  p_allow_negative boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_existing_ledger_id uuid;
  v_ledger_id uuid;
  v_updated_balance integer;
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
    and transaction_type = p_transaction_type
    and source = p_source
    and source_reference = coalesce(p_source_reference, '{}'::jsonb)
  limit 1;

  if v_existing_ledger_id is not null then
    return v_existing_ledger_id;
  end if;

  if p_amount < 0 and not p_allow_negative then
    -- Atomic bounded debit. Whether the wallet row exists yet or not, a failed match here
    -- means "insufficient funds" — there is no separate pre-check-then-debit step left to race.
    update public.rec_wallets
      set wallet_balance = wallet_balance + p_amount,
          updated_at = now()
      where user_id = p_user_id
        and wallet_balance + p_amount >= 0
      returning wallet_balance into v_updated_balance;

    if v_updated_balance is null then
      raise exception 'insufficient_wallet_balance' using errcode = 'REC01';
    end if;
  else
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
  end if;

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

revoke all on function public.add_to_wallet(uuid, integer, uuid, text, text, public.rec_source_type, jsonb, boolean) from public;
grant execute on function public.add_to_wallet(uuid, integer, uuid, text, text, public.rec_source_type, jsonb, boolean) to service_role;
