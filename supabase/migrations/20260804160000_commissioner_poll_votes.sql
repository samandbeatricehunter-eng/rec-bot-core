-- Site-first voting for rec_commissioner_polls (Media page). The site is now the canonical
-- vote-casting surface — Discord's own native-poll click tally is no longer read as the
-- source of truth (createCommissionerPoll posts an informational embed, not an interactive
-- poll object, so there's nothing to double-count against). One vote per member, upsert on
-- re-vote.
create table if not exists public.rec_commissioner_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.rec_commissioner_polls(id) on delete cascade,
  voter_user_id uuid references public.rec_users(id) on delete set null,
  voter_discord_id text not null,
  option_id integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, voter_discord_id)
);

alter table public.rec_commissioner_poll_votes enable row level security;

create index if not exists rec_commissioner_poll_votes_poll_idx on public.rec_commissioner_poll_votes (poll_id);
