-- add_to_wallet stamps p_source with a rec_source_type; wager holds/refunds/payouts
-- need the 'wager' source value.
alter type public.rec_source_type add value if not exists 'wager';
