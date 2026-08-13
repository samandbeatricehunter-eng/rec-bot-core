-- Backfill null Madden roster traits from the EA-authoritative baseline dataset.
-- Leagues seeded before the EA crossref (or before baseline traits were populated)
-- kept null/default-normal faces, so X-Factor / Superstar badges never showed.

update public.rec_players p
set
  dev_trait = b.dev_trait,
  updated_at = now()
from public.rec_madden_baseline_players b
where p.madden_player_id = 'madden27:' || b.source_slug
  and p.dev_trait is null
  and b.dev_trait is not null;
