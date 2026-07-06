-- Luke Kuechly was missing from the Madden legend catalog's LB group.
insert into public.rec_legend_catalog
  (name, position, position_group, est_ovr, height, weight, hand, jersey_number, dev_trait, archetype, build_note, game_scope, attributes)
values
('Luke Kuechly', 'LB', 'defense', 88.3, '6''3"', 238, 'Right', 59, 'Superstar', 'Diagnose-and-destroy MLB',
 'Best pre-snap read-and-react instincts of his generation; elite zone range and tackling with slightly lighter power-rusher traits than pure enforcers.',
 'madden',
 '{"Speed":89,"Acceleration":90,"Agility":89,"Change of Direction":89,"Strength":86,"Awareness":99,"Toughness":92,"Injury":88,"Stamina":96,"Jumping":86,"Carrying":82,"BC Vision":78,"Break Tackle":80,"Trucking":78,"Stiff Arm":78,"Juke Move":74,"Spin Move":70,"Catching":80,"Catch in Traffic":78,"Spectacular Catch":76,"Release":52,"Short Route Running":58,"Medium Route Running":54,"Deep Route Running":48,"Throwing Power":50,"Short Accuracy":25,"Medium Accuracy":20,"Deep Accuracy":15,"Throw on the Run":20,"Throw Under Pressure":20,"Break Sack":74,"Play Action":25,"Pass Blocking":30,"Run Blocking":42,"Impact Blocking":84,"Lead Block":38,"Run Block Power":40,"Run Block Finesse":38,"Pass Block Power":28,"Pass Block Finesse":25,"Tackling":96,"Hit Power":90,"Pursuit":96,"Play Recognition":99,"Block Shedding":88,"Power Moves":74,"Finesse Moves":78,"Man Coverage":88,"Zone Coverage":92,"Press":76,"Kick/Punt Return":20,"Kicking Power":20,"Kicking Accuracy":15,"Long Snap":40}'::jsonb)
on conflict (name, position, game_scope) do update set
  position_group = excluded.position_group, est_ovr = excluded.est_ovr, height = excluded.height,
  weight = excluded.weight, hand = excluded.hand, jersey_number = excluded.jersey_number,
  dev_trait = excluded.dev_trait, archetype = excluded.archetype, build_note = excluded.build_note,
  attributes = excluded.attributes;
