"""Render Lense's original mark and social card. Requires Python and Pillow.

Run from any directory: python scripts/generate-brand-assets.py
Fonts retain their SIL Open Font Licenses in public/fonts.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PUBLIC = Path(__file__).resolve().parents[1] / "public"
FOREST = "#173d2f"
LIME = "#daf58a"
PAPER = "#f7f7f0"
INK = "#233d33"
MUTED = "#657569"
SCALE = 3


def brand_icon(size: int, rounded: bool = False) -> Image.Image:
    scale = 6
    large = size * scale
    canvas = Image.new("RGBA", (large, large), FOREST)
    mark = Image.new("RGBA", (large, large))
    draw = ImageDraw.Draw(mark)
    unit = large / 64
    for cx in (25.5, 38.5):
        draw.ellipse(
            ((cx - 12) * unit, 13 * unit, (cx + 12) * unit, 51 * unit),
            outline=LIME,
            width=round(2.8 * unit),
        )
    # Pillow's positive rotation is counter-clockwise, matching SVG rotate(-18).
    canvas.alpha_composite(mark.rotate(18, resample=Image.Resampling.BICUBIC))
    if rounded:
        mask = Image.new("L", (large, large), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, large, large), radius=15 * unit, fill=255)
        canvas.putalpha(mask)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(PUBLIC / "fonts" / name), size * SCALE)


def social_card() -> Image.Image:
    canvas = Image.new("RGB", (1200 * SCALE, 630 * SCALE), PAPER)
    draw = ImageDraw.Draw(canvas)

    def box(bounds, fill, radius=0, outline=None, width=1):
        coords = tuple(round(value * SCALE) for value in bounds)
        draw.rounded_rectangle(coords, radius=radius * SCALE, fill=fill, outline=outline, width=width * SCALE)

    def text(x, y, content, face, size, fill=INK):
        draw.text((x * SCALE, y * SCALE), content, font=font(face, size), fill=fill, anchor="lt")

    def line(x1, y1, x2, y2, fill, width=1):
        draw.line(tuple(value * SCALE for value in (x1, y1, x2, y2)), fill=fill, width=width * SCALE)

    mark = brand_icon(58 * SCALE, rounded=True)
    canvas.paste(mark, (58 * SCALE, 51 * SCALE), mark)
    text(133, 54, "lense", "dm-sans-600.ttf", 43)
    text(62, 162, "VISUAL COMPUTER CONTROL", "dm-sans-600.ttf", 13, MUTED)
    text(59, 210, "Your screen.", "instrument-serif.ttf", 78)
    text(59, 296, "Structured control.", "instrument-serif.ttf", 72)
    text(63, 413, "A visible feedback loop for people", "dm-sans-400.ttf", 21, MUTED)
    text(63, 446, "and WebMCP agents.", "dm-sans-400.ttf", 21, MUTED)
    line(62, 522, 611, 522, "#d4dbcc")
    box((63, 552, 149, 581), "#e5edce", radius=14)
    text(77, 560, "WebMCP", "dm-sans-600.ttf", 12, FOREST)
    text(164, 558, "One shared workspace.", "dm-sans-400.ttf", 16, MUTED)

    box((674, 40, 1160, 590), FOREST, radius=26)
    text(707, 75, "THE CONTROL LOOP", "dm-sans-600.ttf", 12, "#c1d4ac")
    draw.ellipse((1104 * SCALE, 79 * SCALE, 1112 * SCALE, 87 * SCALE), fill=LIME)
    text(707, 123, "Observe. Act. Verify.", "instrument-serif.ttf", 39, "#f3f7e7")
    stages = [
        (1, 204, "Observe", "desktop_observe", "Read a fresh screen capture."),
        (2, 317, "Act", "desktop_action", "Send a structured action."),
        (3, 430, "Verify", "desktop_task", "Check progress in shared state."),
    ]
    for number, y, title, tool, description in stages:
        box((704, y, 1130, y + 91), "#244c39", radius=12, outline="#37624a")
        box((721, y + 18, 749, y + 46), LIME, radius=14)
        text(731, y + 25, str(number), "dm-sans-600.ttf", 12, FOREST)
        text(764, y + 16, title, "dm-sans-500.ttf", 18, "#f3f7e7")
        text(764, y + 47, tool, "dm-sans-500.ttf", 13, LIME)
        if number < 3:
            line(735, y + 93, 735, y + 110, "#809774", 2)
    text(706, 552, "Human control stays visible.", "dm-sans-400.ttf", 14, "#c1d4ac")
    return canvas.resize((1200, 630), Image.Resampling.LANCZOS)


def main():
    icon = brand_icon(256, rounded=True)
    icon.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    for name, size in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
        brand_icon(size).convert("RGB").save(PUBLIC / name, format="PNG", optimize=True)
    social_card().save(PUBLIC / "og-image.png", format="PNG", optimize=True)
    for name in ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "og-image.png"]:
        path = PUBLIC / name
        with Image.open(path) as asset:
            print(f"{name}: {asset.format}, {asset.size[0]}x{asset.size[1]}, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
