create or replace function public.apply_adjusted_custom_player_build(
  p_build_id uuid,
  p_reviewer_discord_id text,
  p_review_note text,
  p_identity jsonb,
  p_attributes jsonb,
  p_evaluation jsonb,
  p_estimated_ovr_raw numeric,
  p_estimated_ovr integer,
  p_linear_score numeric,
  p_attribute_points_spent integer,
  p_development_points_spent integer,
  p_creation_points_spent integer,
  p_creation_points_remaining integer,
  p_unused_cp_refund_coins integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_build public.rec_custom_player_builds%rowtype;
  v_result jsonb;
  v_safe_changes jsonb := coalesce(p_changes, '[]'::jsonb);
begin
  if jsonb_typeof(v_safe_changes) is distinct from 'array' then
    v_safe_changes := '[]'::jsonb;
  end if;

  select * into v_build from public.rec_custom_player_builds where id = p_build_id for update;
  if not found then raise exception 'Custom-player build not found'; end if;
  if v_build.status <> 'pending_review' then raise exception 'Custom-player build is already %', v_build.status; end if;
  if p_estimated_ovr_raw > 88 then raise exception 'Custom-player raw OVR cannot exceed 88'; end if;

  update public.rec_custom_player_builds set identity = p_identity,
    inferred_archetype_key = coalesce(nullif(p_evaluation->>'inferredArchetypeKey', ''), inferred_archetype_key),
    attributes = p_attributes, evaluation = p_evaluation,
    estimated_ovr_raw = p_estimated_ovr_raw, estimated_ovr = p_estimated_ovr,
    linear_score = p_linear_score, attribute_points_spent = p_attribute_points_spent,
    development_points_spent = p_development_points_spent, creation_points_spent = p_creation_points_spent,
    creation_points_remaining = p_creation_points_remaining, unused_cp_refund_coins = p_unused_cp_refund_coins,
    updated_at = now()
  where id = p_build_id;

  if jsonb_array_length(v_safe_changes) > 0 then
    insert into public.rec_custom_player_audit_log
      (build_id, action, actor_discord_id, previous_status, next_status, details)
    values (p_build_id, 'commissioner_adjustments', p_reviewer_discord_id, 'pending_review', 'pending_review',
      jsonb_build_object('changes', v_safe_changes, 'note', p_review_note));
  end if;

  v_result := public.apply_custom_player_build(p_build_id, p_reviewer_discord_id, p_review_note);
  return v_result || jsonb_build_object('commissionerChanges', v_safe_changes);
end;
$$;

revoke all on function public.apply_adjusted_custom_player_build(uuid, text, text, jsonb, jsonb, jsonb, numeric, integer, numeric, integer, integer, integer, integer, integer, jsonb) from public;
grant execute on function public.apply_adjusted_custom_player_build(uuid, text, text, jsonb, jsonb, jsonb, numeric, integer, numeric, integer, integer, integer, integer, integer, jsonb) to service_role;
