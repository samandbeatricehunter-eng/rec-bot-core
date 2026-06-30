-- A user may only have one pending stream payout review at a time in a league.
-- Denied or issued reviews do not block later stream submissions.
create unique index if not exists rec_stream_payout_reviews_one_pending_user_key
  on public.rec_stream_payout_reviews (league_id, user_id)
  where status = 'pending';
