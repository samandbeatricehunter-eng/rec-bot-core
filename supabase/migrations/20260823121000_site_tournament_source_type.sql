-- Wallet ledger source for site-hosted tournament payouts.
alter type public.rec_source_type add value if not exists 'site_tournament';
