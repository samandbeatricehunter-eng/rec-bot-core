-- These players remain available through normal Madden rosters but are not
-- eligible for the purchasable REC legend catalog.
delete from public.rec_legend_catalog
where id in (
  '8614599c-fbbd-4682-8e25-51c46d658de6',
  '0b419c06-b165-481e-8922-0d48b5d5104c'
)
or lower(name) in (
  lower('Chase Young'),
  lower('Will Anderson Jr.')
);
