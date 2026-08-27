-- Player of the Week payouts have never actually credited a wallet: creditOrBacklog's
-- add_to_wallet RPC takes p_source typed as rec_source_type, and "player_of_week" was never a
-- member of that enum, so every payout attempt failed at the database layer before ever writing
-- to rec_dollar_ledger -- confirmed directly, zero ledger rows exist for any Player of the Week
-- award ever issued, despite rec_player_of_week_awards.coins_awarded showing the intended amount.
alter type public.rec_source_type add value if not exists 'player_of_week';
