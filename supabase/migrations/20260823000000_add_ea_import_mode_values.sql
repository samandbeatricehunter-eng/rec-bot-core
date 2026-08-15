-- Add madden_companion_import to rec_import_mode so EA schedule sync works.
do $$ begin
  alter type public.rec_import_mode add value if not exists 'madden_companion_import';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_import_mode add value if not exists 'madden_direct_sync';
exception when duplicate_object then null;
end $$;
