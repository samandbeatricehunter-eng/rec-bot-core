-- Web Push subscriptions (per-device), used to power the Account page's
-- Enable/Disable Push Notifications toggle.

create table if not exists public.rec_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists rec_push_subscriptions_user_idx
  on public.rec_push_subscriptions (user_id);
alter table public.rec_push_subscriptions enable row level security;
