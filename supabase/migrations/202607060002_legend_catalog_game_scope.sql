-- Legend catalog was previously global/game-agnostic. Adding CFB 27 Campus Legends means the
-- same (name, position) can now legitimately appear twice — once as a Madden NFL legend, once
-- as a CFB college legend (e.g. Ray Lewis LB, Deion Sanders DB, Reggie White DL all exist in
-- both real-life eras and are in both seed sets). Scope the catalog by game and widen the
-- uniqueness constraint accordingly. `college` is populated for CFB rows only.
alter table public.rec_legend_catalog
  add column if not exists game_scope text not null default 'madden',
  add column if not exists college text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rec_legend_catalog_game_scope_check') then
    alter table public.rec_legend_catalog
      add constraint rec_legend_catalog_game_scope_check
      check (game_scope in ('madden', 'cfb_27'));
  end if;
end $$;

alter table public.rec_legend_catalog
  drop constraint if exists rec_legend_catalog_name_position_key;
alter table public.rec_legend_catalog
  add constraint rec_legend_catalog_name_position_game_scope_key unique (name, position, game_scope);

create index if not exists rec_legend_catalog_game_scope_idx
  on public.rec_legend_catalog(game_scope, position_group, position);
