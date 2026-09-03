-- The commissioner-facing /tweets command (postManualImmortalityTweet) can post as a freeform
-- custom handle, not just a named host or one of the generic accounts -- widen the check
-- constraint to allow that author_kind alongside the existing 'host'/'generic'/'player'.
alter table public.rec_immortality_tweet_queue drop constraint if exists rec_immortality_tweet_queue_author_kind_check;
alter table public.rec_immortality_tweet_queue add constraint rec_immortality_tweet_queue_author_kind_check
  check (author_kind in ('host', 'generic', 'player', 'custom'));
