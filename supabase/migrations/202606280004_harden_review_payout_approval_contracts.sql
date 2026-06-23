-- Harden all approval-based payout paths (stream + highlight + box score).

do $$ begin
  alter type public.rec_source_type add value if not exists 'stream';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_source_type add value if not exists 'highlight';
exception when duplicate_object then null;
end $$;

create table if not exists public.rec_highlight_payout_reviews (
  id uuid primary key default gen_random_uuid(),
  highlight_post_id uuid not null references public.rec_highlight_posts(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  team_id uuid references public.rec_teams(id),
  season_number integer not null,
  week_number integer not null,
  payout_kind text not null default 'weekly_highlight' check (payout_kind in ('weekly_highlight', 'season_award')),
  award_category text,
  vote_count integer,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'issued')),
  amount integer not null default 25,
  discord_channel_id text,
  discord_message_id text,
  reviewed_by_discord_id text,
  denied_reason text,
  issued_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_highlight_payout_reviews enable row level security;

create unique index if not exists rec_highlight_payout_reviews_post_kind_key
  on public.rec_highlight_payout_reviews(highlight_post_id, payout_kind, (coalesce(award_category, '')));

create unique index if not exists rec_highlight_award_review_category_key
  on public.rec_highlight_payout_reviews(league_id, season_number, payout_kind, award_category)
  where payout_kind = 'season_award' and award_category is not null;

create index if not exists rec_highlight_payout_reviews_week_user_idx
  on public.rec_highlight_payout_reviews(league_id, season_number, week_number, user_id, status);

alter table public.rec_highlight_payout_reviews
  add column if not exists issued_ledger_id uuid references public.rec_dollar_ledger(id);

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
set search_path = public
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
grant execute on function public.add_to_wallet(uuid, integer, uuid, text, text, public.rec_source_type, jsonb) to service_role;
