-- Bot-posted payout ledger embed in the box scores channel (distinct from the user's screenshot message).
alter table public.rec_box_score_submissions
  add column if not exists ledger_discord_message_id text;
