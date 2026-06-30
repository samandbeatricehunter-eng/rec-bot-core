-- EOS payouts use the shared wallet helper with their own source tag.
alter type public.rec_source_type add value if not exists 'eos';
