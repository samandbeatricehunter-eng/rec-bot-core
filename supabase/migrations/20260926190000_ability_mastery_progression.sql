-- Archetype-locked mandatory abilities (2 Superstar + 1 X-Factor) with a later OVR+XP "mastery"
-- unlock that frees them for reassignment. locked/origin let us tell "still mandated by
-- archetype" apart from "freely chosen after mastery," and keep a permanent natural-vs-learned
-- record even after a natural ability gets swapped out post-mastery.
alter table public.rec_immortality_prospect_abilities
  add column if not exists locked boolean not null default false,
  add column if not exists origin text not null default 'learned';

alter table public.rec_immortality_prospect_abilities
  drop constraint if exists rec_immortality_prospect_abilities_origin_check;
alter table public.rec_immortality_prospect_abilities
  add constraint rec_immortality_prospect_abilities_origin_check
  check (origin in ('natural', 'learned'));

alter table public.rec_immortality_prospects
  add column if not exists ability_mastery_unlocked_at timestamptz,
  add column if not exists xfactor_mastery_unlocked_at timestamptz;
