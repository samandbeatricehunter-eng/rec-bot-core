alter table public.rec_trades
  add column if not exists involves_cpu boolean not null default false;

comment on column public.rec_trades.involves_cpu is
  'Immutable proposal-time marker used for per-team CPU trade season-cap enforcement.';
