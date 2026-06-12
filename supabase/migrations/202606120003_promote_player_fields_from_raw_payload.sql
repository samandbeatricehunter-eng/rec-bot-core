-- Promote high-value decoded EA fields from rec_players.raw_payload into typed columns
-- so cap-assistant / power-rankings / badges / awards can query them directly.
alter table public.rec_players
  add column if not exists scheme smallint,
  add column if not exists years_pro smallint,
  add column if not exists resign_status smallint,
  add column if not exists contract_years_left smallint,
  add column if not exists contract_salary bigint,
  add column if not exists cap_hit bigint,
  add column if not exists cap_release_penalty bigint,
  add column if not exists cap_release_net_savings bigint,
  add column if not exists is_free_agent boolean,
  add column if not exists is_xfactor boolean,
  add column if not exists ability_count smallint;

update rec_players set
  scheme                  = nullif(raw_payload->>'scheme','')::smallint,
  years_pro               = nullif(raw_payload->>'yearsPro','')::smallint,
  resign_status           = nullif(raw_payload->>'reSignStatus','')::smallint,
  contract_years_left     = nullif(raw_payload->>'contractYearsLeft','')::smallint,
  contract_salary         = nullif(raw_payload->>'contractSalary','')::bigint,
  cap_hit                 = nullif(raw_payload->>'capHit','')::bigint,
  cap_release_penalty     = nullif(raw_payload->>'capReleasePenalty','')::bigint,
  cap_release_net_savings = nullif(raw_payload->>'capReleaseNetSavings','')::bigint,
  is_free_agent           = (raw_payload->>'isFreeAgent')::boolean,
  is_xfactor              = nullif(raw_payload->>'devTrait','')::int = 3,
  ability_count           = (select count(*)::smallint from jsonb_array_elements(
                              case when jsonb_typeof(raw_payload->'signatureSlotList')='array'
                                   then raw_payload->'signatureSlotList' else '[]'::jsonb end) s
                              where (s->>'isEmpty')='false'),
  overall_rating          = coalesce(overall_rating, nullif(raw_payload->>'playerBestOvr','')::int,
                                     nullif(raw_payload->>'playerSchemeOvr','')::int)
where raw_payload is not null;

-- RLS already enabled (2026-06-09 backfill); included for portability.
alter table public.rec_players enable row level security;
