alter table public.rec_server_routes
  add column if not exists main_chat_channel_id text;

alter table public.rec_league_chat_messages
  add column if not exists source text not null default 'site',
  add column if not exists discord_message_id text;

create unique index if not exists rec_league_chat_messages_discord_message_id_key
  on public.rec_league_chat_messages (discord_message_id)
  where discord_message_id is not null;

update public.rec_server_routes routes
set main_chat_channel_id = '1519418258132828370',
    updated_at = now()
from public.rec_server_league_links link
join public.rec_leagues league on league.id = link.league_id
where routes.server_id = link.server_id
  and link.is_primary = true
  and league.name = 'REC OG'
  and league.game = 'cfb_27';
