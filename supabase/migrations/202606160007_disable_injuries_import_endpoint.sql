update public.rec_import_endpoint_catalog
set enabled = false,
    default_selected = false,
    experimental = false,
    endpoint_group = 'disabled',
    notes = 'Injury data is present in roster payloads; derive injury updates from roster imports instead of a separate EA injuries feed.',
    updated_at = now()
where endpoint_key = 'injuries';
