-- Break the shared LG template between Bruce Matthews (technician) and Gene Upshaw (mauler).
update public.rec_legend_catalog
set attributes = attributes || jsonb_build_object(
  'Strength', 94,
  'Speed', 68,
  'Pass Blocking', 99,
  'Pass Block Finesse', 99
)
where name = 'Bruce Matthews' and position = 'LG';

update public.rec_legend_catalog
set attributes = attributes || jsonb_build_object(
  'Strength', 99,
  'Speed', 63,
  'Hit Power', 72,
  'Pass Blocking', 94,
  'Pass Block Finesse', 92,
  'Run Block Power', 99
)
where name = 'Gene Upshaw' and position = 'LG';
