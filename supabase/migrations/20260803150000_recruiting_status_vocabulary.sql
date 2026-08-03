-- Replace the recruiting status enum with the vocabulary coaches actually asked for — a
-- pipeline of recruiting stages, not just commit/decommit/flip event outcomes:
-- undecided -> visit_scheduled -> verbal_commit -> hard_commit -> signed, with
-- recruiting_battle (multiple schools actively competing) and committed_elsewhere (left the
-- board for a program outside this league) as side states reachable from any stage.
--
-- Old -> new remap for existing rows: uncommitted/decommitted/withdrawn -> undecided (back to
-- square one), flipped/committed -> verbal_commit (still an in-progress commit, not yet firm),
-- signed stays signed.
alter table public.rec_recruiting_profiles drop constraint if exists rec_recruiting_profiles_status_check;

update public.rec_recruiting_profiles
set status = case status
  when 'uncommitted' then 'undecided'
  when 'decommitted' then 'undecided'
  when 'withdrawn' then 'undecided'
  when 'flipped' then 'verbal_commit'
  when 'committed' then 'verbal_commit'
  else status
end
where status in ('uncommitted', 'decommitted', 'withdrawn', 'flipped', 'committed');

alter table public.rec_recruiting_profiles
  alter column status set default 'undecided',
  add constraint rec_recruiting_profiles_status_check check (status = any (array[
    'undecided', 'visit_scheduled', 'verbal_commit', 'hard_commit', 'signed',
    'recruiting_battle', 'committed_elsewhere'
  ]));
