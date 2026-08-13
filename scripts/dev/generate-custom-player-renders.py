#!/usr/bin/env python3
"""Custom player card renders — catalog helper.

Photoreal bust PNGs live at:
  apps/web/public/assets/custom-player-renders/cpr-XXX.png

Flat SVG silhouettes are obsolete. Generate PNGs via Cursor GenerateImage
(or equivalent) using the body-morphology prompts below, then drop files
into that folder. Catalog IDs/labels come from
packages/shared/src/custom-player-renders.ts.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "public" / "assets" / "custom-player-renders"

BODY = ["lean", "thin", "standard", "muscular", "heavy"]
SKIN = ["fair", "light", "medium", "tan", "brown", "deep"]
HAIR = ["buzz", "fade", "short", "curly", "locs", "braids", "afro", "long", "bald", "mohawk"]

MORPH = {
    "lean": "narrower face, slim cheeks, thinner neck, less shoulder bulk",
    "thin": "very slim angular face, hollow cheeks, narrow jaw, slender neck",
    "standard": "balanced athletic face, normal jaw and neck thickness",
    "muscular": "strong square jaw, chiseled cheekbones, thick muscular neck, broad shoulders",
    "heavy": "fuller rounder face, more facial fat, softer jaw mass, thick powerful neck, massive shoulders",
}

SKIN_D = {
    "fair": "fair/pale skin",
    "light": "light skin",
    "medium": "medium skin",
    "tan": "tan/olive skin",
    "brown": "brown skin",
    "deep": "deep dark skin",
}

HAIR_D = {
    "buzz": "buzz cut",
    "fade": "short fade haircut",
    "short": "short cropped hair",
    "curly": "medium curly hair",
    "locs": "dreadlocks/locs",
    "braids": "braided hair",
    "afro": "afro hairstyle",
    "long": "longer flowing hair",
    "bald": "bald head",
    "mohawk": "mohawk hairstyle",
}

BASE = (
    "Photoreal football player card bust. White football shoulder pads and dark jersey collar. "
    "Cinematic rim lighting, dark atmospheric spark background. Head-and-shoulders portrait only. "
    "No text, logos, or team branding. Match reference photoreal quality."
)


def catalog() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    n = 1
    for body in BODY:
        for i in range(30):
            skin = SKIN[i % 6]
            hair = HAIR[(i + i // 6) % 10]
            rid = f"cpr-{n:03d}"
            prompt = (
                f"{BASE} {body.upper()} body type: {MORPH[body]}. "
                f"{SKIN_D[skin]}, {HAIR_D[hair]}."
            )
            rows.append({
                "id": rid,
                "body": body,
                "skin": skin,
                "hair": hair,
                "prompt": prompt,
                "path": str(OUT / f"{rid}.png"),
            })
            n += 1
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = catalog()
    missing = [r for r in rows if not Path(r["path"]).is_file()]
    print(f"catalog={len(rows)} png_present={len(rows) - len(missing)} missing={len(missing)}")
    for r in missing[:20]:
        print(f"MISSING {r['id']} | {r['body']} {r['skin']} {r['hair']}")
        print(f"  {r['prompt']}")
    if len(missing) > 20:
        print(f"... and {len(missing) - 20} more")


if __name__ == "__main__":
    main()
