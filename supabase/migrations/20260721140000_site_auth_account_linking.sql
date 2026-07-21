alter table public.rec_users
  add column if not exists supabase_auth_user_id uuid,
  add column if not exists username text;

alter table public.rec_users
  add constraint rec_users_username_format_check
  check (
    username is null
    or username ~ '^[A-Za-z0-9_.]{3,24}$'
  );

create unique index if not exists rec_users_supabase_auth_user_id_key
  on public.rec_users (supabase_auth_user_id)
  where supabase_auth_user_id is not null;

create unique index if not exists rec_users_username_lower_key
  on public.rec_users ((lower(username)))
  where username is not null;

create table public.rec_site_identity_claims (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  rec_user_id uuid not null references public.rec_users(id) on delete restrict,
  claimed_at timestamptz not null default now(),
  unique (auth_user_id),
  unique (rec_user_id)
);

alter table public.rec_site_identity_claims enable row level security;
