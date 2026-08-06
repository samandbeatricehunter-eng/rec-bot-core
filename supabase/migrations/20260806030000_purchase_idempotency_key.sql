-- Generic store purchases (age_reset, dev_upgrade, contract, player_trait, attribute, legend)
-- had no idempotency protection at all — unlike custom-player builds, which already have this
-- exact column + constraint. A retried/duplicated submit (network hiccup, double-click) could
-- insert a second rec_purchases row and debit the wallet twice for the same logical request.
alter table public.rec_purchases
  add column if not exists idempotency_key uuid;

create unique index if not exists rec_purchases_idempotency_key_unique
  on public.rec_purchases (league_id, user_id, idempotency_key)
  where idempotency_key is not null;
