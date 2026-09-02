-- RTI: running XP-points remainder, one-time contract signing payouts, and the coin
-- source enum used by add_to_wallet when a franchise contract is signed.

alter type public.rec_source_type add value if not exists 'immortality_contract';

alter table public.rec_immortality_prospects
  add column if not exists xp_points_balance integer not null default 0;

alter table public.rec_immortality_contracts
  add column if not exists signed_at timestamptz,
  add column if not exists player_xp_payout integer not null default 0,
  add column if not exists coins_payout integer not null default 0,
  add column if not exists offer_status text not null default 'offered';

alter table public.rec_immortality_contracts
  drop constraint if exists rec_immortality_contracts_offer_status_check;
alter table public.rec_immortality_contracts
  add constraint rec_immortality_contracts_offer_status_check
  check (offer_status in ('offered', 'signed'));
