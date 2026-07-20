create index rec_matchup_chat_messages_league_idx
  on public.rec_matchup_chat_messages (league_id);

create index rec_matchup_chat_messages_author_idx
  on public.rec_matchup_chat_messages (author_user_id);
