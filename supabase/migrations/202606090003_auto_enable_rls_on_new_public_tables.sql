-- Automatically enable Row Level Security on every new table created in the
-- public schema, so no future migration can accidentally ship an exposed table.
-- The API uses the service role, which bypasses RLS, so this is transparent to it.
-- Applied to remote 2026-06-09.
create or replace function public.enforce_rls_on_new_tables()
returns event_trigger
language plpgsql
as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE TABLE'
  loop
    if obj.schema_name = 'public' then
      execute format('alter table %s enable row level security', obj.object_identity);
    end if;
  end loop;
end;
$$;

drop event trigger if exists trg_enforce_rls_on_new_tables;
create event trigger trg_enforce_rls_on_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.enforce_rls_on_new_tables();
