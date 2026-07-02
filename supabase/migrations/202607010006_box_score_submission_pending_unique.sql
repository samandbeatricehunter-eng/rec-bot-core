-- Concurrent box-score uploads for the same scheduled game currently race:
-- clearStalePendingForGame() does a read-then-write supersede pass before the new
-- row is inserted, so two uploads landing at the same time can both see zero
-- pending rows and both insert, leaving two live "pending" submissions for one
-- game. box-score.service.ts already handles a 23505 conflict on this insert
-- (throws a 409 "already pending" ApiError) — this constraint is what's meant to
-- trigger it; it was just missing.
create unique index if not exists rec_box_score_submissions_pending_game_idx
  on public.rec_box_score_submissions(game_id)
  where status = 'pending' and game_id is not null;
