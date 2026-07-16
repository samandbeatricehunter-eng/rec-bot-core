-- EOS Awards move to the web hub as the sole voting surface (no more Discord native
-- polls). One row per (poll, voter) — casting again just updates the nominee via the
-- unique constraint, matching "one vote per category, can change your mind" semantics.
create table if not exists public.rec_eos_award_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.rec_eos_award_polls(id) on delete cascade,
  voter_user_id uuid not null references public.rec_users(id) on delete cascade,
  nominee_user_id uuid not null references public.rec_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, voter_user_id)
);

alter table public.rec_eos_award_votes enable row level security;
