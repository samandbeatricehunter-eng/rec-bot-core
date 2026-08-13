-- Custom Madden players overwrite an existing in-game player. Preserve that selected
-- player's stable EA identifier on the newly-created row so companion imports continue to
-- resolve to the custom player. CFB behavior is unchanged.
create or replace function public.rec_inherit_custom_player_madden_id()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_game_family text;
  v_replacement_player_id uuid;
begin
  if new.custom_player_build_id is null or new.madden_player_id is not null then
    return new;
  end if;
  select game_family, replacement_player_id
    into v_game_family, v_replacement_player_id
  from public.rec_custom_player_builds
  where id = new.custom_player_build_id;
  if v_game_family = 'MADDEN' and v_replacement_player_id is not null then
    select madden_player_id into new.madden_player_id
    from public.rec_players
    where id = v_replacement_player_id
      and league_id = new.league_id
      and team_id = new.team_id;
    if new.madden_player_id is null then
      raise exception 'The selected Madden replacement has no EA player identity';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rec_inherit_custom_player_madden_id on public.rec_players;
create trigger trg_rec_inherit_custom_player_madden_id
before insert on public.rec_players
for each row execute function public.rec_inherit_custom_player_madden_id();

revoke all on function public.rec_inherit_custom_player_madden_id() from public;
grant execute on function public.rec_inherit_custom_player_madden_id() to service_role;
