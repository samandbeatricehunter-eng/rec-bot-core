"""Build the REC Victory Slab display family.

This is a renamed and width-customized derivative of Graduate, distributed
under the SIL Open Font License in apps/web/public/fonts/OFL.txt. The original
font source is committed under scripts/font-sources for reproducible builds.
"""
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/font-sources/Graduate-Regular.ttf"
OUT = ROOT / "apps/web/public/fonts"

def set_name(font, name_id, value):
    for record in font["name"].names:
        if record.nameID == name_id:
            record.string = value.encode("utf-16-be" if record.isUnicode() else "latin-1")

def build(style, scale, width_class):
    font = TTFont(SOURCE)
    glyf = font["glyf"]
    for glyph_name in font.getGlyphOrder():
        glyph = glyf[glyph_name]
        if glyph.isComposite():
            for component in glyph.components:
                component.x = round(component.x * scale)
        elif glyph.numberOfContours:
            coordinates, _, _ = glyph.getCoordinates(glyf)
            coordinates.scale((scale, 1))
            coordinates.toInt()
            glyph.coordinates = coordinates
    hmtx = font["hmtx"].metrics
    for glyph_name, (advance, bearing) in list(hmtx.items()):
        hmtx[glyph_name] = (round(advance * scale), round(bearing * scale))
    font["OS/2"].usWidthClass = width_class
    family = "REC Victory Slab"
    set_name(font, 1, family); set_name(font, 2, style); set_name(font, 3, f"REC Victory Slab {style} 1.0")
    set_name(font, 4, f"{family} {style}"); set_name(font, 6, f"RECVictorySlab-{style}")
    set_name(font, 9, "REC Leagues; original Graduate contributors")
    set_name(font, 10, "REC width-customized derivative of Graduate. Licensed under the SIL Open Font License 1.1.")
    target = OUT / f"rec-victory-slab-{style.lower()}"
    font.save(target.with_suffix(".ttf"))
    font.flavor = "woff2"; font.save(target.with_suffix(".woff2"))

OUT.mkdir(parents=True, exist_ok=True)
for args in (("Condensed", .72, 3), ("Regular", .86, 5), ("Wide", 1.03, 7)):
    build(*args)
print(f"Built REC Victory Slab in {OUT}")
