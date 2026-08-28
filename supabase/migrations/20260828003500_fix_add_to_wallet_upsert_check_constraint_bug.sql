-- Fixes a bug where every negative admin wallet deduction failed with a false-positive
-- "rec_wallets_balance_nonneg" CHECK violation, regardless of the user's actual balance.
--
-- Root cause: the wallet-row upsert used `insert ... on conflict (user_id) do update`.
-- PostgreSQL validates CHECK constraints against the raw speculative INSERT values tuple
-- as part of attempting the insert, before conflict resolution ever computes the real
-- merged total from the ON CONFLICT DO UPDATE branch. Since the raw insert tuple always
-- carries p_amount itself (e.g. -15000) rather than existing_balance + p_amount, any
-- negative admin grant tripped the constraint even when the true resulting balance was
-- perfectly valid (e.g. 16769 - 15000 = 1769). This affected every negative admin
-- correction ever attempted -- confirmed live via a rolled-back reproduction against a
-- real wallet row.
--
-- Fix: replace the upsert with a plain UPDATE (which validates the CHECK against the
-- actual final row), falling back to INSERT only when the user has no wallet row yet.

create or replace function public.add_to_wallet(p_user_id uuid, p_amount integer, p_league_id uuid default null::uuid, p_description text default null::text, p_transaction_type text default 'payout'::text, p_source rec_source_type default 'manual_admin_entry'::rec_source_type, p_source_reference jsonb default '{}'::jsonb, p_allow_negative boolean default false)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_existing_ledger_id uuid;
  v_ledger_id uuid;
  v_updated_balance integer;
  v_rows_updated integer;
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
    -- Deliberately NOT "insert ... on conflict do update": Postgres validates the
    -- rec_wallets_balance_nonneg CHECK constraint against the raw INSERT values tuple as part
    -- of the speculative-insertion attempt, before conflict resolution ever computes the real
    -- merged total -- so a negative p_amount (any admin deduction) always failed the check even
    -- when the existing balance made the final result perfectly valid. A plain UPDATE evaluates
    -- the constraint against the actual final row instead, so this only fails when the true
    -- resulting balance would really go negative.
    update public.rec_wallets
      set wallet_balance = wallet_balance + p_amount,
          updated_at = now()
      where user_id = p_user_id;

    get diagnostics v_rows_updated = row_count;

    if v_rows_updated = 0 then
      insert into public.rec_wallets (user_id, wallet_balance, savings_balance, created_at, updated_at)
      values (p_user_id, p_amount, 0, now(), now());
    end if;
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
$function$;
