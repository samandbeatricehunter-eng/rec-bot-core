#!/usr/bin/env python3
"""Generate 150 stylized custom-player bust SVGs matching REC_CUSTOM_PLAYER_RENDERS."""

from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "public" / "assets" / "custom-player-renders"

BUILDS = ["lean", "thin", "standard", "muscular", "heavy"]
SKINS = ["fair", "light", "medium", "tan", "brown", "deep"]
HAIRS = ["buzz", "fade", "short", "curly", "locs", "braids", "afro", "long", "bald", "mohawk"]

SKIN_HEX = {
    "fair": "#F1D2B6",
    "light": "#E2B896",
    "medium": "#C68642",
    "tan": "#A86B3C",
    "brown": "#8D5524",
    "deep": "#4A2C1A",
}

HAIR_HEX = {
    "buzz": "#1A1A1A",
    "fade": "#2B2118",
    "short": "#111111",
    "curly": "#1C1410",
    "locs": "#0E0A08",
    "braids": "#15100C",
    "afro": "#120E0B",
    "long": "#1A120C",
    "bald": "#00000000",
    "mohawk": "#101010",
}

SHOULDER = {
    "lean": (68, 52),
    "thin": (74, 54),
    "standard": (86, 58),
    "muscular": (102, 64),
    "heavy": (118, 72),
}


def hair_paths(style: str, color: str) -> str:
    if style == "bald" or color.endswith("00"):
        return ""
    if style == "buzz":
        return f'<ellipse cx="120" cy="70" rx="44" ry="40" fill="{color}"/>'
    if style == "fade":
        return (
            f'<path fill="{color}" d="M76 78c4-34 28-52 44-52s40 18 44 52c-10-18-26-26-44-26s-34 8-44 26Z"/>'
            f'<ellipse cx="120" cy="78" rx="42" ry="20" fill="{color}" opacity=".55"/>'
        )
    if style == "short":
        return f'<path fill="{color}" d="M74 90c6-40 28-58 46-58s40 18 46 58c-12-20-28-30-46-30S86 70 74 90Z"/>'
    if style == "curly":
        circles = "".join(
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"/>'
            for x, y, r in [
                (88, 52, 14), (108, 42, 16), (132, 42, 16), (152, 52, 14),
                (96, 66, 12), (120, 58, 14), (144, 66, 12),
            ]
        )
        return circles
    if style == "locs":
        return "".join(
            f'<rect x="{x}" y="48" width="8" height="58" rx="4" fill="{color}"/>'
            for x in range(84, 160, 12)
        ) + f'<ellipse cx="120" cy="58" rx="44" ry="24" fill="{color}"/>'
    if style == "braids":
        return (
            f'<ellipse cx="120" cy="62" rx="42" ry="28" fill="{color}"/>'
            + "".join(
                f'<path fill="{color}" d="M{x} 70c0 40 4 70 8 90 4-20 8-50 8-90Z"/>'
                for x in (86, 104, 122, 140)
            )
        )
    if style == "afro":
        return f'<circle cx="120" cy="70" r="58" fill="{color}"/>'
    if style == "long":
        return (
            f'<ellipse cx="120" cy="70" rx="46" ry="42" fill="{color}"/>'
            f'<path fill="{color}" d="M74 90c-6 50 0 110 10 140h20c-6-40-4-90 0-120 '
            f'16 4 40 6 56 0 4 30 6 80 0 120h20c10-30 16-90 10-140Z"/>'
        )
    if style == "mohawk":
        return (
            f'<path fill="{color}" d="M108 18c4-10 20-10 24 0 8 18 10 46 8 70H100c-2-24 0-52 8-70Z"/>'
            f'<ellipse cx="120" cy="78" rx="40" ry="18" fill="{color}" opacity=".4"/>'
        )
    return f'<ellipse cx="120" cy="70" rx="44" ry="40" fill="{color}"/>'


def svg_for(idx: int, body: str, skin: str, hair: str) -> str:
    skin_hex = SKIN_HEX[skin]
    hair_hex = HAIR_HEX[hair]
    shoulder_w, neck_w = SHOULDER[body]
    left = 120 - shoulder_w
    right = 120 + shoulder_w
    neck_left = 120 - max(8, neck_w // 2)
    jersey = "#1A222E" if body in ("lean", "thin") else "#151C28"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="bg{idx}" x1="120" y1="20" x2="120" y2="300" gradientUnits="userSpaceOnUse">
      <stop stop-color="#141820"/>
      <stop offset="1" stop-color="#0A0D12"/>
    </linearGradient>
  </defs>
  <rect width="240" height="320" fill="url(#bg{idx})"/>
  {hair_paths(hair, hair_hex)}
  <ellipse cx="120" cy="98" rx="42" ry="48" fill="{skin_hex}"/>
  <rect x="{neck_left}" y="138" width="{max(16, neck_w)}" height="34" rx="8" fill="{skin_hex}"/>
  <path fill="{jersey}" d="M{left} 300c10-70 34-120 {120 - left}-120s{right - 120} 50 {right - 120} 120H{left}Z"/>
  <path fill="{skin_hex}" d="M{left + 18} 188c18-16 40-22 {102 - left}-22s{right - 138} 6 {right - 138} 22c-20 8-42 12-{102 - left} 12s-{right - 158}-4-{right - 138}-12Z" opacity=".95"/>
</svg>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    n = 1
    for body in BUILDS:
        for i in range(30):
            skin = SKINS[i % len(SKINS)]
            hair = HAIRS[(i + i // 6) % len(HAIRS)]
            rid = f"cpr-{n:03d}"
            (OUT / f"{rid}.svg").write_text(svg_for(n, body, skin, hair), encoding="utf-8")
            n += 1
    print(f"Wrote {n - 1} renders to {OUT}")


if __name__ == "__main__":
    main()
