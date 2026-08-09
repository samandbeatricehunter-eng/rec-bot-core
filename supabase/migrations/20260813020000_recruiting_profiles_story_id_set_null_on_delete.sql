-- rec_recruiting_profiles.story_id is an optional back-reference to the game story that
-- introduced/announced a recruit. It previously had no ON DELETE action, which blocked the
-- season-rollover story wipe (league-week.service.ts) with a foreign key violation whenever
-- a story being cleared was still referenced by a recruiting profile. The reference is
-- optional metadata, not something that should block or cascade-delete the profile.
alter table public.rec_recruiting_profiles
  drop constraint rec_recruiting_profiles_story_id_fkey,
  add constraint rec_recruiting_profiles_story_id_fkey
    foreign key (story_id) references public.rec_game_stories(id) on delete set null;
