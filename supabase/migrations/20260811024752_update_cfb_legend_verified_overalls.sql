update public.rec_legend_catalog
set est_ovr = case name
  when 'Vernon Davis' then 96
  when 'Barry Sanders' then 95
  when 'Randy Moss' then 93
  when 'Deion Sanders' then 94
end
where game_scope = 'cfb_27'
  and name in ('Vernon Davis', 'Barry Sanders', 'Randy Moss', 'Deion Sanders');
