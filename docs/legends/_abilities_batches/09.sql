UPDATE rec_legend_catalog AS c
SET abilities = v.abilities
FROM (VALUES
  ('Wesley Walker', '[{"name":"Juke Box","description":"Mapped from 2K8 skill ''Magic Feet''.","type":"superstar"},{"name":"Deep Out Elite","description":"Mapped from 2K8 skill ''Deep Threat''.","type":"superstar"},{"name":"Return Man","description":"Mapped from 2K8 skill ''Return Spec''.","type":"superstar"}]'::jsonb),
  ('Willie Gault', '[{"name":"Deep Out Elite","description":"Mapped from 2K8 skill ''Deep Threat''.","type":"superstar"},{"name":"Racetrack","description":"Mapped from 2K8 skill ''Speed Burner''.","type":"superstar"}]'::jsonb),
  ('Yancey Thigpen', '[{"name":"Possession Catch","description":"Mapped from 2K8 skill ''Soft Hands''.","type":"superstar"}]'::jsonb)
) AS v(name, abilities)
WHERE c.name = v.name;