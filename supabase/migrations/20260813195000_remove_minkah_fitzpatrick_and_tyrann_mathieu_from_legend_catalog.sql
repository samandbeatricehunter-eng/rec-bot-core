-- These players remain available through normal Madden rosters but are not
-- eligible for the purchasable REC legend catalog.
delete from public.rec_legend_catalog
where id in (
  '019a0c9f-ed54-4a91-a707-dbddbbbddaf6',
  '169523d1-9943-461d-bab6-08ed0dd0e563'
)
or lower(name) in (
  lower('Minkah Fitzpatrick'),
  lower('Tyrann Mathieu')
);
