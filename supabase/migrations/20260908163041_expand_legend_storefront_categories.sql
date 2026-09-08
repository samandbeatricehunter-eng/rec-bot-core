alter table public.rec_legend_catalog
  drop constraint if exists rec_legend_catalog_legend_tier_check;

alter table public.rec_legend_catalog
  add constraint rec_legend_catalog_legend_tier_check
  check (legend_tier in (
    'legend',
    'immortal',
    'bust',
    'hometown_hero',
    'celebs_couldve_beens'
  ));

alter table public.rec_legend_catalog
  add column if not exists store_subgroup text;

alter table public.rec_legend_catalog
  drop constraint if exists rec_legend_catalog_store_subgroup_check;

alter table public.rec_legend_catalog
  add constraint rec_legend_catalog_store_subgroup_check
  check (store_subgroup is null or store_subgroup in ('screen_star', 'couldve_been'));

alter table public.rec_legend_catalog
  drop constraint if exists rec_legend_catalog_store_subgroup_tier_check;

alter table public.rec_legend_catalog
  add constraint rec_legend_catalog_store_subgroup_tier_check
  check (
    (legend_tier = 'celebs_couldve_beens' and store_subgroup is not null)
    or (legend_tier <> 'celebs_couldve_beens' and store_subgroup is null)
  );

create index if not exists rec_legend_catalog_storefront_group_idx
  on public.rec_legend_catalog (legend_tier, store_subgroup, position);
