-- generateCfpBracket/synchronizeCfpBracket insert rec_games rows with source='cfp_bracket',
-- but that value was never added to the rec_source_type enum used elsewhere for rec_games.source
-- (only 'gotw', 'wager', etc. exist) — every CFP bracket generation was throwing a raw
-- (unwrapped) Postgres "invalid input value for enum" error, surfaced to users as a generic
-- 500 Internal server error.
alter type public.rec_source_type add value if not exists 'cfp_bracket';
