-- Team ownership is singular. Prevent concurrent or repeated link operations from leaving
-- more than one current coach on the same league team.
create unique index if not exists rec_team_assignments_one_active_user_per_team
  on public.rec_team_assignments (league_id, team_id)
  where assignment_status = 'active' and ended_at is null;
