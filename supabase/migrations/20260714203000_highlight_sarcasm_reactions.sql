alter table public.rec_highlight_reactions
  drop constraint if exists rec_highlight_reactions_reaction_key_check;

alter table public.rec_highlight_reactions
  add constraint rec_highlight_reactions_reaction_key_check
  check (
    reaction_key in (
      'like',
      'dislike',
      'TOTY',
      'COTY',
      'ROTY',
      'IOTY',
      'HOTY',
      'COOKED',
      'SKILL_ISSUE',
      'CLIPPED',
      'NO_SHOT',
      'GG_ENERGY',
      'AURA'
    )
  );
