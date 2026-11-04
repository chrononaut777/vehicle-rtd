"""Rasterize public favicon assets from public/favicon.svg geometry.

Run: python scripts/build-favicon.py
"""
from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public"

BG = (18, 21, 26, 255)  # #12151a
PANEL = (26, 31, 39, 255)  # #1a1f27
GOLD = (212, 160, 23, 255)  # #d4a017
BLUE = (61, 139, 253, 255)  # #3d8bfd
WHITE = (232, 236, 241, 255)  # #e8ecf1
CLEAR = (0, 0, 0, 0)

# ⚡-style route: down-left, horizontal mid, down-left (matches favicon.svg)
ROUTE = [(19.0, 7.0), (10.5, 15.0), (21.5, 15.0), (13.0, 25.0)]
STOPS = [(19.0, 7.0), (13.0, 25.0)]


def draw_mark(size: int) -> Image.Image:
    """Vector-faithful supersampled mark (best for 32+)."""
    mul = 16 if size <= 32 else 8
    s = size * mul
    img = Image.new("RGBA", (s, s), CLEAR)
    d = ImageDraw.Draw(img)
    scale = s / 32.0

    def xy(x: float, y: float) -> tuple[float, float]:
        return (x * scale, y * scale)

    def rv(v: float) -> float:
        return v * scale

    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=rv(7), fill=BG)
    pad = rv(1.25)
    d.rounded_rectangle(
        [pad, pad, s - 1 - pad, s - 1 - pad], radius=rv(5.75), fill=PANEL
    )

    stroke = max(2, int(round(3.5 * scale)))
    pts = [xy(x, y) for x, y in ROUTE]
    d.line(pts, fill=GOLD, width=stroke, joint="curve")
    for p in pts:
        rr = stroke / 2
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=GOLD)

    R = rv(2.55)
    sw = rv(1.2)
    for sx, sy in STOPS:
        c = xy(sx, sy)
        d.ellipse(
            [c[0] - R - sw, c[1] - R - sw, c[0] + R + sw, c[1] + R + sw],
            fill=WHITE,
        )
        d.ellipse([c[0] - R, c[1] - R, c[0] + R, c[1] + R], fill=BLUE)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def draw_mark_16() -> Image.Image:
    """Pixel-grid tuned 16x16 for tab crispness."""
    img = Image.new("RGBA", (16, 16), CLEAR)
    px = img.load()
    corners = {
        (0, 0),
        (1, 0),
        (0, 1),
        (15, 0),
        (14, 0),
        (15, 1),
        (0, 15),
        (1, 15),
        (0, 14),
        (15, 15),
        (14, 15),
        (15, 14),
    }
    for y in range(16):
        for x in range(16):
            if (x, y) in corners:
                continue
            edge = x in (0, 15) or y in (0, 15) or x in (1, 14) or y in (1, 14)
            px[x, y] = BG if edge else PANEL

    d = ImageDraw.Draw(img)
    # Scaled ⚡: (19,7)->(10.5,15)->(21.5,15)->(13,25) in 32-space
    d.line([(9, 4), (5, 7), (11, 7), (6, 12)], fill=GOLD, width=2)
    for cx, cy in [(9, 4), (6, 12)]:
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            x, y = cx + dx, cy + dy
            if 0 <= x < 16 and 0 <= y < 16 and (x, y) not in corners:
                px[x, y] = WHITE
        px[cx, cy] = BLUE
    return img


def write_ico(path: Path, images: list[Image.Image]) -> None:
    entries: list[tuple[int, int, bytes]] = []
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        data = buf.getvalue()
        w, h = im.size
        entries.append((0 if w >= 256 else w, 0 if h >= 256 else h, data))

    offset = 6 + 16 * len(entries)
    parts = [struct.pack("<HHH", 0, 1, len(entries))]
    for w, h, data in entries:
        parts.append(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    with path.open("wb") as f:
        f.write(b"".join(parts))
        for _, _, data in entries:
            f.write(data)


def main() -> None:
    assets = {
        "favicon-16x16.png": draw_mark_16(),
        "favicon-32x32.png": draw_mark(32),
        "apple-touch-icon.png": draw_mark(180),
        "android-chrome-192x192.png": draw_mark(192),
        "android-chrome-512x512.png": draw_mark(512),
    }
    for name, im in assets.items():
        dest = OUT / name
        im.save(dest, format="PNG", optimize=True)
        print(f"wrote {name} {im.size} {dest.stat().st_size} bytes")

    ico_path = OUT / "favicon.ico"
    write_ico(ico_path, [assets["favicon-16x16.png"], assets["favicon-32x32.png"]])
    print(f"wrote favicon.ico {ico_path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
