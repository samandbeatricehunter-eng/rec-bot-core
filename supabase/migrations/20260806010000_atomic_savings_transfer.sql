-- Closes a "free money" race in wallet<->savings transfers: transferSavings previously read
-- wallet_balance/savings_balance once, computed new absolute values in application code, then
-- upserted those absolutes. If a wager/purchase debit (via add_to_wallet) landed on the same
-- wallet row between that read and that write, the transfer's absolute overwrite silently
-- erased the debit — the user kept both the coins and the bet/purchase. Same pattern, narrower
-- window, in the savings-interest credit on league advance. Both are now atomic single UPDATEs
-- with a floor check baked in, same shape as add_to_wallet's bounded debit.

create or replace function public.transfer_wallet_savings(
  p_user_id uuid,
  p_amount integer,
  p_direction text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be a positive integer';
  end if;

  if p_direction = 'to_savings' then
    update public.rec_wallets
      set wallet_balance = wallet_balance - p_amount,
          savings_balance = savings_balance + p_amount,
          updated_at = now()
      where user_id = p_user_id
        and wallet_balance >= p_amount;
  elsif p_direction = 'from_savings' then
    update public.rec_wallets
      set wallet_balance = wallet_balance + p_amount,
          savings_balance = savings_balance - p_amount,
          updated_at = now()
      where user_id = p_user_id
        and savings_balance >= p_amount;
  else
    raise exception 'p_direction must be to_savings or from_savings';
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'insufficient_balance_for_transfer' using errcode = 'REC02';
  end if;
end;
$$;

revoke all on function public.transfer_wallet_savings(uuid, integer, text) from public;
grant execute on function public.transfer_wallet_savings(uuid, integer, text) to service_role;

create or replace function public.add_to_savings(
  p_user_id uuid,
  p_amount integer
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount is null then
    raise exception 'p_amount is required';
  end if;

  update public.rec_wallets
    set savings_balance = savings_balance + p_amount,
        updated_at = now()
    where user_id = p_user_id
      and savings_balance + p_amount >= 0
    returning savings_balance into v_balance;

  if v_balance is null then
    raise exception 'insufficient_savings_balance' using errcode = 'REC03';
  end if;

  return v_balance;
end;
$$;

revoke all on function public.add_to_savings(uuid, integer) from public;
grant execute on function public.add_to_savings(uuid, integer) to service_role;
