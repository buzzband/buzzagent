#!/usr/bin/env python3
"""Generate the BuzzAgent app icon (a bee on a dark rounded square).

Draws one 512x512 source with Pillow and exports every size Tauri/tao need:
32/64/128/256/512 PNG + a multi-size .ico. Deterministic, no network.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

S = 512
DARK = (31, 41, 55, 255)       # slate-800 rounded square
AMBER = (251, 191, 36, 255)    # wings
WHITE = (248, 250, 252, 255)   # eyes, sting
PUPIL = (17, 24, 39, 255)      # pupils

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded dark square.
d.rounded_rectangle([32, 32, 480, 480], radius=96, fill=DARK)

# Two amber wing-ellipses (upper wing, lower wing) centered on the middle.
for cy in (236, 296):
    d.ellipse([256 - 130, cy - 60, 256 + 130, cy + 60], fill=AMBER)

# Big white eyes with dark pupils.
for ex in (200, 312):
    d.ellipse([ex - 36, 196 - 36, ex + 36, 196 + 36], fill=WHITE)
for ex, px in ((200, 206), (312, 306)):
    d.ellipse([px - 18, 202 - 18, px + 18, 202 + 18], fill=PUPIL)

# Small sting at the bottom (rotated ellipse via polygon).
d.polygon([(238, 396), (274, 396), (256, 452)], fill=WHITE)

img.save(OUT / "icon.png")
for size in (32, 64, 128, 256):
    img.resize((size, size), Image.LANCZOS).save(OUT / f"{size}x{size}.png")
img.save(
    OUT / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("written:", *(p.name for p in sorted(OUT.iterdir())))
