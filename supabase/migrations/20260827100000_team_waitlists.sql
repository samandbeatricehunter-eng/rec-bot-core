create table if not exists public.rec_team_waitlists (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  requester_discord_id text not null,
  team_id uuid references public.rec_teams(id) on delete cascade,
  conference text not null,
  scope text not null check (scope in ('any_open', 'specific_team')),
  status text not null default 'active' check (status in ('active', 'notified', 'cancelled', 'fulfilled')),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_team_waitlists_scope_team_check check (
    (scope = 'any_open' and team_id is null) or
    (scope = 'specific_team' and team_id is not null)
  )
);

alter table public.rec_team_waitlists enable row level security;

create unique index if not exists rec_team_waitlists_one_active_choice_idx
  on public.rec_team_waitlists (league_id, user_id, scope, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

create index if not exists rec_team_waitlists_active_league_idx
  on public.rec_team_waitlists (league_id, conference, team_id)
  where status = 'active';

grant select, insert, update, delete on public.rec_team_waitlists to service_role;

comment on table public.rec_team_waitlists is
  'Discord /openteams waitlist subscriptions. Access is service-role only; no anon/authenticated RLS policies are defined.';
