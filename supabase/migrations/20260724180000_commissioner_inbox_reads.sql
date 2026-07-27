-- Tracks the last time a user viewed a given league's commissioner pending queue, so the
-- notification bell can stop flagging a league once its aggregate "N pending items" row has
-- been opened, and re-flag it again once a newer pending item shows up.

create table public.rec_commissioner_inbox_reads (
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, league_id)
);

alter table public.rec_commissioner_inbox_reads enable row level security;
