"""Emit supabase migration SQL from shared-catalog-seed.json"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "docs" / "legends" / "shared-catalog-seed.json"
OUT = ROOT / "supabase" / "migrations" / "20260813120000_shared_legend_catalog.sql"


def esc(s):
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


def jsonb(v):
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def main():
    players = json.loads(SEED.read_text(encoding="utf-8"))
    parts: list[str] = []
    parts.append("-- Shared legend catalog: schema + economy + full seed")
    parts.append("alter table public.rec_legend_catalog add column if not exists legend_tier text;")
    parts.append("alter table public.rec_legend_catalog add column if not exists abilities jsonb not null default '[]'::jsonb;")
    parts.append("update public.rec_legend_catalog set legend_tier = 'immortal' where legend_tier is null;")
    parts.append("alter table public.rec_legend_catalog alter column legend_tier set default 'legend';")
    parts.append("alter table public.rec_legend_catalog alter column legend_tier set not null;")
    parts.append("alter table public.rec_legend_catalog drop constraint if exists rec_legend_catalog_legend_tier_check;")
    parts.append("alter table public.rec_legend_catalog add constraint rec_legend_catalog_legend_tier_check check (legend_tier in ('legend','immortal'));")
    parts.append("alter table public.rec_legend_catalog drop constraint if exists rec_legend_catalog_name_position_game_scope_key;")
    parts.append("alter table public.rec_legend_catalog drop constraint if exists rec_legend_catalog_name_position_key;")
    parts.append("delete from public.rec_legend_catalog;")
    parts.append(
        "insert into public.rec_legend_catalog (\n"
        "  name, position, position_group, est_ovr, height, weight, hand, jersey_number,\n"
        "  dev_trait, archetype, build_note, attributes, abilities, legend_tier, college, body_type, photo_url, game_scope\n"
        ") values"
    )
    rows = []
    for p in players:
        rows.append(
            "("
            + ", ".join(
                [
                    esc(p["name"]),
                    esc(p["position"]),
                    esc(p["position_group"]),
                    str(p["est_ovr"]),
                    esc(p.get("height")),
                    "null" if p.get("weight") is None else str(int(p["weight"])),
                    esc(p.get("hand")),
                    "null" if p.get("jersey_number") is None else str(int(p["jersey_number"])),
                    esc(p["dev_trait"]),
                    esc(p.get("archetype")),
                    esc(p.get("build_note")),
                    jsonb(p["attributes"]),
                    jsonb(p["abilities"]),
                    esc(p["legend_tier"]),
                    esc(p.get("college")),
                    esc(p.get("body_type")),
                    esc(p.get("photo_url")),
                    esc("madden"),
                ]
            )
            + ")"
        )
    parts.append(",\n".join(rows) + ";")
    parts.append(
        """
update public.rec_global_economy_config
set config = jsonb_set(
  jsonb_set(coalesce(config, '{}'::jsonb), '{store,legend}', '4000'::jsonb, true),
  '{store,immortal}', '8000'::jsonb, true
),
updated_at = now()
where config_key = 'global';
""".strip()
    )
    parts.append("create unique index if not exists rec_legend_catalog_name_position_uidx on public.rec_legend_catalog (name, position);")
    OUT.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(players)} players)")


if __name__ == "__main__":
    main()
