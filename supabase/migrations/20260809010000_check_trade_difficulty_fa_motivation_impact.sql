-- trade_difficulty is Madden-only (26 & 27) — CFB has no in-game trade-difficulty slider.
-- free_agent_motivation_impact is Madden 26 only — it does not exist in Madden 27 or CFB.
-- Both columns were added by 20260808000000 without a CHECK constraint, unlike every other
-- enum-shaped column on this table; add matching constraints now.
alter table public.rec_league_configuration
  add constraint rec_league_configuration_trade_difficulty_check
    check (trade_difficulty is null or trade_difficulty = any (array['very_easy','easy','normal','hard','very_hard'])),
  add constraint rec_league_configuration_free_agent_motivation_impact_check
    check (free_agent_motivation_impact is null or free_agent_motivation_impact = any (array['off','normal','high','very_high']));
