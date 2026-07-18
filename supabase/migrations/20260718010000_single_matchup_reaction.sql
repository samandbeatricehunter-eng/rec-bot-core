-- A user may select one standard matchup reaction plus an independent GOTY vote.
-- Retain the most recent standard reaction when cleaning up pre-existing duplicates.
with ranked_standard_reactions as (
  select
    id,
    row_number() over (
      partition by game_id, user_id
      order by created_at desc, id desc
    ) as reaction_rank
  from public.rec_game_reactions
  where reaction_key in ('love', 'like', 'dislike', 'poop')
)
delete from public.rec_game_reactions reactions
using ranked_standard_reactions ranked
where reactions.id = ranked.id
  and ranked.reaction_rank > 1;

create unique index if not exists rec_game_reactions_game_user_standard_key
  on public.rec_game_reactions(game_id, user_id)
  where reaction_key in ('love', 'like', 'dislike', 'poop');
