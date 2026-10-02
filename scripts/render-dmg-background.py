"""Renders the macOS DMG window background: build/background.png (660x400) and build/background@2x.png.

Warm light canvas, the vault door mark and wordmark with a short instruction at the top, and a coral
arrow from the app to the Applications folder. Everything that matters sits in the upper 320 points,
because Finder windows with a tab bar or path bar shown lose the bottom of the view. Finder draws the two icons itself, so their spots stay
empty; the positions here must match the dmg.contents coordinates in electron-builder.config.cjs.
electron-builder merges the 1x and @2x images into one HiDPI TIFF (tiffutil -cathidpicheck).

Run: python3 scripts/render-dmg-background.py
"""
import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("render_icon", ROOT / "scripts" / "render-icon.py")
icon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icon)

WIDTH, HEIGHT = 660, 400
APP_X, APPS_X, ICON_Y = 180, 480, 215  # icon centres, as in dmg.contents
ICON_SIZE = 128

CANVAS_TOP = (251, 250, 248)
CANVAS_BOTTOM = (241, 238, 234)
INK = (22, 21, 20)  # gray-900
MUTED = (92, 88, 83)  # gray-600, 6.6:1 on the canvas
FONTS = [
    "/Library/Fonts/SF-Pro-Display-Semibold.otf",
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]
FONTS_REGULAR = [
    "/Library/Fonts/SF-Pro-Text-Regular.otf",
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit(f"None of these fonts exist: {candidates}")


def mark(px: int) -> Image.Image:
    """The app mark without its tile, px wide, cropped to the same box as BrandMark.tsx."""
    ss = 4
    full = round(px * 1024 / 668) * ss  # the mark box spans 668 of the 1024 units
    masks = icon.layer_masks(icon.large_mark(), full)
    out = Image.new("RGBA", (full, full), (0, 0, 0, 0))
    for layer, color in (("door", icon.CHARCOAL), ("handle", icon.CORAL)):
        fill = Image.new("RGBA", (full, full), color + (255,))
        fill.putalpha(masks[layer])
        out.alpha_composite(fill)
    left = round(178 / 1024 * full)
    crop = out.crop((left, left, left + px * ss, left + px * ss))
    return crop.resize((px, px), Image.LANCZOS)


def render(scale: int) -> Image.Image:
    ss = 4  # supersample the vector parts
    s = scale * ss
    w, h = WIDTH * s, HEIGHT * s

    strip = Image.new("RGB", (1, 256))
    for y in range(256):
        strip.putpixel((0, y), tuple(round(a + (b - a) * y / 255) for a, b in zip(CANVAS_TOP, CANVAS_BOTTOM)))
    canvas = strip.resize((w, h), Image.BICUBIC).convert("RGBA")

    # Arrow between the icons: a rounded coral shaft with an open chevron head.
    d = ImageDraw.Draw(canvas)
    half = ICON_SIZE / 2
    x0, x1, y = APP_X + half + 34, APPS_X - half - 34, ICON_Y
    stroke = 6 * s
    d.line(((x0 * s, y * s), ((x1 - 3) * s, y * s)), fill=icon.CORAL + (255,), width=stroke)
    for dy in (-1, 1):
        d.line((((x1 - 20) * s, (y + dy * 20) * s), (x1 * s, y * s)), fill=icon.CORAL + (255,), width=stroke)
    for px, py in ((x0, y), (x1, y), (x1 - 20, y - 20), (x1 - 20, y + 20)):
        r = stroke / 2
        d.ellipse((px * s - r, py * s - r, px * s + r, py * s + r), fill=icon.CORAL + (255,))
    canvas = canvas.resize((WIDTH * scale, HEIGHT * scale), Image.LANCZOS)

    # Wordmark: the mark and "TenuVault", centred at the top.
    d = ImageDraw.Draw(canvas)
    title = font(FONTS, 26 * scale)
    mark_px = 36 * scale
    gap = 12 * scale
    text_w = d.textlength("TenuVault", font=title)
    left = (WIDTH * scale - (mark_px + gap + text_w)) / 2
    top = 40 * scale
    canvas.alpha_composite(mark(mark_px), (round(left), top))
    d.text((left + mark_px + gap, top + mark_px / 2), "TenuVault", font=title, fill=INK + (255,), anchor="lm")

    # Instruction under the wordmark, clear of the icon labels Finder draws.
    body = font(FONTS_REGULAR, 14 * scale)
    d.text((WIDTH * scale / 2, 104 * scale), "Drag TenuVault to Applications to install it", font=body,
           fill=MUTED + (255,), anchor="mm")
    return canvas.convert("RGB")


if __name__ == "__main__":
    for scale, name in ((1, "background.png"), (2, "background@2x.png")):
        path = ROOT / "build" / name
        image = render(scale)
        image.save(path, optimize=True, dpi=(72 * scale, 72 * scale))
        print(f"Wrote {path.relative_to(ROOT)} {image.width}x{image.height}")
