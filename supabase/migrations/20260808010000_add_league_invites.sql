-- League invites: site users invited to a league by the creator/commissioner.
-- A pending invite is unique per (league, invitee). Accepting adds the invitee as a
-- league member (they still pick a team afterward); declining is permanent.

create table public.rec_league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  inviter_user_id uuid not null references public.rec_users(id) on delete cascade,
  invitee_user_id uuid not null references public.rec_users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  message text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (inviter_user_id <> invitee_user_id)
);

create unique index rec_league_invites_pending_uidx
  on public.rec_league_invites (league_id, invitee_user_id)
  where status = 'pending';

create index rec_league_invites_invitee_idx
  on public.rec_league_invites (invitee_user_id, status);

create index rec_league_invites_league_idx
  on public.rec_league_invites (league_id, status);

alter table public.rec_league_invites enable row level security;
