-- Atomic conditional increment for promo code redemption counts. The application code
-- previously read redemption_count then wrote redemption_count + 1 as two separate steps —
-- a TOCTOU race where two concurrent redemptions near max_redemptions could both pass the
-- pre-check against the same stale count and over-redeem a capped code. This does the
-- check-and-increment as a single atomic UPDATE; returns true if the increment succeeded
-- (still under the cap), false if the cap was already hit.
create or replace function public.increment_promo_code_redemption(p_promo_code_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  update rec_promo_codes
  set redemption_count = redemption_count + 1, updated_at = now()
  where id = p_promo_code_id
    and (max_redemptions is null or redemption_count < max_redemptions)
  returning true;
$$;

revoke execute on function public.increment_promo_code_redemption(uuid) from public, anon;
grant execute on function public.increment_promo_code_redemption(uuid) to authenticated, service_role;
