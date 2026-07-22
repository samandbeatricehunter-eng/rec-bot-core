-- Subscription entitlements + league ownership + claim dropdown gate + bot invite.

alter table public.rec_users
  add column if not exists subscription_tier text not null default 'none',
  add column if not exists billing_status text not null default 'none',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_grace_until timestamptz;

alter table public.rec_users drop constraint if exists rec_users_subscription_tier_check;
alter table public.rec_users add constraint rec_users_subscription_tier_check
  check (subscription_tier in ('none', 'gold', 'platinum'));

alter table public.rec_users drop constraint if exists rec_users_billing_status_check;
alter table public.rec_users add constraint rec_users_billing_status_check
  check (billing_status in ('none', 'active', 'lifetime_comp', 'past_due', 'canceled', 'grace'));

create unique index if not exists rec_users_stripe_customer_id_uidx
  on public.rec_users (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists rec_users_stripe_subscription_id_uidx
  on public.rec_users (stripe_subscription_id) where stripe_subscription_id is not null;

-- League owner (head commissioner) + Discord bot enablement
alter table public.rec_leagues
  add column if not exists owner_user_id uuid references public.rec_users(id) on delete set null,
  add column if not exists discord_bot_enabled boolean not null default false,
  add column if not exists discord_bot_invite_token text,
  add column if not exists discord_bot_invite_created_at timestamptz,
  add column if not exists subscription_frozen boolean not null default false,
  add column if not exists subscription_frozen_at timestamptz,
  add column if not exists subscription_freeze_reason text;

create index if not exists rec_leagues_owner_user_id_idx on public.rec_leagues (owner_user_id)
  where owner_user_id is not null;
create unique index if not exists rec_leagues_bot_invite_token_uidx
  on public.rec_leagues (discord_bot_invite_token)
  where discord_bot_invite_token is not null;

-- Team assignment presence for Discord-only backfill window
alter table public.rec_team_assignments
  add column if not exists discord_joined_at timestamptz,
  add column if not exists stats_credit_starts_at timestamptz;

-- App-wide settings (claim dropdown kill switch)
create table if not exists public.rec_app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.rec_app_settings enable row level security;
grant select, insert, update, delete on public.rec_app_settings to service_role;

insert into public.rec_app_settings (key, value)
values ('identity_claim_dropdown', '{"closed": false, "auto_close_when_empty": true}'::jsonb)
on conflict (key) do nothing;

-- Grandfather: any user with a Discord account row gets lifetime Platinum
update public.rec_users u
set subscription_tier = 'platinum',
    billing_status = 'lifetime_comp',
    updated_at = now()
where exists (
  select 1 from public.rec_discord_accounts d where d.user_id = u.id
)
and coalesce(u.billing_status, 'none') in ('none', 'canceled');

alter table public.rec_users enable row level security;
alter table public.rec_leagues enable row level security;