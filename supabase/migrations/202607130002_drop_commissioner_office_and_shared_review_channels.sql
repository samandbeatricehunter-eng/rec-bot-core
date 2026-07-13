-- Removes the Discord channel-linking settings for Commissioner's Office, Pending Payouts,
-- and Pending Purchases. Team requests and active checks (the two things that posted to
-- Commissioner's Office) and all six review types that posted to Pending Payouts/Purchases
-- (purchases, EOS payouts, wagers, streams, highlights, box scores, and weekly score reviews)
-- already dual-write to rec_commissioners_inbox, which now fully powers the web dashboard's
-- Notifications feed — the Discord channel routing was redundant.
alter table public.rec_server_routes
  drop column if exists commissioner_office_channel_id,
  drop column if exists pending_payouts_channel_id,
  drop column if exists pending_purchases_channel_id;
