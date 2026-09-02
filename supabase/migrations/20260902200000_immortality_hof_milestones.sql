-- Tracks the Discord message backing each prospect's HOF Milestones career-stats card so it can
-- be edited in place (rather than reposted) as their totals change every advance -- same
-- tracking pattern as card_channel_id/card_message_id for the prospect card itself.
alter table public.rec_immortality_prospects
  add column if not exists hof_channel_id text,
  add column if not exists hof_message_id text;
