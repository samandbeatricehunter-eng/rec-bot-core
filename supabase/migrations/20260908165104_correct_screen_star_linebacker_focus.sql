-- "Block shedding" describes defensive play and must not trigger the offensive-
-- blocking keyword adjustment used by the ratings generator.
update public.rec_legend_catalog
set archetype = 'MLB / Tackling + Hit Power',
    attributes = attributes || jsonb_build_object(
      'Run Blocking', greatest(15, (attributes->>'Run Blocking')::int - 3),
      'Pass Blocking', greatest(15, (attributes->>'Pass Blocking')::int - 3),
      'Impact Blocking', greatest(15, (attributes->>'Impact Blocking')::int - 3),
      'Run Block Power', greatest(15, (attributes->>'Run Block Power')::int - 3),
      'Pass Block Power', greatest(15, (attributes->>'Pass Block Power')::int - 3)
    )
where legend_tier = 'celebs_couldve_beens'
  and store_subgroup = 'screen_star'
  and name in ('Bobby Boucher', 'O''Shea Jackson');
