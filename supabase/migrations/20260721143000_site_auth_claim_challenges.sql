create table public.rec_site_identity_claim_challenges (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  rec_user_id uuid not null references public.rec_users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_site_identity_claim_challenges enable row level security;

create index rec_site_identity_claim_challenges_expires_idx
  on public.rec_site_identity_claim_challenges (expires_at);
