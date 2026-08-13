-- Jonathan Allen remains available through normal Madden rosters but is not
-- eligible for the purchasable REC legend catalog.
delete from public.rec_legend_catalog
where id = '9fc2a69f-f175-4786-a55b-d3a35ff9ce0a'
   or lower(name) = lower('Jonathan Allen');
