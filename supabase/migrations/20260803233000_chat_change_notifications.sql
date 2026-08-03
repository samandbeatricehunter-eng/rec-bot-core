-- Cross-instance chat invalidation. Each API instance LISTENs on this PostgreSQL channel
-- and reconciles only when a chat row changes; this replaces high-frequency client polling.

create or replace function public.rec_notify_chat_change()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  source_row jsonb;
  channel_type text;
  channel_id text;
begin
  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name = 'rec_league_chat_messages' then
    channel_type := 'league';
    channel_id := source_row ->> 'league_id';
  elsif tg_table_name = 'rec_game_chat_messages' then
    channel_type := 'game';
    channel_id := source_row ->> 'game_channel_id';
  elsif tg_table_name = 'rec_commissioner_chat_messages' then
    channel_type := 'commissioner';
    channel_id := source_row ->> 'guild_id';
  else
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_notify(
    'rec_chat_changes',
    json_build_object('channelType', channel_type, 'channelId', channel_id)::text
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.rec_notify_chat_change() from public, anon, authenticated;
grant execute on function public.rec_notify_chat_change() to service_role;

drop trigger if exists trg_rec_league_chat_notify on public.rec_league_chat_messages;
create trigger trg_rec_league_chat_notify
after insert or update or delete on public.rec_league_chat_messages
for each row execute function public.rec_notify_chat_change();

drop trigger if exists trg_rec_game_chat_notify on public.rec_game_chat_messages;
create trigger trg_rec_game_chat_notify
after insert or update or delete on public.rec_game_chat_messages
for each row execute function public.rec_notify_chat_change();

drop trigger if exists trg_rec_commissioner_chat_notify on public.rec_commissioner_chat_messages;
create trigger trg_rec_commissioner_chat_notify
after insert or update or delete on public.rec_commissioner_chat_messages
for each row execute function public.rec_notify_chat_change();
