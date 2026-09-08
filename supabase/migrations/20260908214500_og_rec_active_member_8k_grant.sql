-- One-time 8,000-coin grant to every active member of M27 - The OG REC.
-- add_to_wallet is idempotent on (user, type, source, source_reference).
do $$
declare
  rec record;
begin
  for rec in
    select distinct m.user_id
    from public.rec_league_memberships m
    where m.league_id = 'e342e8bd-71ad-40f6-96f9-2731d702755c'
      and m.status = 'active'
      and m.user_id is not null
  loop
    perform public.add_to_wallet(
      rec.user_id,
      8000,
      'e342e8bd-71ad-40f6-96f9-2731d702755c'::uuid,
      'M27 OG REC active-member grant (8,000 coins)',
      'admin_coin_grant',
      'manual_admin_entry',
      '{"grantKey":"m27_og_rec_active_member_8k"}'::jsonb,
      false
    );
  end loop;
end $$;
