"""Remove generated checkerboard/matte pixels from the interactive chassis art."""

from collections import deque
from pathlib import Path
from PIL import Image

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


for filename, checkerboard in (
    ("matchup-gotw-chassis-v3.png", False),
    ("matchup-h2h-chassis-v1.png", False),
    ("menu-button-render.png", True),
):
    path = HUB / filename
    clear_edge_matte(Image.open(path), checkerboard).save(path, format="PNG", optimize=True)
