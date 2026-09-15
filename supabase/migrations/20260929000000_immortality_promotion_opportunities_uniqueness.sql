-- Dev Promotion Overhaul (P0, DEV-005): a normal (non-unique) index already existed on
-- (prospect_id, status), but nothing at the DB level stopped two pending opportunities from
-- existing for the same prospect if import/advance/retry raced past the application-level
-- pre-insert check in evaluateSeasonTrendPromotionsAfterAdvance. This is the actual guard.
create unique index if not exists rec_immortality_promotion_opportunities_pending_uidx
  on public.rec_immortality_promotion_opportunities (prospect_id)
  where status = 'pending';

-- Makes target-game opportunity creation idempotent too: a retried/duplicate advance pass for
-- the same target week can no longer insert a second row, even once the first has already moved
-- past 'pending' (met/missed), which the partial index above doesn't cover on its own.
create unique index if not exists rec_immortality_promotion_opportunities_target_uidx
  on public.rec_immortality_promotion_opportunities (prospect_id, target_season_number, target_week_number);
