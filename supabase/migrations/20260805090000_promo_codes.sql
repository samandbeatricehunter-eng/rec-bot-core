-- Admin-managed promo codes redeemable during registration. Kept generic (effect_type +
-- effect_value) so new effect kinds can be added in application code without a schema change.
create table if not exists public.rec_promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  effect_type text not null check (effect_type in ('lifetime_platinum', 'lifetime_gold', 'bonus_coins')),
  effect_value integer,
  max_redemptions integer,
  redemption_count integer not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_promo_codes enable row level security;

create index if not exists idx_rec_promo_codes_active on public.rec_promo_codes (active) where active;

create table if not exists public.rec_promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.rec_promo_codes(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (promo_code_id, user_id)
);
alter table public.rec_promo_code_redemptions enable row level security;

create index if not exists idx_rec_promo_code_redemptions_user on public.rec_promo_code_redemptions (user_id);
