-- The tweet queue is now shared by several independent generators (weekly stat recaps, contract
-- signings, Media Day player tweets/roundups/backfires, and upcoming ambient fan chatter) --
-- generateAndQueueImmortalityTweets used to clear every still-"pending" row for the league before
-- queuing its own fresh batch, which would silently wipe out other generators' not-yet-posted
-- tweets. A source tag lets each generator only ever clear/manage its own rows.
alter table public.rec_immortality_tweet_queue add column if not exists source text;
create index if not exists rec_immortality_tweet_queue_source_idx
  on public.rec_immortality_tweet_queue (league_id, source, status);
