-- Body type assignment rule (weight-primary, position tie-break for overlapping bands):
--   <180 lb            -> lean
--   180-209 lb         -> lean for skill/speed positions (WR, DB), else standard
--   210-236 lb         -> muscular for power positions (LB, DL, OL, FB, TE), thin for WR, else standard
--   237-279 lb         -> muscular (only bucket covering this band)
--   >=280 lb           -> heavy for line positions (OL, DL), else muscular
update public.rec_legend_catalog set body_type = case
  when weight is null then null
  when weight < 180 then 'lean'
  when weight between 180 and 209 then (case when position in ('WR','DB') then 'lean' else 'standard' end)
  when weight between 210 and 236 then (case when position in ('LB','DL','OL','FB','TE') then 'muscular' when position = 'WR' then 'thin' else 'standard' end)
  when weight between 237 and 279 then 'muscular'
  else (case when position in ('OL','DL') then 'heavy' else 'muscular' end)
end;
