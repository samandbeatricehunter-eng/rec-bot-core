-- Distinguish WHERE a lifetime_comp tier came from so automatic Lifetime Platinum
-- bookkeeping (syncLifetimePlatinumForUser / expireUnclaimedFreeLifetimePlatinum) only
-- ever clears REC-OG-sourced comps and never stomps an admin-console grant or a promo-code
-- lifetime grant that a human intentionally handed out.
alter table public.rec_users
  add column if not exists subscription_source text;

alter table public.rec_users
  add constraint rec_users_subscription_source_check
  check (
    subscription_source is null
    or subscription_source in ('rec_og', 'admin_grant', 'promo_code')
  );

-- Backfill existing lifetime_comp rows: an admin-console tier grant always wrote an
-- admin.tier_granted audit entry, and a promo-code lifetime grant always left a
-- rec_promo_code_redemptions row with a lifetime_* effect. Everything else that is
-- currently lifetime_comp originally came from the REC OG free Lifetime Platinum grant.
update public.rec_users u
set subscription_source = 'admin_grant'
where u.billing_status = 'lifetime_comp'
  and exists (
    select 1 from public.rec_audit_logs a
    where a.entity_type = 'rec_users'
      and a.entity_id = u.id
      and a.action = 'admin.tier_granted'
  );

update public.rec_users u
set subscription_source = 'promo_code'
where u.billing_status = 'lifetime_comp'
  and u.subscription_source is null
  and exists (
    select 1
    from public.rec_promo_code_redemptions r
    inner join public.rec_promo_codes p on p.id = r.promo_code_id
    where r.user_id = u.id
      and p.effect_type in ('lifetime_platinum', 'lifetime_gold')
  );

update public.rec_users u
set subscription_source = 'rec_og'
where u.billing_status = 'lifetime_comp'
  and u.subscription_source is null;