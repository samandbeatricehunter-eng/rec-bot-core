-- Promo codes: add a "free trial for N months, then requires payment" effect, distinct from
-- the lifetime-comp effects (which never expire) and from Stripe's own 7-day checkout trial
-- (trial_ends_at/trial_used_at, untouched here so the two mechanisms don't collide).

alter table rec_promo_codes drop constraint rec_promo_codes_effect_type_check;
alter table rec_promo_codes add constraint rec_promo_codes_effect_type_check
  check (effect_type = any (array['lifetime_platinum', 'lifetime_gold', 'bonus_coins', 'trial_gold', 'trial_platinum']));

alter table rec_users drop constraint rec_users_billing_status_check;
alter table rec_users add constraint rec_users_billing_status_check
  check (billing_status = any (array['none', 'active', 'lifetime_comp', 'past_due', 'canceled', 'grace', 'promo_trial']));

alter table rec_users add column if not exists promo_trial_ends_at timestamptz;
