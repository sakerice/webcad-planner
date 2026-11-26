"""3 回目の試作（2026-11-27）。2 回目の並びに、AIレンダーの 1 枚を 5 枚目として足した 8 枚。

  python3 -I make3.py

AIレンダーの画面は PR #162（未マージ）の手元の環境で撮った物（../shoot/airender-*.png、説明は airender-README.md）。
出来上がり: R3-01.png〜R3-08.png、contact-sheet-R3.jpg、first3-R3.jpg、airender-pair.jpg
"""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make import make_p, sheet
from make2 import SHOTS as R2, SRC, make_pair

HERE = Path(__file__).resolve().parent
AIR = dict(pair=('airender-01-3d.png', 'airender-02-result.png'), lines=['歩いている3Dを、', '{写真のような絵}に。'])
SHOTS = R2[:4] + [AIR] + R2[4:]


def main():
    ps = []
    for n, s in enumerate(SHOTS, 1):
        if 'pair' in s:
            a, b = (Image.open(SRC / p).convert('RGB') for p in s['pair'])
            out = make_pair(a, b, s['lines'])
        else:
            out = make_p(Image.open(SRC / s['src']).convert('RGB'), s['lines'])
        p = HERE / f'R3-{n:02d}.png'
        out.save(p)
        ps.append(p)
        if s is AIR:
            out.convert('RGB').save(HERE / 'airender-pair.jpg', quality=88)
    sheet(ps, HERE / 'contact-sheet-R3.jpg', h=900)
    sheet(ps[:3], HERE / 'first3-R3.jpg')


if __name__ == '__main__':
    main()
