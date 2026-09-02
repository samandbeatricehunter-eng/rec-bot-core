-- Tracks the Discord message a prospect's "player card" infographic was posted as, so it can be
-- edited in place (new render, same message) as real data comes in -- e.g. once the league's
-- first EA import gives the prospect a real overall rating -- instead of reposting fresh every
-- time and spamming the offensive-pros/defensive-pros channel.
alter table public.rec_immortality_prospects
  add column if not exists card_channel_id text,
  add column if not exists card_message_id text;
