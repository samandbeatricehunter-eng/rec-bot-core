-- New Discord channel routes for the settings-tab rework: Ways to Get Paid (persistent
-- per-item embeds, updated in place when payout config changes), Weekly Transactions
-- (per-team-per-advance XP/coin summary embeds), Matchup Breakdowns (per-matchup analytical
-- embeds, wiped and reposted every advance -- content that used to render inline on the
-- game-channel matchup card), and Matchup Tracker (private commissioner/co-commissioner
-- channel replacing the per-user scheduling-status embeds that used to post to announcements).
alter table public.rec_server_routes
  add column if not exists ways_to_get_paid_channel_id text,
  add column if not exists weekly_transactions_channel_id text,
  add column if not exists matchup_breakdowns_channel_id text,
  add column if not exists matchup_tracker_channel_id text;
