-- Track a player's current team directly on rec_players so roster moves (transactions) are detectable
-- and imports can keep it current regardless of source endpoint. Backfilled from raw_payload.teamId.
alter table public.rec_players add column if not exists team_id uuid;

update public.rec_players p
set team_id = t.id
from public.rec_teams t
where t.league_id = p.league_id
  and t.madden_team_id is not null
  and t.madden_team_id = (p.raw_payload->>'teamId')
  and (p.raw_payload ? 'teamId')
  and p.team_id is distinct from t.id;

create index if not exists idx_rec_players_team_id on public.rec_players(team_id);
