-- Owner interviews need season_stage as part of their identity key, same as
-- rec_immortality_stage_interview_answers does for prospects -- "week_number" alone isn't unique
-- across different offseason stages that can each independently start counting advances from 1
-- (e.g. free_agency advance_index=1 and draft advance_index=1 would otherwise collide). No rows
-- exist yet in this brand-new table, so this is safe before anything depends on the old shape.
alter table public.rec_immortality_owner_interview_answers
  add column if not exists season_stage text not null default 'regular_season';

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.rec_immortality_owner_interview_answers'::regclass
    and contype = 'u';
  if cname is not null then
    execute format('alter table public.rec_immortality_owner_interview_answers drop constraint %I', cname);
  end if;
end $$;

alter table public.rec_immortality_owner_interview_answers
  add constraint rec_immortality_owner_interview_answers_slot_key
  unique (owner_id, season, season_stage, week_number, slot);
