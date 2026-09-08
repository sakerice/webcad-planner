#!/usr/bin/env python3
"""Generate seamless (tileable) modern-house exterior textures procedurally.

Outputs 512x512 JPEG (quality 82) files into assets/textures/:
  - wall_galvalume_dark.jpg  : dark standing-seam galvalume steel, vertical ribs
  - wall_plaster_white.jpg   : white textured plaster (jolypate-like)
  - wood_cedar_warm.jpg      : warm red-cedar horizontal siding
  - porch_tile_gray.jpg      : 300mm porcelain porch tile grid

All patterns are constructed periodically (integer feature counts across the
canvas, wrap-aware noise smoothing) so the images tile seamlessly in both
directions.

Usage:
  python3 tools/make_modern_textures.py [--out DIR] [--preview DIR]

--preview DIR additionally writes 2x2-tiled visual-check images.
"""

import argparse
import os
import zlib

import numpy as np
from PIL import Image

SIZE = 512
QUALITY = 82


def rng_for(name):
    """Deterministic per-texture RNG so re-runs are reproducible."""
    return np.random.default_rng(zlib.crc32(name.encode()))


def smooth_noise(rng, size, cells, amp):
    """Tileable low-frequency value noise in [-amp, +amp].

    Generates a small random grid and bilinearly interpolates it with
    wrap-around, which keeps the result periodic.
    """
    grid = rng.uniform(-1.0, 1.0, (cells, cells))
    coords = np.arange(size) * cells / size
    i0 = np.floor(coords).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = coords - np.floor(coords)
    # rows
    top = grid[i0[:, None], i0[None, :]] * (1 - f[None, :]) + \
          grid[i0[:, None], i1[None, :]] * f[None, :]
    bot = grid[i1[:, None], i0[None, :]] * (1 - f[None, :]) + \
          grid[i1[:, None], i1[None, :]] * f[None, :]
    out = top * (1 - f[:, None]) + bot * f[:, None]
    return out * amp


