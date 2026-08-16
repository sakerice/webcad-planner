#!/usr/bin/env python3
"""内装のPBRテクスチャ(diffuse/normal/roughness)を手続き生成する。

■ なぜ作り直すのか
  既存の床は「板幅225mm・木口なし・繰り返し周期900mm・彩度C*35」だった。
  実写のオークは C*12〜22 で、C*35 はオレンジ色のプラスチックに見える。
  木口(板の短辺の継ぎ目)が1本も無いのも、床が壁紙に見える大きな原因。
  壁は法線マップが無く、色ムラだけで凹凸が無いので、どう塗ってもベタ塗りになる。

■ 実寸との対応(ここを間違えると全部ずれる)
  アプリはテクスチャ1枚を決まった実寸へ貼る。index.html の TEX_TILE_M が
  そのフットプリント(m)で、ここで作る画像はその寸法ちょうどの1タイルである。

    floor_wood  : 1818mm 角 / 1024px  → 1px = 1.7754mm
    floor_tile  : 1800mm 角 / 1024px  → 1px = 1.7578mm
    wall_plaster: 900mm 角 / 1024px  → 1px = 0.8789mm

  1818mm は複合フローリングの定尺(303×1818)。この寸法にすると実在の板幅
  (1P=303 / 2P=151.5 / 3P=101mm)が全部きれいに割り切れる。

■ 出力
  assets/textures/
    floor_wood_diffuse.jpg / _normal.jpg / _roughness.jpg   オーク 2P(151.5mm)
    floor_tile_diffuse.jpg / _normal.jpg / _roughness.jpg   600角 磁器質
    wall_plaster_white.jpg / wall_plaster_white_normal.jpg  外壁 塗り壁(白)
    wall_plaster_diffuse.jpg / wall_plaster_normal.jpg      内壁 塗り壁(グレージュ)

■ 実行
    python3 tools/make_interior_textures.py [--out DIR] [--preview DIR]
"""

import argparse
import os
import zlib

import numpy as np
from PIL import Image

SIZE = 1024
QUALITY = 88


def rng_for(name):
    return np.random.default_rng(zlib.crc32(name.encode()))


def smooth_noise(rng, size, cells, amp):
    """タイル境界で連続する低周波ノイズ。cells個の格子を巡回補間する。"""
    grid = rng.uniform(-1.0, 1.0, (cells, cells))
    coords = np.arange(size) * cells / size
    i0 = np.floor(coords).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = coords - np.floor(coords)
    top = grid[i0[:, None], i0[None, :]] * (1 - f[None, :]) + \
          grid[i0[:, None], i1[None, :]] * f[None, :]
    bot = grid[i1[:, None], i0[None, :]] * (1 - f[None, :]) + \
          grid[i1[:, None], i1[None, :]] * f[None, :]
    return (top * (1 - f[:, None]) + bot * f[:, None]) * amp


