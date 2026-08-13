"""Re-map Madden abilities in shared-catalog-seed.json without rebuilding OVRs/attrs.

Uses position-gated 2K8 → Madden maps from build-shared-legend-catalog.py.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "docs" / "legends" / "shared-catalog-seed.json"
DOCS = ROOT / "docs" / "legends"
BUILD = Path(__file__).resolve().parent / "build-shared-legend-catalog.py"

spec = importlib.util.spec_from_file_location("legend_build", BUILD)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


def main() -> None:
    players = json.loads(SEED.read_text(encoding="utf-8"))
    changed = 0
    tip_drill_ol = 0
    for p in players:
        coarse = mod.coarse_for_position(str(p.get("position") or "DB"))
        new_abs = mod.map_abilities(p.get("abilities_2k8") or "", coarse, p["legend_tier"])
        if new_abs != p.get("abilities"):
            changed += 1
            p["abilities"] = new_abs
        if coarse == "OL" and any(a.get("name") == "Tip Drill" for a in new_abs):
            tip_drill_ol += 1

    SEED.write_text(json.dumps(players, indent=2), encoding="utf-8")

    alines = [
        "# Madden ability proposals",
        "",
        "Immortal = 1 X-Factor + up to 3 Superstar. Legend = up to 3 Superstar.",
        "",
        "Mappings are **position-gated**: a 2K8 skill only becomes a Madden ability when that ability is valid for the player's position group (e.g. OL Leadership → Linchpin, never Tip Drill).",
        "",
    ]
    for p in players:
        alines.append(f"## {p['name']} ({p['legend_tier']} · {p['position']} · {p['dev_trait']})")
        if p.get("abilities_2k8"):
            alines.append(f"- 2K8: {p['abilities_2k8']}")
        for a in p["abilities"]:
            alines.append(f"- [{a['type']}] **{a['name']}** — {a['description']}")
        alines.append("")
    (DOCS / "abilities-proposals.md").write_text("\n".join(alines), encoding="utf-8")

    otto = next(p for p in players if p["name"] == "Jim Otto")
    print(f"updated abilities on {changed}/{len(players)} players")
    print(f"OL Tip Drill leftovers: {tip_drill_ol}")
    print("Jim Otto:", json.dumps(otto["abilities"], indent=2))


if __name__ == "__main__":
    main()
