-- Prevent duplicate stream payout reviews for the same user/week while allowing
-- a denied review to be replaced by a fresh submission.
create unique index if not exists rec_stream_payout_reviews_one_active_week_key
  on public.rec_stream_payout_reviews (league_id, user_id, season_number, week_number)
  where status in ('pending', 'approved', 'issued');

-- Prevent multiple paid/approved box-score submissions from issuing for one
-- scheduled game. Unmatched commissioner-approved submissions are excluded.
create unique index if not exists rec_box_score_submissions_one_paid_game_key
  on public.rec_box_score_submissions (game_id)
  where game_id is not null and status = 'approved' and payout_issued = true;

-- Also prevent duplicate active reviews for the same scheduled game. Denied
-- submissions can be replaced by a corrected upload.
create unique index if not exists rec_box_score_submissions_one_active_game_key
  on public.rec_box_score_submissions (game_id)
  where game_id is not null and status in ('pending', 'approved');