def wrap_blur_1d(a, radius, axis):
    out = np.zeros_like(a, dtype=np.float64)
    for d in range(-radius, radius + 1):
        out += np.roll(a, d, axis=axis)
    return out / (2 * radius + 1)


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def to_image(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def normal_from_height(height_mm, texel_mm, strength=1.0):
    """高さ場(mm)から接空間法線マップを作る。中心差分・巡回。

    法線は「面の傾き」そのもの。凹凸の振幅ではなく **傾き** が見えるので、
    テクセル間隔(実寸)で割らないと、解像度を変えたときに質感が変わる。
    """
    dzdx = (np.roll(height_mm, -1, axis=1) - np.roll(height_mm, 1, axis=1)) / (2 * texel_mm)
    dzdy = (np.roll(height_mm, -1, axis=0) - np.roll(height_mm, 1, axis=0)) / (2 * texel_mm)
    nx = -dzdx * strength
    ny = -dzdy * strength
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.zeros((height_mm.shape[0], height_mm.shape[1], 3))
    out[..., 0] = (nx / norm * 0.5 + 0.5) * 255
    out[..., 1] = (ny / norm * 0.5 + 0.5) * 255
    out[..., 2] = (nz / norm * 0.5 + 0.5) * 255
    return out


# ─────────────────────────────────────────────────────────────
# 床: オーク 2P(151.5mm) 定尺りゃんこ張り
# ─────────────────────────────────────────────────────────────
def make_wood_floor():
    name = 'floor_wood'
    rng = rng_for(name)
    px_mm = 1818.0 / SIZE
    rows = 12                      # 1818 / 151.5 = 12枚
    row_px = SIZE / rows

    light = hex_rgb('#CBBAA5')
    dark = hex_rgb('#BCA994')

    y = np.arange(SIZE)
    x = np.arange(SIZE)
    row_idx = (y / row_px).astype(int) % rows
    row_f = rng.uniform(0.0, 1.0, rows)             # 板ごとの色の振り分け
    row_gain = rng.uniform(0.985, 1.015, rows)      # 板ごとの明るさのばらつき

    base = np.zeros((SIZE, SIZE, 3))
    for c in range(3):
        base[..., c] = (light[c] + (dark[c] - light[c]) * row_f[row_idx])[:, None]
    base *= row_gain[row_idx][:, None, None]

    # 木目: 幅方向のプロファイルを作り、長手方向へ蛇行させて読む。
    # プロファイルを長手方向に作ると、木目が板を横切ってしまう。
    grain_profile = rng.uniform(-1.0, 1.0, (rows, int(row_px) + 2))
    tone = np.zeros((SIZE, SIZE))
    pore = np.zeros((SIZE, SIZE))
    for r in range(rows):
        prof = wrap_blur_1d(grain_profile[r][None, :], 2, axis=1)[0]
        k1 = rng.integers(2, 5)
        k2 = rng.integers(5, 10)
        mean = 2.2 * np.sin(2 * np.pi * k1 * x / SIZE) + 1.0 * np.sin(2 * np.pi * k2 * x / SIZE)
        y0 = int(r * row_px)
        y1 = int((r + 1) * row_px)
        for yy in range(y0, min(y1, SIZE)):
            idx = ((yy - y0) + mean).astype(int) % len(prof)
            g = prof[idx]
            tone[yy] = g * 4.5
            pore[yy] = np.where(g < -0.55, (g + 0.55) * 20.0, 0.0)
    arr = base + (tone + pore)[..., None]

    # 木口(板の短辺の継ぎ目)。1行1本、隣の行とは300mm以上ずらす
    butt_px = np.zeros(rows, dtype=int)
    prev = -10 ** 6
    for r in range(rows):
        for _ in range(64):
            cand = int(rng.integers(0, SIZE))
            if abs(cand - prev) * px_mm > 300 and abs(cand - prev) * px_mm < 1518:
                break
        butt_px[r] = cand
        prev = cand
    height = np.zeros((SIZE, SIZE))
    for r in range(rows):
        y0, y1 = int(r * row_px), min(int((r + 1) * row_px), SIZE)
        bx = butt_px[r]
        arr[y0:y1, bx] *= 0.91
        arr[y0:y1, (bx + 1) % SIZE] *= 0.99
        height[y0:y1, bx] -= 0.25

    # 実(さね)の目地。板の境目を1px落とす → ΔL* 6前後
    for r in range(rows):
        y0 = int(r * row_px)
        arr[y0] *= 0.90
        arr[(y0 + 1) % SIZE] *= 1.015
        height[y0] -= 0.35

    arr += rng.normal(0.0, 1.6, (SIZE, SIZE, 1))

    # 法線: 目地と木口の溝 + 導管のわずかな凹み
    height += pore * 0.02
    normal = normal_from_height(height, px_mm, strength=1.0)

    # 粗さ: 導管は光を散らすので粗く、板の面はマット塗装(0.48〜0.62)
    rough = 0.55 + (-pore) * 0.004 + smooth_noise(rng, SIZE, 16, 0.03)
    rough = np.clip(rough, 0.42, 0.72) * 255
    return {
        'floor_wood_diffuse': to_image(arr),
        'floor_wood_normal': to_image(normal),
        'floor_wood_roughness': to_image(np.repeat(rough[..., None], 3, axis=2)),
    }


# ─────────────────────────────────────────────────────────────
# 床: 600角 磁器質タイル(水まわり・玄関土間)
# ─────────────────────────────────────────────────────────────
def make_tile_floor():
    name = 'floor_tile'
    rng = rng_for(name)
    px_mm = 1800.0 / SIZE
    n = 3                              # 600mm 角 × 3
    tile_px = SIZE / n
    face = hex_rgb('#BFBDB8')
    grout = hex_rgb('#ADABA6')

    arr = np.repeat(np.repeat(face[None, None, :], SIZE, axis=0), SIZE, axis=1).astype(np.float64)
    arr += smooth_noise(rng, SIZE, 26, 3.2)[..., None]
    arr += smooth_noise(rng, SIZE, 7, 1.8)[..., None]

    ix = (np.arange(SIZE) / tile_px).astype(int) % n
    iy = (np.arange(SIZE) / tile_px).astype(int) % n
    gain = rng.uniform(0.988, 1.012, (n, n))
    arr *= gain[iy[:, None], ix[None, :]][..., None]

    # 目地3mm = 1.71px。1pxを全量、隣1pxを60%混ぜて3mm相当に見せる
    height = np.zeros((SIZE, SIZE))
    lines = [int(round(i * tile_px)) % SIZE for i in range(n)]
    for L in lines:
        arr[L, :] = grout
        arr[:, L] = grout
        nl = (L + 1) % SIZE
        arr[nl, :] = arr[nl, :] * 0.4 + grout * 0.6
        arr[:, nl] = arr[:, nl] * 0.4 + grout * 0.6
        height[L, :] -= 1.2
        height[:, L] -= 1.2
        height[nl, :] -= 0.7
        height[:, nl] -= 0.7

    arr += rng.normal(0.0, 2.0, (SIZE, SIZE, 1))
    normal = normal_from_height(height, px_mm, strength=1.0)
    # 磁器質はセミマット、目地はマット
    rough = 0.38 + (height < -0.5) * 0.30 + smooth_noise(rng, SIZE, 20, 0.02)
    rough = np.clip(rough, 0.30, 0.78) * 255
    return {
        'floor_tile_diffuse': to_image(arr),
        'floor_tile_normal': to_image(normal),
        'floor_tile_roughness': to_image(np.repeat(rough[..., None], 3, axis=2)),
    }


# ─────────────────────────────────────────────────────────────
# 壁: 塗り壁(コテ波)。凹凸の実体は法線マップ側にある
# ─────────────────────────────────────────────────────────────
def make_plaster(name, base_hex, out_diffuse, out_normal, seed_suffix=''):
    rng = rng_for(name + seed_suffix)
    px_mm = 900.0 / SIZE
    base = hex_rgb(base_hex)

    # 高さ場(mm)。4つのスケールを重ねる。合計 p-p ≈ 0.95mm
    h = smooth_noise(rng, SIZE, 8, 0.30)       # コテ波   周期112.5mm
    h += smooth_noise(rng, SIZE, 20, 0.12)     # 中ムラ   周期45mm
    h += smooth_noise(rng, SIZE, 72, 0.05)     # 細かい肌 周期12.5mm
    h += rng.normal(0.0, 0.08, (SIZE, SIZE))   # 骨材

    arr = np.repeat(np.repeat(base[None, None, :], SIZE, axis=0), SIZE, axis=1).astype(np.float64)
    arr += (h * 9.0)[..., None]                       # 凹凸に伴う陰影
    arr += smooth_noise(rng, SIZE, 8, 2.2)[..., None]  # 色ムラは ΔL*3 以下に抑える
    normal = normal_from_height(h, px_mm, strength=1.0)
    return {out_diffuse: to_image(arr), out_normal: to_image(normal)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/textures')
    ap.add_argument('--preview', default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    images = {}
    images.update(make_wood_floor())
    images.update(make_tile_floor())
    images.update(make_plaster('plaster_white', '#F2F0EB',
                               'wall_plaster_white', 'wall_plaster_white_normal'))
    images.update(make_plaster('plaster_int', '#EFEDE7',
                               'wall_plaster_diffuse', 'wall_plaster_normal', '_int'))

    for key, img in images.items():
        path = os.path.join(args.out, key + '.jpg')
        img.save(path, quality=QUALITY, subsampling=0)
        print('wrote %s (%dx%d)' % (path, img.width, img.height))

    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        for key, img in images.items():
            t = Image.new('RGB', (img.width * 2, img.height * 2))
            for i in range(2):
                for j in range(2):
                    t.paste(img, (i * img.width, j * img.height))
            t.resize((img.width, img.height)).save(
                os.path.join(args.preview, key + '_tile2x2.jpg'), quality=90)


if __name__ == '__main__':
    main()
