-- Preseason/offseason stories are associated with a season stage rather than a gameplay week.
-- The API has intentionally written NULL for these stories since season-stage support landed.
alter table public.rec_game_stories
  alter column week drop not null;
