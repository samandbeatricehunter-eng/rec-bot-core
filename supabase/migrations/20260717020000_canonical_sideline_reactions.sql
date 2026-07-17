-- Replace legacy sideline reaction identifiers with the five reactions shown in the Hub.
-- Old sideline reactions are intentionally discarded; they do not carry award weight.
delete from public.rec_highlight_reactions
where reaction_key in ('COOKED', 'SKILL_ISSUE', 'CLIPPED', 'NO_SHOT', 'GG_ENERGY', 'AURA', 'SHEEESH', 'FAWK');

alter table public.rec_highlight_reactions
  drop constraint if exists rec_highlight_reactions_reaction_key_check;

alter table public.rec_highlight_reactions
  add constraint rec_highlight_reactions_reaction_key_check
  check (
    reaction_key in (
      'love', 'like', 'dislike', 'poop',
      'TOTY', 'COTY', 'ROTY', 'IOTY', 'HOTY', 'MVP_PLAY',
      'MOSSED', 'STEAMROLLER', 'FAWKKKK', 'SNATCHED', 'RIP'
    )
  );
