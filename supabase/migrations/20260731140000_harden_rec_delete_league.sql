-- Delete every league-scoped table by its canonical league_id.
-- The previous implementation used a hand-maintained table list while disabling FK
-- triggers, which left newer league tables orphaned after a league was deleted.
create or replace function public.rec_delete_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_count int;
  v_total int := 0;
  v_deleted jsonb := '{}'::jsonb;
begin
  if p_league_id is null then
    raise exception 'p_league_id is required';
  end if;

  set local session_replication_role = 'replica';

  for v_table in
    select distinct c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'league_id'
      and a.attnum > 0
      and not a.attisdropped
      and c.relname <> 'rec_leagues'
    order by c.relname
  loop
    execute format('delete from public.%I where league_id = $1', v_table) using p_league_id;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_deleted := v_deleted || jsonb_build_object(v_table, v_count);
      v_total := v_total + v_count;
    end if;
  end loop;

  delete from public.rec_leagues where id = p_league_id;
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'league_id', p_league_id,
    'rows_deleted', v_total,
    'league_deleted', (v_count > 0),
    'tables', v_deleted
  );
end;
$$;
