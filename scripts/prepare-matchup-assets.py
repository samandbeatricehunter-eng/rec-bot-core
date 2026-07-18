"""Remove generated checkerboard/matte pixels from the interactive chassis art."""

from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
HUB = ROOT / "apps" / "web" / "public" / "assets" / "hub"


def clear_edge_matte(image: Image.Image, checkerboard: bool = False) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def background(pixel: tuple[int, int, int, int]) -> bool:
        r, g, b, _ = pixel
        if checkerboard:
            return max(r, g, b) - min(r, g, b) <= 10 and r >= 180
        return max(r, g, b) <= 12

    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index] or not background(pixels[x, y]):
            continue
        seen[index] = 1
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny * width + nx]:
                queue.append((nx, ny))
    return image


def seal_internal_alpha(image: Image.Image) -> Image.Image:
    """Keep only transparency connected to the canvas edge.

    The GOTW source contained semi-transparent black texture throughout the card. On a
    green page that made the field bleed through and look dissolved. Interior pixels are
    part of the rendered chassis and must be opaque; only the outside silhouette remains
    transparent.
    """
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    # The source silhouette reaches nearly every edge. This inset octagon follows its
    # outside frame while deliberately sealing every transparent texture hole within it.
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([
        (int(width * .21), int(height * .015)),
        (int(width * .79), int(height * .015)),
        (int(width * .965), int(height * .045)),
        (int(width * .995), int(height * .075)),
        (int(width * .995), int(height * .965)),
        (int(width * .965), int(height * .985)),
        (int(width * .035), int(height * .985)),
        (int(width * .005), int(height * .965)),
        (int(width * .005), int(height * .075)),
        (int(width * .035), int(height * .045)),
    ], fill=255)
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (r, g, b, max(a, mask_pixels[x, y]))
    return image


for filename, checkerboard in (
    ("matchup-gotw-chassis-v3.png", False),
    ("matchup-h2h-chassis-v1.png", False),
    ("menu-button-render.png", True),
):
    path = HUB / filename
    prepared = clear_edge_matte(Image.open(path), checkerboard)
    if filename == "matchup-gotw-chassis-v3.png":
        prepared = seal_internal_alpha(prepared)
    prepared.save(path, format="PNG", optimize=True)

# Reuse the exact rendered stream controls from the GOTW chassis on H2H cards. These
# crops remain separate overlays so the live HTML anchors retain their semantics.
gotw = Image.open(HUB / "matchup-gotw-chassis-v3.png").convert("RGBA")
for filename, box in (
    ("away-stream-control.png", (48, 1210, 392, 1302)),
    ("home-stream-control.png", (580, 1210, 924, 1302)),
):
    gotw.crop(box).save(HUB / filename, format="PNG", optimize=True)
