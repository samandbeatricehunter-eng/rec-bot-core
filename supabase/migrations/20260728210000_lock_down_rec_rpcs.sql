-- The application intentionally accesses public data only through the API's service-role
-- client. PostgreSQL grants EXECUTE on new functions to PUBLIC by default, which turns
-- every public REC RPC into an unnecessary Data API surface even when table RLS blocks it.
do $$
declare
  fn record;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'rec\_%' escape '\' or p.proname = 'add_to_wallet')
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );
  end loop;
end
$$;
