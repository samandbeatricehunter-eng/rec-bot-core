-- These players remain available through normal Madden rosters but are not eligible for the
-- purchasable REC legend catalog.
delete from public.rec_legend_catalog
where name in (
  'Joe Burrow',
  'Christian McCaffrey',
  'Derrick Henry',
  'Baker Mayfield',
  'Deshaun Watson',
  'Johnny Manziel',
  'Kyle Pitts',
  'Vernon Davis',
  'Amari Cooper',
  'DeVonta Smith',
  'Ja''Marr Chase',
  'Justin Blackmon',
  'Marvin Harrison Jr.'
);
