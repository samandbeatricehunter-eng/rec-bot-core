-- Team-scoped league invites: the Manage League division-card dropdown invites a specific
-- user to a specific team. On accept, the invitee is auto-linked to that team (when it is
-- still unlinked) instead of joining the league unassigned.

alter table public.rec_league_invites
  add column if not exists team_id uuid references public.rec_teams(id) on delete set null;

create index if not exists rec_league_invites_team_idx on public.rec_league_invites(team_id);
