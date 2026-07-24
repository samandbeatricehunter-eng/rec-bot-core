-- Lets a box-score submission end a still-"live" stream early (read-time live filter is
-- `posted_at >= now() - 2h AND ended_at is null`, extended here from the existing 2-hour-only
-- window). No other schema change needed: rec_stream_payout_reviews / rec_commissioners_inbox
-- already have the shape required for site-submitted-stream payout parity with Discord.
alter table public.rec_stream_compliance_logs add column if not exists ended_at timestamptz;
