"""App Store 用アイコンを、元の絵 assets/brand/house-planner-mobile-icon.png から作る。

作る物（このファイルと同じフォルダ）:
  AppIcon-1024.png              今の配色のまま 1024x1024 RGB
  AppIcon-inverted-1024.png     朱色と白を入れ替えた版（手の縁取りは白のまま）
  AppIcon-inverted-alt-1024.png 朱色と白を入れ替えた版（手の縁取りも朱色）
  compare-sizes.png             180〜29px を白地と濃い地で並べた比較
  compare-home.png              ホーム画面（明るい壁紙・暗い壁紙）に置いた比較

反転のしかた: 各画素を「白・朱色・青」の3色の混ざり具合（足して1）に分け、
白と朱色の割合を入れ替えて組み直す。輪郭の中間色も同じ割合で組み直すので、
アンチエイリアスがそのまま残る。青の割合はそのまま。
手の縁取り（青のまわり約14px）だけは、白の割合を白のまま残す版も作る。

実行: python3 -I docs/store/app-icon/make_icons.py （リポジトリの最上位で）
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SRC = ROOT / "assets/brand/house-planner-mobile-icon.png"

WHITE = np.array([254.0, 254.0, 254.0])
ORANGE = np.array([253.0, 56.0, 27.0])  # 家の朱色（中央値）
BLUE = np.array([1.0, 171.0, 248.0])  # 手の青（中央値）
BORDER_PX = 14  # 元の絵での手の白い縁取りの太さ
# 縁取りと朱色の境目のぼかし（約2px）まで白に含めるため、マスクは少し太らせる
MASK_PX = BORDER_PX + 2


def unmix(img):
    """各画素を白・朱色・青の重み (h,w,3) に分ける。重みは 0 以上で足して 1。"""
    px = img.reshape(-1, 3)
    # p = W + b*(O-W) + c*(B-W) を最小二乗で解く
    M = np.stack([ORANGE - WHITE, BLUE - WHITE], axis=1)  # 3x2
    sol, *_ = np.linalg.lstsq(M, (px - WHITE).T, rcond=None)
    b, c = np.clip(sol[0], 0, 1), np.clip(sol[1], 0, 1)
    s = b + c
    over = s > 1
    b[over] /= s[over]
    c[over] /= s[over]
    a = 1 - b - c
    w = np.stack([a, b, c], axis=1)
    # 元の絵の平らな面にある細かいむら（白の中の 249,249,253 など）は、反転すると
    # うすいピンクの点になる。5% 未満の混ざりは切り捨て、残りで足して 1 に戻す。
    w = np.maximum(w - 0.05, 0)
    w /= w.sum(axis=1, keepdims=True)
    return w.reshape(img.shape[0], img.shape[1], 3)


def border_mask(blue_w, radius):
    """青の重みを円で太らせた柔らかいマスク。縁取りの外形になる。"""
    h, w = blue_w.shape
    pad = radius + 2
    padded = np.pad(blue_w, pad)
    out = np.zeros_like(blue_w)
    r2 = (radius + 0.5) ** 2
    for dy in range(-radius - 1, radius + 2):
        for dx in range(-radius - 1, radius + 2):
            d2 = dx * dx + dy * dy
            if d2 > (radius + 1.5) ** 2:
                continue
            # 円の縁を 1px でなめらかに落とす
            wgt = float(np.clip(radius + 1.0 - np.sqrt(d2), 0, 1))
            if wgt <= 0:
                continue
            sh = padded[pad + dy:pad + dy + h, pad + dx:pad + dx + w] * wgt
            np.maximum(out, sh, out=out)
    return out


def build():
    src = Image.open(SRC).convert("RGB")
    arr = np.asarray(src).astype(np.float64)
    wts = unmix(arr)
    a, b, c = wts[..., 0:1], wts[..., 1:2], wts[..., 2:3]

    m = border_mask(wts[..., 2], MASK_PX)[..., None]
    # 縁取りを朱色にする版: 白と朱色をそのまま入れ替える
    inv_orange = a * ORANGE + b * WHITE + c * BLUE
    # 縁取りを白のまま残す版: 縁取りの範囲の白は白のまま
    inv_white = a * (m * WHITE + (1 - m) * ORANGE) + b * WHITE + c * BLUE

    def save(rgb, name):
        im = Image.fromarray(np.clip(np.rint(rgb), 0, 255).astype(np.uint8))
        im = im.resize((1024, 1024), Image.LANCZOS)
        im.save(OUT / name, optimize=True)
        return im

    orig = src.resize((1024, 1024), Image.LANCZOS)
    orig.save(OUT / "AppIcon-1024.png", optimize=True)
    # どちらを本命にするかは見比べて決めた（README 参照）。名前の割り当てはここだけ。
    main = save(inv_white, "AppIcon-inverted-1024.png")
    alt = save(inv_orange, "AppIcon-inverted-alt-1024.png")
    return [("今の配色", orig), ("反転", main), ("反転（縁も朱）", alt)]


# ---- 比較画像 ----
FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
FONT_B = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"


def rounded(icon, size):
    ss = 4
    big = icon.resize((size * ss, size * ss), Image.LANCZOS)
    mask = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * ss - 1, size * ss - 1), radius=round(size * ss * 0.224), fill=255)
    small = icon.resize((size, size), Image.LANCZOS)
    return small, mask.resize((size, size), Image.LANCZOS)


def paste_icon(canvas, icon, size, x, y):
    im, mask = rounded(icon, size)
    canvas.paste(im, (int(x), int(y)), mask)


def compare_sizes(icons):
    sizes = [180, 120, 80, 58, 40, 29]
    label_w, row_h, head_h = 230, 230, 70
    xs, x = [], label_w
    for s in sizes:
        xs.append(x)
        x += max(s, 60) + 34
    width = x + 10
    block_h = head_h + row_h * len(icons) + 10
    img = Image.new("RGB", (width, block_h * 2), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 22)
    fl = ImageFont.truetype(FONT_B, 30)
    for blk, (bg, fg) in enumerate([((255, 255, 255), (40, 40, 40)), ((28, 28, 30), (235, 235, 235))]):
        y0 = blk * block_h
        d.rectangle((0, y0, width, y0 + block_h), fill=bg)
        for s, x in zip(sizes, xs):
            cx = x + max(s, 60) / 2
            d.text((cx, y0 + 32), f"{s}px", font=f, fill=fg, anchor="mm")
        for i, (name, icon) in enumerate(icons):
            cy = y0 + head_h + row_h * i + row_h / 2
            d.text((20, cy), name, font=fl, fill=fg, anchor="lm")
            for s, x in zip(sizes, xs):
                cx = x + max(s, 60) / 2
                paste_icon(img, icon, s, cx - s / 2, cy - s / 2)
    img.save(OUT / "compare-sizes.png", optimize=True)


def gradient(w, h, stops):
    ys = np.linspace(0, 1, h)[:, None]
    out = np.zeros((h, w, 3))
    pos = [p for p, _ in stops]
    for ch in range(3):
        out[..., ch] = np.interp(ys, pos, [c[ch] for _, c in stops])
    return Image.fromarray(out.astype(np.uint8))


def compare_home(icons):
    W, H = 1860, 1868
    img = Image.new("RGB", (W, H), (238, 236, 232))
    d = ImageDraw.Draw(img)
    ft = ImageFont.truetype(FONT_B, 40)
    fn = ImageFont.truetype(FONT, 22)
    placeholders = [(238, 150, 122), (110, 150, 228), (122, 190, 122), (248, 200, 82),
                    (142, 150, 160), (150, 130, 220), (90, 180, 188)]
    slots = {(1, 1): 0, (2, 3): 1, (3, 0): 2}
    for p, dark in enumerate([False, True]):
        ox = 60 + p * 900
        d.rounded_rectangle((ox, 60, ox + 840, 1808), radius=150, fill=(20, 20, 22))
        if dark:
            wall = gradient(780, 1688, [(0, (24, 24, 28)), (1, (24, 24, 28))])
        else:
            wall = gradient(780, 1688, [(0, (255, 214, 190)), (0.3, (238, 232, 218)),
                                        (0.55, (200, 222, 214)), (0.8, (210, 200, 210)),
                                        (1, (160, 205, 235))])
        m = Image.new("L", wall.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, 779, 1687), radius=120, fill=255)
        img.paste(wall, (ox + 30, 90), m)
        fg = (240, 240, 240) if dark else (25, 25, 25)
        d.text((ox + 100, 142), "9:41", font=ft, fill=fg, anchor="lm")
        k = 0
        for r in range(6):
            for col in range(4):
                x = ox + 84 + col * 180
                y = 240 + r * 196
                if (r, col) in slots:
                    paste_icon(img, icons[slots[(r, col)]][1], 120, x, y)
                    d.text((x + 60, y + 140), "間取り3D", font=fn, fill=fg, anchor="mm")
                else:
                    d.rounded_rectangle((x, y, x + 119, y + 119), radius=27,
                                        fill=placeholders[(k * 3 + r) % len(placeholders)])
                    bar = (150, 150, 150) if dark else (70, 70, 70)
                    bw = 56 + (k * 13) % 30
                    d.rounded_rectangle((x + 60 - bw / 2, y + 133, x + 60 + bw / 2, y + 147),
                                        radius=7, fill=bar)
                k += 1
        dock = (52, 54, 60) if dark else (215, 225, 236)
        d.rounded_rectangle((ox + 48, 1542, ox + 792, 1738), radius=60, fill=dock)
        for col in range(4):
            x = ox + 84 + col * 180
            d.rounded_rectangle((x, 1580, x + 119, 1699), radius=27,
                                fill=placeholders[(col * 2 + 2) % len(placeholders)])
        # 名前の凡例
        names = "　".join(f"{lab}: {icons[i][0]}" for lab, i in
                         zip(["2段目", "3段目", "4段目"], [0, 1, 2]))
    d.text((W / 2, 1840), names, font=fn, fill=(90, 90, 90), anchor="mm")
    img.save(OUT / "compare-home.png", optimize=True)


if __name__ == "__main__":
    icons = build()
    compare_sizes(icons)
    compare_home(icons)
    print("ok")
