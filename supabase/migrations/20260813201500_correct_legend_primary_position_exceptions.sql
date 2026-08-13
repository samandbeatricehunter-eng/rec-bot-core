-- Correct players whose coarse source position did not reflect their primary pro role.
update public.rec_legend_catalog
set position = case name
  when 'Hugh Green' then 'OLB'
  when 'Mike Munchak' then 'OG'
  when 'Randy Cross' then 'C'
  else position
end
where name in ('Hugh Green', 'Mike Munchak', 'Randy Cross');
