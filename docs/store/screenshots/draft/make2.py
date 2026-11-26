"""2 回目の試作（2026-11-26 の利用者の指示を入れた並び）。make.py の部品を使う。

  python3 -I make2.py

変えた所: 2 枚目を「間取り図を読み込むと 3D の家になる」の 2 画面並びに、3 枚目を女性の三人称（広い画角）にした。
画面の元の画像は ../shoot/ にある（試し撮りの 5 枚は trial-*.png として写してある）。
出来上がり: R2-01.png〜R2-07.png、contact-sheet-R2.jpg、first3-R2.jpg
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make import (W, H, PAPER, INK, CORAL, P_HEAD_H, P_FS, P_LINE, P_SIDE, P_RADIUS,
                  font, draw_line, fit_size, rounded_mask, make_p, sheet)

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / 'shoot'

SHOTS = [
    dict(src='trial-20-iphone-3d-exterior-framed.png', lines=['描いた間取りが、', '{そのまま家}になる。']),
    dict(pair=('import-a.png', 'import-e.png'), lines=['検討中の間取り図を', '読み込むと、{3Dの家}に。']),
    dict(src='walk3rd-03-fov90.png', lines=['建てる前に、', '{家の中を歩ける}。']),
    dict(src='trial-21-iphone-3d-interior-1f-ldk.png', lines=['家具の置き方まで、', '{立体で}確かめる。']),
    dict(src='trial-01-iphone-2d-1f.png', lines=['指先で、', '{間取りを描く}。']),
    dict(src='trial-06-iphone-ai-chat.png', lines=['『ソファを置いて』と', '{頼むだけ}。']),
    dict(src='trial-27-iphone-kominka-exterior.png', lines=['外壁も内装も、', 'ひと押しで{別の家}に。']),
]


def place(img, scr, x, y, sw, sh, r):
    small = scr.resize((sw, sh), Image.LANCZOS)
    sh_img = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh_img).rounded_rectangle((x, y + 14, x + sw, y + sh + 14), r, fill=70)
    sh_img = sh_img.filter(ImageFilter.GaussianBlur(30))
    img.paste(Image.new('RGB', (W, H), (63, 45, 28)), (0, 0), sh_img)
    img.paste(small, (x, y), rounded_mask((sw, sh), r))
    ImageDraw.Draw(img, 'RGBA').rounded_rectangle((x - 2, y - 2, x + sw + 1, y + sh + 1), r + 2,
                                                  outline=(45, 42, 39, 40), width=3)


def make_pair(a, b, lines):
    """2 つの画面を、左上と右下に少しずらして並べる。間に矢印を 1 つ置く（画面の画素には触れない）"""
    img = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(img)
    fs = fit_size(lines, P_FS, W - 2 * P_SIDE)
    f = font(fs)
    lh = fs * P_LINE
    block = lh * (len(lines) - 1) + fs
    asc = f.getbbox('間')[1]
    y0 = (P_HEAD_H - block) / 2 + 20 - asc
    for i, t in enumerate(lines):
        draw_line(d, W / 2, y0 + i * lh, t, f, INK, CORAL)
    sw = 730
    sh = round(a.height * sw / a.width)
    place(img, a, 40, P_HEAD_H, sw, sh, 56)
    place(img, b, W - 40 - sw, H - 60 - sh, sw, sh, 56)
    # 矢印（左の画面の下から右の画面へ）
    d = ImageDraw.Draw(img)
    cx, cy = 300, P_HEAD_H + sh + 250
    d.line((cx - 90, cy - 150, cx - 90, cy, cx + 150, cy), fill=CORAL, width=26, joint='curve')
    d.polygon((cx + 150, cy - 60, cx + 250, cy, cx + 150, cy + 60), fill=CORAL)
    return img


def main():
    for n, s in enumerate(SHOTS, 1):
        if 'pair' in s:
            a, b = (Image.open(SRC / p).convert('RGB') for p in s['pair'])
            out = make_pair(a, b, s['lines'])
        else:
            out = make_p(Image.open(SRC / s['src']).convert('RGB'), s['lines'])
        out.save(HERE / f'R2-{n:02d}.png')
    ps = [HERE / f'R2-{n:02d}.png' for n in range(1, len(SHOTS) + 1)]
    sheet(ps, HERE / 'contact-sheet-R2.jpg', h=900)
    sheet(ps[:3], HERE / 'first3-R2.jpg')


if __name__ == '__main__':
    main()
