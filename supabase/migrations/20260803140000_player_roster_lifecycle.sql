-- Player roster lifecycle: status (active/departed) + reason, class year, and a real
-- "came from the baseline seed" flag. Prerequisite for the Team Roster viewer, offseason
-- roster-lifecycle logging (players_leaving/transfer_portal/offseason_phase stages), and the
-- later purchase-menu restriction that blocks upgrades/edits on default (baseline) players.
--
-- roster_status distinguishes WHY a player left, not just that they left, so the roster
-- viewer and lifecycle log can show "drafted" vs "transferred out" vs "retired" instead of a
-- single generic "inactive". transferred_in exists for players logged as arriving via the
-- transfer portal (always is_default_player = false — they're not part of the original seed).
alter table public.rec_players
  add column if not exists class_year text check (class_year in ('FR', 'SO', 'JR', 'SR')),
  add column if not exists roster_status text not null default 'active' check (roster_status in (
    'active', 'drafted', 'transferred_out', 'transferred_in', 'retired', 'graduated'
  )),
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_note text,
  add column if not exists is_default_player boolean not null default false;

-- Backfill class_year for already-seeded rows from the baseline import's raw_payload.
update public.rec_players
set class_year = raw_payload ->> 'year'
where class_year is null
  and raw_payload ? 'year'
  and raw_payload ->> 'year' in ('FR', 'SO', 'JR', 'SR');

-- Mark already-seeded baseline players as default/protected (madden_player_id carries the
-- "cfb27:" prefix set by applyCfbBaselineToLeague — see cfb-baseline.service.ts).
update public.rec_players
set is_default_player = true
where madden_player_id like 'cfb27:%';

create index if not exists rec_players_league_status_idx on public.rec_players(league_id, roster_status);
create index if not exists rec_players_league_team_idx on public.rec_players(league_id, team_id);
