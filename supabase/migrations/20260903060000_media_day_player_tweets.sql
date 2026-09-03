-- Media Day answers now post as one bulk tweet per player (in the player's own voice) instead
-- of a per-answer headline story, so the tweet queue needs a "player" author kind alongside the
-- existing generic fan accounts and named hosts.
alter table public.rec_immortality_tweet_queue drop constraint if exists rec_immortality_tweet_queue_author_kind_check;
alter table public.rec_immortality_tweet_queue add constraint rec_immortality_tweet_queue_author_kind_check
  check (author_kind in ('host', 'generic', 'player'));
