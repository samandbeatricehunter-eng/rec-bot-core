-- Seed rec_global_user_game_records (madden_26) from legacy baselines so the
-- "Global (Madden NFL 26)" field in /menu starts with each user's carry-over stats
-- rather than 0-0-0. Only inserts for users who have a baseline but no existing
-- madden_26 game record row.
insert into public.rec_global_user_game_records (
  user_id,
  game,
  wins,
  losses,
  ties,
  playoff_wins,
  playoff_losses,
  superbowl_wins,
  superbowl_losses,
  points_for,
  points_against,
  point_differential,
  games_played,
  avg_point_differential,
  updated_at
)
select
  b.user_id,
  'madden_26',
  coalesce((b.global_record->>'wins')::integer, 0),
  coalesce((b.global_record->>'losses')::integer, 0),
  coalesce((b.global_record->>'ties')::integer, 0),
  coalesce((b.global_record->>'playoff_wins')::integer, 0),
  coalesce((b.global_record->>'playoff_losses')::integer, 0),
  coalesce((b.global_record->>'superbowl_wins')::integer, 0),
  coalesce((b.global_record->>'superbowl_losses')::integer, 0),
  coalesce((b.global_record->>'points_for')::integer, 0),
  coalesce((b.global_record->>'points_against')::integer, 0),
  coalesce((b.global_record->>'point_differential')::integer, 0),
  coalesce((b.global_record->>'games_played')::integer, 0),
  case
    when coalesce((b.global_record->>'games_played')::integer, 0) > 0
    then round(
      coalesce((b.global_record->>'point_differential')::numeric, 0)
      / (b.global_record->>'games_played')::numeric,
      2
    )
    else 0
  end,
  now()
from public.rec_legacy_user_baselines b
where b.global_record is not null
  and not exists (
    select 1
    from public.rec_global_user_game_records g
    where g.user_id = b.user_id
      and g.game = 'madden_26'
  );
