"""Export legend/immortal name+position checklist for image matching."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "docs" / "legends" / "shared-catalog-seed.json"
OUT_DIR = ROOT / "docs" / "legends"


def slugify(name: str) -> str:
    s = name.lower().replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace('"', "").replace(".", "")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def main() -> None:
    players = json.loads(SEED.read_text(encoding="utf-8"))
    players = sorted(
        players,
        key=lambda p: (p["legend_tier"] != "immortal", p["position"], p["name"]),
    )

    csv_path = OUT_DIR / "legend-image-checklist.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "position", "legend_tier", "est_ovr", "suggested_filename", "has_photo_url"])
        for p in players:
            w.writerow([
                p["name"],
                p["position"],
                p["legend_tier"],
                p["est_ovr"],
                f"{slugify(p['name'])}.png",
                "yes" if p.get("photo_url") else "no",
            ])

    imm = sum(1 for p in players if p["legend_tier"] == "immortal")
    leg = sum(1 for p in players if p["legend_tier"] == "legend")
    missing = sum(1 for p in players if not p.get("photo_url"))

    lines = [
        "# Legend / Immortal image checklist",
        "",
        f"Total: **{len(players)}** ({imm} Immortal / {leg} Legend). Missing photo_url: **{missing}**.",
        "",
        "Name files as the suggested slug (or keep your own names — we will map by player name).",
        "",
        "| Name | Pos | Tier | OVR | Suggested file | Photo now |",
        "|---|---|---|---:|---|---|",
    ]
    for p in players:
        lines.append(
            f"| {p['name']} | {p['position']} | {p['legend_tier']} | {p['est_ovr']} | "
            f"`{slugify(p['name'])}.png` | {'yes' if p.get('photo_url') else 'no'} |"
        )
    (OUT_DIR / "legend-image-checklist.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    rows = [
        {
            "name": p["name"],
            "pos": p["position"],
            "tier": p["legend_tier"],
            "ovr": p["est_ovr"],
            "file": f"{slugify(p['name'])}.png",
            "photo": bool(p.get("photo_url")),
        }
        for p in players
    ]
    (OUT_DIR / "legend-image-checklist.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"wrote {len(players)} players ({imm} immortal / {leg} legend), missing photo={missing}")


if __name__ == "__main__":
    main()