def wrap_blur_1d(a, radius, axis):
    """Box blur along one axis with wrap-around (keeps tileability)."""
    out = np.zeros_like(a, dtype=np.float64)
    n = 0
    for d in range(-radius, radius + 1):
        out += np.roll(a, d, axis=axis)
        n += 1
    return out / n


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def to_image(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------- galvalume

def make_galvalume():
    rng = rng_for('galvalume')
    base = hex_rgb('#2f3338')
    hi = hex_rgb('#3a3f45')
    sh = hex_rgb('#24272b')

    img = np.ones((SIZE, SIZE, 3)) * base

    # Vertical brushed-metal noise: fine noise heavily blurred vertically
    # (wrap-aware) -> faint vertical streaks.
    streaks = wrap_blur_1d(rng.uniform(-1, 1, (SIZE, SIZE)), 24, axis=0) * 14.0
    # Per-column tone drift, very subtle.
    col = wrap_blur_1d(rng.uniform(-1, 1, SIZE), 6, axis=0) * 2.0
    img += (streaks + col[None, :])[:, :, None]

    # Faint per-pixel grain.
    img += rng.uniform(-1.5, 1.5, (SIZE, SIZE))[:, :, None]

    # 12 ribs -> spacing 512/12 = 42.67px (integer count keeps it seamless).
    n_ribs = 12
    for i in range(n_ribs):
        c = int(round(i * SIZE / n_ribs)) % SIZE
        img[:, (c - 1) % SIZE] = sh * 0.6 + img[:, (c - 1) % SIZE] * 0.4  # soft lead-in shadow
        img[:, c] = hi
        img[:, (c + 1) % SIZE] = hi
        img[:, (c + 2) % SIZE] = sh
    return to_image(img)


# ------------------------------------------------------------------ plaster

def make_plaster():
    rng = rng_for('plaster')
    base = hex_rgb('#f1efe9')
    img = np.ones((SIZE, SIZE, 3)) * base
    # Fine random grain, +-6 levels.
    img += rng.uniform(-6, 6, (SIZE, SIZE))[:, :, None]
    # Very subtle low-frequency trowel mottling, +-3 levels.
    img += (smooth_noise(rng, SIZE, 6, 3.0) +
            smooth_noise(rng, SIZE, 13, 1.5))[:, :, None]
    return to_image(img)


# -------------------------------------------------------------------- cedar

def make_cedar():
    rng = rng_for('cedar')
    c_a = hex_rgb('#8a6a48')
    c_b = hex_rgb('#a37c52')

    n_boards = 6  # 512/6 = 85.33px per board
    board_h = SIZE / n_boards
    img = np.zeros((SIZE, SIZE, 3))

    ys = np.arange(SIZE)
    xs = np.arange(SIZE)

    for b in range(n_boards):
        y0 = int(round(b * board_h))
        y1 = int(round((b + 1) * board_h))
        h = y1 - y0
        t = rng.uniform(0, 1)
        base = c_a * (1 - t) + c_b * t
        base = base * rng.uniform(0.96, 1.04)  # slight per-board lightness

        # Periodic 1D grain profile along the board height (wrap-smoothed).
        prof = wrap_blur_1d(rng.uniform(-1, 1, h), 2, axis=0)
        prof = prof / (np.abs(prof).max() + 1e-9)

        # Wavy sampling: integer wave counts keep horizontal seamlessness.
        k1, k2 = rng.integers(2, 5), rng.integers(5, 9)
        ph1, ph2 = rng.uniform(0, 2 * np.pi, 2)
        wave = (2.6 * np.sin(2 * np.pi * k1 * xs / SIZE + ph1) +
                1.2 * np.sin(2 * np.pi * k2 * xs / SIZE + ph2))

        yy = (ys[y0:y1, None] - y0) + wave[None, :]
        idx = np.mod(np.round(yy).astype(int), h)
        grain = prof[idx]  # (h, SIZE)

        # Darken where grain profile dips: thin dark streaks.
        dark = np.where(grain < -0.35, (grain + 0.35) * 38.0, 0.0)
        # Broad soft tone variation from the same profile.
        tone = grain * 7.0

        block = base[None, None, :] + (tone + dark)[:, :, None]
        # Slight reddish shift in the dark streaks feels more like cedar.
        block[:, :, 2] += dark * 0.15
        img[y0:y1] = block

    # Fine grain noise.
    img += rng.uniform(-3, 3, (SIZE, SIZE))[:, :, None]

    # 1px shadow at every board seam (b=0 covers the wrap edge).
    for b in range(n_boards):
        y = int(round(b * board_h)) % SIZE
        img[y] *= 0.72
        img[(y + 1) % SIZE] *= 0.9  # softer second line
    return to_image(img)


# --------------------------------------------------------------- porch tile

def make_porch_tile():
    rng = rng_for('porch')
    grout = hex_rgb('#9a9a96')
    face = hex_rgb('#b9b8b4')

    n = 3  # 512/3 = 170.67px -> ~300mm tiles at this texture scale
    img = np.ones((SIZE, SIZE, 3)) * face

    # Slight per-tile brightness variation.
    for i in range(n):
        for j in range(n):
            x0, x1 = int(round(i * SIZE / n)), int(round((i + 1) * SIZE / n))
            y0, y1 = int(round(j * SIZE / n)), int(round((j + 1) * SIZE / n))
            img[y0:y1, x0:x1] *= rng.uniform(0.985, 1.015)

    # Fine surface noise on the tile faces.
    img += rng.uniform(-4, 4, (SIZE, SIZE))[:, :, None]
    # Extremely subtle mottling.
    img += smooth_noise(rng, SIZE, 9, 2.0)[:, :, None]

    # 3px grout lines on the 3x3 grid (line at 0 covers the wrap edge).
    grout_img = np.ones((SIZE, SIZE, 3)) * grout
    grout_img += rng.uniform(-3, 3, (SIZE, SIZE))[:, :, None]
    for i in range(n):
        p = int(round(i * SIZE / n)) % SIZE
        for d in range(3):
            q = (p + d) % SIZE
            img[q, :] = grout_img[q, :]
            img[:, q] = grout_img[:, q]
    return to_image(img)


# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'assets', 'textures'))
    ap.add_argument('--preview', default=None,
                    help='directory for 2x2 tiled seam-check previews')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    textures = {
        'wall_galvalume_dark.jpg': make_galvalume,
        'wall_plaster_white.jpg': make_plaster,
        'wood_cedar_warm.jpg': make_cedar,
        'porch_tile_gray.jpg': make_porch_tile,
    }
    for name, fn in textures.items():
        img = fn()
        path = os.path.join(args.out, name)
        img.save(path, 'JPEG', quality=QUALITY)
        print(f'{path}  {os.path.getsize(path)} bytes')
        if args.preview:
            os.makedirs(args.preview, exist_ok=True)
            tiled = Image.new('RGB', (SIZE * 2, SIZE * 2))
            for dx in (0, SIZE):
                for dy in (0, SIZE):
                    tiled.paste(img, (dx, dy))
            ppath = os.path.join(args.preview,
                                 name.replace('.jpg', '_tiled2x2.jpg'))
            tiled.save(ppath, 'JPEG', quality=88)
            print(f'  preview: {ppath}')


if __name__ == '__main__':
    main()
