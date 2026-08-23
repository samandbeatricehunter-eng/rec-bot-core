alter table public.rec_site_tournaments
  add column if not exists team_selection_mode text not null default 'typed'
    check (team_selection_mode in ('typed','claim_pool')),
  add column if not exists claim_order_mode text
    check (claim_order_mode in ('first_come','lottery'));
