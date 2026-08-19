-- proposeTime's withdraw-old-then-insert-new sequence is read-then-write, not atomic: two
-- near-simultaneous propose calls (double-click, a Discord interaction retry) could both see
-- "no pending proposal" and both insert one, leaving two permanently-orphaned pending rows since
-- every read path only ever looks at the single newest one. A partial unique index turns that
-- race into a clean insert failure the app can catch, instead of silent duplicate data.
create unique index if not exists rec_game_time_proposals_one_pending_uidx
  on public.rec_game_time_proposals (game_id) where status = 'pending';
