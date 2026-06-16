update public.rec_import_endpoint_catalog
set enabled = false,
    default_selected = false,
    experimental = false,
    endpoint_group = 'disabled',
    notes = 'Madden does not export in-game league news; keep REC news out of normal imports.',
    updated_at = now()
where endpoint_key = 'news';
