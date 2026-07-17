"""Render uniform transparent badge textures with their labels baked in.

The badge shelf deliberately uses images, rather than HTML labels, so the material
texture, bevel, and lettering stay together at every breakpoint.  This script keeps
the supplied badge art as the source of truth and only normalizes its canvas and
adds an embossed wordmark.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "web" / "public" / "assets"
OUT = ASSETS / "badges" / "baked"
OUT.mkdir(parents=True, exist_ok=True)

WIDTH, HEIGHT = 960, 250
FONT_PATH = Path(r"C:\Windows\Fonts\AGENCYB.TTF")
FONT_BOLD = Path(r"C:\Windows\Fonts\impact.ttf")
PERFECT_GENERATED = Path(
    r"C:\Users\josh_\.codex\generated_images\019f6cbb-1634-77b2-9949-c88f9a620fef\exec-38240546-7603-4f7d-bfa5-55d8023d7be2.png"
)

UNIQUE = {
    "prolific_passer": ("badges/prolific-passer.png", "Prolific Passer"),
    "prolific_rusher": ("badges/prolific-rusher.png", "Prolific Rusher"),
    "balanced_season": ("badges/balanced-season.png", "Balanced Season"),
    "fourth_down_menace": ("badges/fourth-down-menace.png", "Fourth Down Menace"),
    "dawgin_em": ("badges/dawg-in-em.png", "Dawg In 'Em"),
    "two_point_identity": ("badges/two-point-identity.png", "Two-Point Identity"),
    "clock_bleeder": ("badges/clock-bleeder.png", "Clock Bleeder"),
    "perfect_regular_season": ("badges/perfect-regular-season.png", "Perfect Regular Season"),
    "winning_season": ("badges/winning-season.png", "Winning Season"),
    "return_threat": ("badges/return-threat.png", "Return Threat"),
    "veteran_coach": ("badges/rec-league-veteran.png", "REC League Veteran"),
    "fourth_down_legend": ("badges/fourth-down-legend.png", "4th Down Legend"),
    "red_zone_legend": ("badges/red-zone-legend.png", "Red Zone Legend"),
    "ground_and_pound_veteran": ("badges/run-game-veteran.png", "Run Game Veteran"),
    "air_raid_veteran": ("badges/pass-game-veteran.png", "Pass Game Veteran"),
    "playoff_winner": ("badges/playoff-winner.png", "Playoff Winner"),
    "dynasty_builder": ("badges/dynasty-builder.png", "Dynasty Builder"),
    "super_bowl_champion": ("badges/reigning-sb-champ.png", "Reigning SB Champ"),
    "conf_champion": ("badges/reigning-conference-champ.png", "Reigning Conference Champ"),
    "div_champion": ("badges/divisional-round-winner.png", "Divisional Round Winner"),
    "national_champion": ("badges/reigning-national-champ.png", "Reigning National Champ"),
    "bowl_winner": ("badges/bowl-winner.png", "Won Bowl Game"),
}

POSITIVE = {
    "run_heavy": "Run Heavy", "pass_heavy": "Pass Heavy", "balanced_attack": "Balanced Attack",
    "big_play_energy": "Big Play Energy", "nickel_and_dime": "Nickel & Dime", "chain_mover": "Chain Mover",
    "perfect_red_zone": "Perfect Red Zone", "red_zone_efficient": "Red Zone Efficient", "red_zone_wall": "Red Zone Wall",
    "ball_security": "Ball Security", "opportunistic": "Opportunistic", "defensive_grind": "Defensive Grind",
    "shootout_winner": "Shootout Winner", "statement_win": "Statement Win", "close_escape": "Close Escape",
    "offensive_explosion": "Offensive Explosion", "empty_yards": "Empty Yards", "return_game_edge": "Return Game Edge",
    "hidden_yardage": "Hidden Yardage", "two_point_specialist": "Two-Point Specialist", "road_warrior": "Road Warrior",
    "home_fortress": "Home Fortress", "fourth_down_gambler": "Fourth Down Gambler", "bend_dont_break": "Bend Don't Break",
}

NEGATIVE = {
    "turnover_trouble": "Turnover Trouble", "heartbreaker": "Heartbreaker", "offensive_stall": "Offensive Stall",
    "ground_game_missing": "Ground Game Missing", "chain_stalled": "Chain Stalled", "third_down_drought_m": "Third-Down Drought",
    "red_zone_woes": "Red Zone Woes", "defensive_collapse": "Defensive Collapse", "yardage_flood": "Floodgates Open",
    "blowout_victim_m": "Run Out of the Building", "pick_parade": "Pick Parade", "butterfingers": "Butterfingers",
    "completion_crisis": "Completion Crisis", "failed_attempts": "Failed Attempts", "third_down_drought": "Third-Down Drought",
    "fourth_down_futility": "Fourth and Foolish", "ground_game_grounded": "Grounded", "passing_in_mud": "Passing in Mud",
    "inefficient_attack": "Inefficient Attack", "flag_factory": "Flag Factory", "punt_party": "Punt Party",
    "red_zone_waste": "Red Zone Waste", "touchdown_drought": "Touchdown Drought", "wasted_volume": "Wasted Volume",
    "blowout_victim": "Run Out of the Stadium",
}

LADDER = {
    "wins_milestone": ["10 Wins", "25 Wins", "50 Wins", "100 Wins", "200 Wins", "500 Wins", "1,000 Wins"],
    "games_milestone": ["100 Games", "250 Games", "500 Games", "1,000 Games", "5,000+ Games"],
    "air_milestone": ["Air Milestone I", "Air Milestone II", "Air Milestone III", "Air Milestone IV", "Air Milestone V"],
    "ground_milestone": ["Ground Milestone I", "Ground Milestone II", "Ground Milestone III", "Ground Milestone IV", "Ground Milestone V"],
    "earner": ["Money Man", "Bank Roll", "Big Bank"],
    "spender": ["Steady Shopper", "Shopaholic", "Pay to Play"],
    "saver": ["Penny Pincher", "Stiff Wallet", "Heavy Hoarder"],
    "attribute_purchase": ["Quality Trainer", "Heavy Investor", "Build-a-Baller"],
    "dev_upgrade_purchase": ["Cash for Comp", "Fantastic Facilitator", "Superstar Farm"],
}


def slug(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def remove_checkerboard_border(image: Image.Image) -> Image.Image:
    """Make the generated perfect-season image transparent outside its badge.

    The image generator returned a checkerboard preview as RGB pixels.  Flooding
    from the edges removes only the near-neutral checkerboard colors; dark/silver
    badge pixels are protected by the opaque frame between them and the edge.
    """
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def checker(pixel: tuple[int, int, int, int]) -> bool:
        r, g, b, _ = pixel
        return max(r, g, b) - min(r, g, b) <= 8 and r >= 184

    for x in range(width):
        for y in (0, height - 1):
            if checker(pixels[x, y]):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if checker(pixels[x, y]):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index] or not checker(pixels[x, y]):
            continue
        seen[index] = 1
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny * width + nx]:
                queue.append((nx, ny))
    return image


def source_image(relative: str) -> Image.Image:
    path = ASSETS / relative
    if relative.endswith("perfect-regular-season.png") and PERFECT_GENERATED.exists():
        return remove_checkerboard_border(Image.open(PERFECT_GENERATED))
    return Image.open(path).convert("RGBA")


def normalize(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        image = image.crop(bbox)
    image = image.resize((WIDTH - 20, HEIGHT - 20), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    canvas.alpha_composite(image, (10, 10))
    return canvas


def font_for_size(size: int) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if FONT_BOLD.exists() else FONT_PATH
    return ImageFont.truetype(str(path), size)


def draw_baked_label(canvas: Image.Image, label: str, *, dark: bool = False) -> None:
    draw = ImageDraw.Draw(canvas)
    max_width = 620
    size = 47
    words = label.split()
    lines: list[str] = []
    current = ""
    while words:
        candidate = f"{current} {words.pop(0)}".strip()
        if draw.textbbox((0, 0), candidate, font=font_for_size(size))[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > 2:
        lines = [" ".join(lines[:-1]), lines[-1]]
    if len(lines) == 2:
        size = 38
    font = font_for_size(size)
    line_boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=1) for line in lines]
    line_height = max((box[3] - box[1] for box in line_boxes), default=size)
    total_height = line_height * len(lines) + (4 * (len(lines) - 1))
    y = (HEIGHT - total_height) // 2 - 2
    fill = (34, 24, 10, 255) if dark else (247, 235, 198, 255)
    highlight = (255, 255, 236, 210) if not dark else (255, 207, 89, 180)
    shadow = (0, 0, 0, 220)
    for line in lines:
        box = draw.textbbox((0, 0), line, font=font, stroke_width=1)
        x = 610 - ((box[2] - box[0]) // 2)
        draw.text((x + 3, y + 4), line, font=font, fill=shadow, stroke_width=3, stroke_fill=shadow)
        draw.text((x, y), line, font=font, fill=fill, stroke_width=1, stroke_fill=(14, 13, 10, 255))
        draw.text((x - 1, y - 1), line, font=font, fill=highlight, stroke_width=0)
        y += line_height + 4


def render(relative: str, label: str, output: str, *, dark_text: bool = False, bake_label: bool = True) -> None:
    image = normalize(source_image(relative))
    if bake_label:
        draw_baked_label(image, label, dark=dark_text)
    # Palette PNGs preserve the alpha channel while keeping the texture shelf
    # lightweight enough for mobile (roughly 80–90 KB per badge instead of 450 KB).
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(OUT / output, format="PNG", optimize=True)


def main() -> None:
    for key, (source, label) in UNIQUE.items():
        render(source, label, f"{slug(key)}.png", dark_text=key in {"winning_season", "return_threat", "playoff_winner", "super_bowl_champion", "conf_champion", "div_champion", "national_champion", "bowl_winner"}, bake_label=key != "perfect_regular_season")

    for key, label in {**POSITIVE, **NEGATIVE}.items():
        negative = key in NEGATIVE
        source = "hub/badge-warning-v2.png" if negative else "hub/badge-normal-v3.png"
        polarity = "negative" if negative else "positive"
        render(source, label, f"label-{slug(label)}-{polarity}.png", dark_text=False)

    tier_sources = {"bronze": "hub/badge-bronze-v2.png", "silver": "hub/badge-silver-v2.png", "gold": "hub/badge-gold-v2.png"}
    for labels in LADDER.values():
        for label in labels:
            for tier, source in tier_sources.items():
                render(source, label, f"label-{slug(label)}-{tier}.png", dark_text=tier == "gold")


if __name__ == "__main__":
    main()
