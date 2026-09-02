-- Last-seen team_id per rec_players row for an RTI league, used to diff "what changed since the
-- last import" for the Roster Movement auto-post (see
-- apps/api/src/modules/immortality/roster-movement.service.ts). An empty snapshot means "never
-- diffed yet" -- the first run after this column exists just seeds it without posting, so the
-- league's entire initial roster import doesn't get announced as a flood of signings.
alter table public.rec_immortality_leagues
  add column if not exists roster_movement_snapshot jsonb not null default '{}'::jsonb;
