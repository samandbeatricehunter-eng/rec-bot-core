-- Per-league "data mode": how this league's game results/stats/rosters get entered.
alter table public.rec_league_configuration
  add column if not exists data_mode text not null default 'box_scores';

alter table public.rec_league_configuration
  add constraint rec_league_configuration_data_mode_check
  check (data_mode = any (array['import', 'box_scores', 'manual']));

-- Backfill existing leagues by game type: Madden leagues default to import (EA pipeline
-- exists), everything else (CFB has no import pipeline) defaults to box_scores.
update public.rec_league_configuration c
set data_mode = case when l.game like 'madden_%' then 'import' else 'box_scores' end
from public.rec_leagues l
where c.league_id = l.id;
