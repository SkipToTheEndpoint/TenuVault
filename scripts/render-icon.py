"""Renders the TenuVault app and tray icons: a vault door with a coral three spoke wheel handle.

The door is a charcoal ring with two hinge tabs on the left and a faint inner lip, on a warm light
tile. The same mark is drawn in the app by src/renderer/components/BrandMark.tsx.

Outputs:
  build/icon.png                 1024x1024 on the macOS grid (824px tile, 185px radius); electron-builder
                                 turns it into .icns and .ico
  resources/trayTemplate.png     16x16 black on transparent, macOS menu bar template image
  resources/trayTemplate@2x.png  32x32 black on transparent
  resources/tray.png             32x32 all coral, readable on light and dark Windows taskbars

Run: python3 scripts/render-icon.py
"""
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent

CHARCOAL = (43, 41, 39)  # gray-800 #2B2927
CORAL = (228, 103, 75)  # coral-500 #E4674B
TILE_TOP = (252, 251, 249)
TILE_BOTTOM = (236, 233, 229)
TILE_EDGE = (120, 110, 100)


def point(r: float, deg: float) -> tuple[float, float]:
    """Point at radius r and angle deg (counterclockwise from 3 o'clock) around the centre of a 1024 box."""
    a = math.radians(deg)
    return 512 + r * math.cos(a), 512 - r * math.sin(a)


def spoke(r0: float, r1: float, deg: float, width: float) -> list[tuple[float, float]]:
    a = math.radians(deg)
    nx, ny = -math.sin(a) * width / 2, -math.cos(a) * width / 2
    (x0, y0), (x1, y1) = point(r0, deg), point(r1, deg)
    return [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]


# A mark is a list of (layer, kind, geometry, alpha) in a 1024 unit box. Layer "door" or "handle"
# paints that layer, "cut" clears every layer painted so far.
def large_mark() -> list:
    ops = [
        ("door", "circle", (512, 512, 300), 1), ("cut", "circle", (512, 512, 238), 1),
        ("door", "rect", (178, 392, 248, 462, 18), 1),  # hinge tabs
        ("door", "rect", (178, 562, 248, 632, 18), 1),
        ("door", "circle", (512, 512, 212), 0.14), ("cut", "circle", (512, 512, 196), 1),  # inner lip
    ]
    for deg in (90, 210, 330):
        ops.append(("handle", "poly", spoke(0, 150, deg, 44), 1))
        ops.append(("handle", "circle", (*point(150, deg), 36), 1))
    ops += [("handle", "circle", (512, 512, 78), 1), ("cut", "circle", (512, 512, 26), 1)]
    return ops


def tray_mark() -> list:
    """Snapped to a 16px grid (64 units per pixel): 2px ring and hinges, hub and three spokes."""
    ops = [
        ("door", "circle", (512, 512, 448), 1), ("cut", "circle", (512, 512, 320), 1),
        ("door", "rect", (0, 320, 128, 448, 0), 1),
        ("door", "rect", (0, 576, 128, 704, 0), 1),
        ("handle", "circle", (512, 512, 112), 1),
    ]
    for deg in (90, 210, 330):
        ops.append(("handle", "poly", spoke(0, 240, deg, 76), 1))
    return ops


def paint(draw: ImageDraw.ImageDraw, kind: str, geo, scale: float, value: int) -> None:
    if kind == "circle":
        cx, cy, r = geo
        draw.ellipse(((cx - r) * scale, (cy - r) * scale, (cx + r) * scale - 1, (cy + r) * scale - 1), fill=value)
    elif kind == "rect":
        x0, y0, x1, y1, r = geo
        draw.rounded_rectangle((x0 * scale, y0 * scale, x1 * scale - 1, y1 * scale - 1), r * scale, fill=value)
    else:
        draw.polygon([(x * scale, y * scale) for x, y in geo], fill=value)


def layer_masks(ops: list, size: int) -> dict[str, Image.Image]:
    scale = size / 1024
    masks: dict[str, Image.Image] = {}
    for layer, kind, geo, alpha in ops:
        if layer == "cut":
            for mask in masks.values():
                paint(ImageDraw.Draw(mask), kind, geo, scale, 0)
        else:
            mask = masks.setdefault(layer, Image.new("L", (size, size), 0))
            paint(ImageDraw.Draw(mask), kind, geo, scale, round(255 * alpha))
    return masks


def vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    strip = Image.new("RGB", (1, 256))
    for y in range(256):
        strip.putpixel((0, y), tuple(round(a + (b - a) * y / 255) for a, b in zip(top, bottom)))
    return strip.resize((size, size), Image.BICUBIC).convert("RGBA")


def solid(size: int, color: tuple) -> Image.Image:
    return Image.new("RGBA", (size, size), color + (255,))


def render_app_icon() -> Image.Image:
    size, ss = 1024, 4
    s = size * ss
    margin, radius = 100 * ss, 185 * ss
    box = (margin, margin, s - margin - 1, s - margin - 1)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (margin, margin + 10 * ss, s - margin - 1, s - margin + 10 * ss - 1), radius, fill=(12, 11, 10, 90)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16 * ss)))

    tile = Image.new("L", (s, s), 0)
    ImageDraw.Draw(tile).rounded_rectangle(box, radius, fill=255)
    canvas.paste(vertical_gradient(s, TILE_TOP, TILE_BOTTOM), (0, 0), tile)

    # Hairline edge so the light tile holds its shape on light desktops and docks.
    edge = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(edge)
    d.rounded_rectangle(box, radius, fill=40)
    inset = 3 * ss
    d.rounded_rectangle((margin + inset, margin + inset, s - margin - inset - 1, s - margin - inset - 1), radius - inset, fill=0)
    canvas.paste(solid(s, TILE_EDGE), (0, 0), edge)

    masks = layer_masks(large_mark(), s)
    for layer, color in (("door", CHARCOAL), ("handle", CORAL)):
        fill = solid(s, color)
        fill.putalpha(masks[layer])
        canvas.alpha_composite(fill)
    return canvas.resize((size, size), Image.LANCZOS)


def render_tray(px: int, color: tuple) -> Image.Image:
    """Door and handle in one colour; alpha carries the shape, as macOS template images require."""
    ss = 16
    masks = layer_masks(tray_mark(), px * ss)
    alpha = ImageChops.lighter(masks["door"], masks["handle"]).resize((px, px), Image.BOX)
    out = Image.new("RGBA", (px, px), color + (0,))
    out.putalpha(alpha)
    return out


if __name__ == "__main__":
    outputs = {
        ROOT / "build" / "icon.png": render_app_icon(),
        ROOT / "resources" / "trayTemplate.png": render_tray(16, (0, 0, 0)),
        ROOT / "resources" / "trayTemplate@2x.png": render_tray(32, (0, 0, 0)),
        ROOT / "resources" / "tray.png": render_tray(32, CORAL),
    }
    for path, image in outputs.items():
        image.save(path, optimize=True)
        print(f"Wrote {path.relative_to(ROOT)} {image.width}x{image.height}")
