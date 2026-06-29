-- Purchases store: request → commissioner approval (deduct on request, refund on deny).
-- A legacy `rec_purchases` table + status enum (pending/approved/rejected/fulfilled/
-- cancelled/refunded) and `rec_purchase_holds` already exist (empty, unwired except for
-- loadUserFinancialSummary which counts status in approved/fulfilled). Rather than create a
-- parallel table, extend the existing one with the columns the request/approval flow needs.
-- Economy (rec_wallets, rec_dollar_ledger, add_to_wallet) and per-type purchase config
-- (rec_league_configuration enabled flags + *_season_cap + core_attributes) already exist.

alter type public.rec_source_type add value if not exists 'purchase';

alter table public.rec_purchases
  add column if not exists season_id uuid references public.rec_seasons(id) on delete set null,
  add column if not exists season_number integer,
  add column if not exists discord_id text,
  add column if not exists debit_ledger_id uuid,
  add column if not exists refund_ledger_id uuid,
  add column if not exists discord_message_id text,
  add column if not exists discord_channel_id text,
  add column if not exists reviewed_by_discord_id text,
  add column if not exists denied_reason text;

create index if not exists rec_purchases_league_status_idx
  on public.rec_purchases (league_id, status);
create index if not exists rec_purchases_season_type_idx
  on public.rec_purchases (league_id, season_number, purchase_type);
