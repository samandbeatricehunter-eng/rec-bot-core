-- Seed in-game ages onto Madden baseline-sourced rec_players from
-- rec_madden_baseline_players. Prefer the baseline age column (authoritative
-- in-game age); fall back to draft-year / years_pro estimates when age was
-- never scraped. Skips legends/immortals/customs and CFB (no age in CFB baseline).

update public.rec_players p
   set age = b.age,
       updated_at = now()
  from public.rec_madden_baseline_players b
 where p.is_default_player
   and p.madden_player_id like 'madden27:%'
   and b.source_slug = substr(p.madden_player_id, 10)
   and b.age is not null
   and (p.age is distinct from b.age);

-- Draft-year fallback for backfilled/placeholder baseline rows with no age.
-- Madden 27 roster year ≈ 2026; typical age ≈ 22 + seasons since draft.
update public.rec_players p
   set age = greatest(21, least(45, 22 + greatest(0, 2026 - b.draft_year))),
       updated_at = now()
  from public.rec_madden_baseline_players b
 where p.is_default_player
   and p.madden_player_id like 'madden27:%'
   and b.source_slug = substr(p.madden_player_id, 10)
   and p.age is null
   and b.age is null
   and b.draft_year is not null
   and b.draft_year between 1995 and 2026;

-- years_pro fallback when draft_year also missing (age ≈ 23 + YP from rated cohort).
update public.rec_players p
   set age = greatest(21, least(45, 23 + coalesce(b.years_pro, p.years_pro))),
       updated_at = now()
  from public.rec_madden_baseline_players b
 where p.is_default_player
   and p.madden_player_id like 'madden27:%'
   and b.source_slug = substr(p.madden_player_id, 10)
   and p.age is null
   and coalesce(b.years_pro, p.years_pro) is not null;
