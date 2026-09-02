-- Rise to Immortality-specific Discord channel routes (interviews, tweets, power rankings,
-- player of the week, roster movement, finalized trades, league leaders, record holders,
-- owners chat). Trade block, availability, and game channels category already exist and apply
-- to RTI leagues automatically since RTI is Madden-based.
alter table public.rec_server_routes
  add column if not exists interviews_channel_id text,
  add column if not exists tweets_channel_id text,
  add column if not exists power_rankings_channel_id text,
  add column if not exists player_of_the_week_channel_id text,
  add column if not exists roster_movement_channel_id text,
  add column if not exists finalized_trades_channel_id text,
  add column if not exists league_leaders_channel_id text,
  add column if not exists record_holders_channel_id text,
  add column if not exists owners_chat_channel_id text;
