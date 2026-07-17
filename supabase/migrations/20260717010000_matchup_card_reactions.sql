alter table public.rec_game_reactions drop constraint if exists rec_game_reactions_reaction_key_check;
alter table public.rec_game_reactions add constraint rec_game_reactions_reaction_key_check check (reaction_key in ('love', 'like', 'goty', 'dislike', 'poop'));
alter table public.rec_game_reactions drop constraint if exists rec_game_reactions_game_user_key;
drop index if exists public.rec_game_reactions_game_user_key;
create unique index if not exists rec_game_reactions_game_user_reaction_key on public.rec_game_reactions(game_id, user_id, reaction_key);
create index if not exists rec_game_reactions_game_reaction_idx on public.rec_game_reactions(game_id, reaction_key);

alter table public.rec_highlight_reactions drop constraint if exists rec_highlight_reactions_reaction_key_check;
alter table public.rec_highlight_reactions add constraint rec_highlight_reactions_reaction_key_check check (
  reaction_key in ('love', 'like', 'dislike', 'poop', 'TOTY', 'COTY', 'ROTY', 'IOTY', 'HOTY', 'MVP_PLAY', 'COOKED', 'SKILL_ISSUE', 'CLIPPED', 'NO_SHOT', 'GG_ENERGY', 'AURA', 'SHEEESH', 'FAWK')
);
