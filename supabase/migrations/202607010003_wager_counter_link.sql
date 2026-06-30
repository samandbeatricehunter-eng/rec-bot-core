-- Peer counter-offers: a counter is its own awaiting_accept wager that links back to
-- the original open/direct challenge it counters. Accepting the counter closes the
-- original; denying leaves the original open.
alter table public.rec_wagers add column if not exists countered_from_wager_id uuid;
create index if not exists rec_wagers_countered_from_idx on public.rec_wagers (countered_from_wager_id);
