-- League Settings gets a master on/off switch for purchase deadline enforcement, separate from
-- the per-purchase-type stage/week schedule already stored in purchase_deadlines. Turning this
-- off pauses enforcement (and the upcoming-deadline reminder) without clearing the configured
-- schedule, so re-enabling later doesn't require re-entering every deadline.
alter table public.rec_league_configuration
  add column if not exists purchase_deadlines_enabled boolean not null default true;
