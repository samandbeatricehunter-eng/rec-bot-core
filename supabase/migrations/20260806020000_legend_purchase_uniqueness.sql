-- Closes a race where two coaches both pass the app-level "already sold?" check for the same
-- one-of-a-kind legend before either purchase commits, ending up with two people owning the
-- same Legend in one league. Real DB-level uniqueness backstop; the app-level pre-check stays
-- as a fast, friendly rejection for the common non-racing case.
create unique index if not exists rec_purchases_legend_unique_active
  on public.rec_purchases (league_id, (details->>'legendId'))
  where purchase_type = 'legend' and status in ('pending', 'approved', 'fulfilled');
