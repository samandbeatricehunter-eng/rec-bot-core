-- Brock Bowers remains available through the normal Madden roster but is not
-- eligible for the purchasable REC legend catalog.
delete from public.rec_legend_catalog
where id = '6b1c4f2c-373a-4032-8cdd-ea84d37aee0a'
   or lower(name) = lower('Brock Bowers');
