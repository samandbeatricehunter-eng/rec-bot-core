-- Record wallet/savings moves in the same transaction as the balance update.
-- Earlier moves were not logged and cannot be reconstructed.
create table if not exists public.rec_wallet_savings_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  amount integer not null check (amount > 0),
  direction text not null check (direction in ('to_savings', 'from_savings')),
  created_at timestamptz not null default now()
);
alter table public.rec_wallet_savings_transfers enable row level security;
create index if not exists rec_wallet_savings_transfers_user_recent_idx
  on public.rec_wallet_savings_transfers (user_id, created_at desc);

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
      where user_id = p_user_id and wallet_balance >= p_amount;
  elsif p_direction = 'from_savings' then
    update public.rec_wallets
      set wallet_balance = wallet_balance + p_amount,
          savings_balance = savings_balance - p_amount,
          updated_at = now()
      where user_id = p_user_id and savings_balance >= p_amount;
  else
    raise exception 'p_direction must be to_savings or from_savings';
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'insufficient_balance_for_transfer' using errcode = 'REC02';
  end if;
  insert into public.rec_wallet_savings_transfers (user_id, amount, direction)
  values (p_user_id, p_amount, p_direction);
end;
$$;

revoke all on function public.transfer_wallet_savings(uuid, integer, text) from public;
grant execute on function public.transfer_wallet_savings(uuid, integer, text) to service_role;
