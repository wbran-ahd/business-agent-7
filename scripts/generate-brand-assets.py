#!/usr/bin/env python3
"""
Generates the صوتی بقیہ brand raster assets:

  public/og-cover.png                 1200x630  WhatsApp / Open Graph card
  public/icons/icon-192.png            192x192  manifest (any)
  public/icons/icon-512.png            512x512  manifest (any)
  public/icons/icon-maskable-512.png   512x512  manifest (maskable, 80% safe zone)
  public/icons/apple-touch-icon.png    180x180  iOS home screen

The art deliberately mirrors the app: dark slate mesh, glowing sky horizon arc
and a glass mic. Nothing here is imported by the app at runtime — the files are
static so an OG scraper (WhatsApp, Facebook, Slack) can fetch them without JS.

Run with:  python3 scripts/generate-brand-assets.py
Requires:  pillow (with raqm for the Urdu line), and a Nastaliq TTF for the
           cover. The TTF is *not* committed; the script looks for it at
           $NASTALIQ_TTF and falls back to rendering without the Urdu line.
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
ICONS = os.path.join(PUBLIC, "icons")

BG = (15, 23, 42)
SKY = (56, 189, 248)
SKY_SOFT = (186, 230, 253)

BLOBS = [
    # (cx, cy, radius, colour, strength) — the same mesh as the app's CSS
    (0.04, 0.02, 0.52, (96, 165, 250), 0.52),
    (0.97, 0.97, 0.55, (234, 108, 76), 0.42),
    (0.08, 0.98, 0.50, (76, 29, 92), 0.62),
    (0.88, 0.02, 0.42, (13, 116, 144), 0.40),
]


def mesh(width: int, height: int) -> Image.Image:
    """Radial-gradient mesh, built small and upscaled so it stays smooth."""
    scale = 4
    w, h = max(2, width // scale), max(2, height // scale)
    canvas = Image.new("RGB", (w, h), BG)
    for cx, cy, radius, colour, strength in BLOBS:
        r = max(2, int(radius * max(w, h)))
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).ellipse(
            [int(cx * w) - r, int(cy * h) - r, int(cx * w) + r, int(cy * h) + r],
            fill=int(255 * min(1.0, strength)),
        )
        mask = mask.filter(ImageFilter.GaussianBlur(r * 0.55))
        canvas = Image.composite(Image.new("RGB", (w, h), colour), canvas, mask)
    return canvas.resize((width, height), Image.LANCZOS).filter(
        ImageFilter.GaussianBlur(max(1, width // 160))
    )


def glow_line(draw: ImageDraw.ImageDraw, points, colour, width, blur_radius, glow_alpha=110):
    """Draws a soft glow underneath a stroked path."""
    glow = Image.new("RGBA", draw._image.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).line(points, fill=colour + (glow_alpha,), width=width * 3, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(blur_radius))
    draw._image.alpha_composite(glow)
    draw.line(points, fill=colour + (255,), width=width, joint="curve")


def arc_points(width: int, baseline: int, apex: int, steps: int = 160):
    """Quadratic bezier from (0, base) to (w, base) with the apex in the middle."""
    mid = width / 2
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * 0 + 2 * (1 - t) * t * mid + t**2 * width
        y = (1 - t) ** 2 * baseline + 2 * (1 - t) * t * apex + t**2 * baseline
        pts.append((x, y))
    return pts


def mic(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float):
    """Simple mic glyph: capsule, cradle arc and stem."""
    body_w, body_h = size * 0.40, size * 0.62
    draw.rounded_rectangle(
        [cx - body_w / 2, cy - body_h / 2 - size * 0.05, cx + body_w / 2, cy + body_h * 0.45],
        radius=body_w / 2,
        outline=SKY_SOFT + (235,),
        width=max(2, int(size * 0.055)),
    )
    cradle = size * 0.40
    draw.arc(
        [cx - cradle, cy - cradle * 0.55, cx + cradle, cy + cradle * 0.85],
        start=15,
        end=165,
        fill=SKY_SOFT + (235,),
        width=max(2, int(size * 0.055)),
    )
    draw.line(
        [cx, cy + cradle * 0.85, cx, cy + cradle * 1.15],
        fill=SKY_SOFT + (235,),
        width=max(2, int(size * 0.055)),
    )


def glass_panel(size, radius, fill=(255, 255, 255, 14), border=(255, 255, 255, 46)):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill, outline=border, width=2)
    return layer


def latin_font(bold: bool = False) -> str:
    """Locates a Latin TTF that ships with matplotlib, so the script has no
    system-font dependency."""
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    candidates = [
        "/usr/share/fonts/truetype/dejavu/" + name,
        os.path.join(os.path.dirname(__import__("matplotlib").__file__), "mpl-data", "fonts", "ttf", name),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return name


def load_nastaliq(px: int) -> ImageFont.FreeTypeFont | None:
    candidates = [
        os.environ.get("NASTALIQ_TTF", ""),
        "/tmp/fonts/nastaliq.ttf",
        os.path.join(ROOT, "public", "fonts", "NotoNastaliqUrdu-Regular.ttf"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, px, layout_engine=ImageFont.Layout.RAQM)
            except Exception:  # pragma: no cover - environment specific
                return ImageFont.truetype(path, px)
    return None


def draw_text(draw, xy, text, font, fill, anchor="mm"):
    kwargs = {}
    try:
        kwargs = {"direction": "rtl", "language": "ur"}
        draw.text(xy, text, font=font, fill=fill, anchor=anchor, **kwargs)
    except Exception:  # pragma: no cover - very old Pillow / no raqm
        draw.text(xy, text, font=font, fill=fill, anchor=anchor)


def og_cover(width: int = 1200, height: int = 630) -> Image.Image:
    base = mesh(width, height).convert("RGBA")
    draw = ImageDraw.Draw(base)

    # Horizon arc across the lower third.
    glow_line(
        draw,
        arc_points(width + 160, height - 40, height - 300),
        SKY,
        max(4, height // 90),
        height // 42,
    )

    # Glass card
    card = glass_panel((width - 140, height - 150), 44)
    base.alpha_composite(card, (70, 55))

    panel = ImageDraw.Draw(base)
    panel.rounded_rectangle([70 + 44, 55 + 56, 70 + 54, 55 + 112], radius=5, fill=SKY + (230,))

    title_font = load_nastaliq(112)
    sub_font = load_nastaliq(38)
    latin_bold = ImageFont.truetype(latin_font(bold=True), 30)
    latin = ImageFont.truetype(latin_font(bold=False), 24)

    # Right-aligned Urdu copy (RTL layout). Nastaliq has deep descenders, so
    # every line gets a generous band of its own.
    right = width - 116
    if title_font:
        draw_text(panel, (right, 168), "صوتی بقیہ", title_font, (255, 255, 255, 255), anchor="rm")
        draw_text(panel, (right, 340), "اردو وائس فنانس اسسٹنٹ", sub_font, SKY_SOFT + (235,), anchor="rm")
    else:
        panel.text((right, 168), "Sauti Baqaya", font=latin_bold, fill="white", anchor="rm")
        panel.text((right, 340), "Urdu voice finance assistant", font=latin, fill=SKY_SOFT, anchor="rm")

    panel.text((right, 560), "sauti baqaya — voice ledger", font=latin, fill=(255, 255, 255, 120), anchor="rm")

    # Mic medallion on the visual left.
    cx, cy, r = 250, 320, 96
    medallion = Image.new("RGBA", (r * 3, r * 3), (0, 0, 0, 0))
    md = ImageDraw.Draw(medallion)
    md.ellipse([r // 2, r // 2, r * 2.5, r * 2.5], fill=(255, 255, 255, 20), outline=(255, 255, 255, 60), width=3)
    base.alpha_composite(medallion, (cx - r, cy - r))
    mic(ImageDraw.Draw(base), cx, cy, r * 1.15)

    return base.convert("RGB")


def app_icon(size: int, maskable: bool = False) -> Image.Image:
    scale = 2
    big = size * scale
    img = mesh(big, big).convert("RGBA")

    # Full-bleed gradient for maskable; inset glass tile otherwise.
    inset = int(big * 0.10) if not maskable else 0
    radius = int(big * 0.22)
    content = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(content)
    if not maskable:
        content.alpha_composite(glass_panel((big - 2 * inset, big - 2 * inset), radius), (inset, inset))

    glow_line(
        d,
        arc_points(big, big - inset - int(big * 0.10), big * 0.56),
        SKY,
        max(3, int(big * 0.022)),
        max(6, int(big * 0.05)),
    )
    mic(d, big * 0.5, big * 0.42, big * (0.30 if not maskable else 0.26))

    if not maskable:
        # Keep the arc inside the rounded tile so "any" icons look deliberate.
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [inset, inset, big - inset, big - inset], radius=radius, fill=255
        )
        content.putalpha(Image.composite(content.getchannel("A"), Image.new("L", (big, big), 0), mask))

    img.alpha_composite(content)
    return img.convert("RGB").resize((size, size), Image.LANCZOS)


def main() -> int:
    os.makedirs(ICONS, exist_ok=True)
    og_cover().save(os.path.join(PUBLIC, "og-cover.png"), optimize=True)
    app_icon(192).save(os.path.join(ICONS, "icon-192.png"), optimize=True)
    app_icon(512).save(os.path.join(ICONS, "icon-512.png"), optimize=True)
    app_icon(512, maskable=True).save(os.path.join(ICONS, "icon-maskable-512.png"), optimize=True)
    app_icon(180).save(os.path.join(ICONS, "apple-touch-icon.png"), optimize=True)
    print("brand assets written to public/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
