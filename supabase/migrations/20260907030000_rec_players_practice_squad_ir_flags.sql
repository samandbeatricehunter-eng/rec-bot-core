-- EA's Companion export carries isOnPracticeSquad/isOnIR flags on every roster row that
-- rec_players never captured before (only is_free_agent, per the free_agents-dataset import,
-- existed). Needed to tell a real trade apart from a routine practice-squad signing/release,
-- and to post public "placed on IR" headlines -- see roster-movement.service.ts.
alter table public.rec_players
  add column if not exists is_on_practice_squad boolean not null default false,
  add column if not exists is_on_ir boolean not null default false;
