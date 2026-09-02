-- rec_league_configuration.roster_type is backed by the rec_roster_type enum, which never had
-- rise_to_immortality added to it -- every RTI league creation has failed at this exact insert
-- since the feature was built (confirmed: rec_immortality_leagues has zero rows). Fixes the
-- "We couldn't save league configuration" error on the create-league wizard's final step.
alter type public.rec_roster_type add value if not exists 'rise_to_immortality';
