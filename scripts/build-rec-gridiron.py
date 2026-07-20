"""Build the REC Gridiron professional-football display family.

REC Gridiron is a renamed, width-adjusted derivative of Quantico and remains
licensed under the SIL Open Font License in REC-GRIDIRON-OFL.txt.
"""
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/font-sources/quantico"
OUT = ROOT / "apps/web/public/fonts"

def set_name(font, name_id, value):
    for record in font["name"].names:
        if record.nameID == name_id:
            record.string = value.encode("utf-16-be" if record.isUnicode() else "latin-1")

def widen(font, scale):
    glyf = font["glyf"]
    for glyph_name in font.getGlyphOrder():
        glyph = glyf[glyph_name]
        if glyph.isComposite():
            for component in glyph.components:
                component.x = round(component.x * scale)
        elif glyph.numberOfContours:
            coordinates, _, _ = glyph.getCoordinates(glyf)
            coordinates.scale((scale, 1)); coordinates.toInt(); glyph.coordinates = coordinates
    for glyph_name, (advance, bearing) in list(font["hmtx"].metrics.items()):
        font["hmtx"].metrics[glyph_name] = (round(advance * scale), round(bearing * scale))

def build(source, style, weight, italic, scale):
    font = TTFont(SOURCE / source); widen(font, scale)
    family = "REC Gridiron"; set_name(font, 1, family); set_name(font, 2, style)
    set_name(font, 3, f"REC Gridiron {style} 1.0"); set_name(font, 4, f"{family} {style}"); set_name(font, 6, f"RECGridiron-{style}")
    set_name(font, 9, "REC Leagues; original Quantico contributors")
    set_name(font, 10, "REC width-customized derivative of Quantico. Licensed under the SIL Open Font License 1.1.")
    font["OS/2"].usWeightClass = weight; font["OS/2"].usWidthClass = 7
    font["post"].italicAngle = -9 if italic else 0
    target = OUT / f"rec-gridiron-{style.lower()}"; font.save(target.with_suffix(".ttf")); font.flavor="woff2"; font.save(target.with_suffix(".woff2"))

OUT.mkdir(parents=True, exist_ok=True)
build("Quantico-Regular.ttf", "Regular", 400, False, 1.08)
build("Quantico-Bold.ttf", "Bold", 700, False, 1.08)
build("Quantico-BoldItalic.ttf", "Forward", 700, True, 1.08)
print(f"Built REC Gridiron in {OUT}")
