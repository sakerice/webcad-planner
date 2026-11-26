"""App Store の iPhone スクリーンショット（6.9 インチ、1320x2868）の試作を作る。

  python3 -I make.py [SRC_DIR] [--out DIR]

SRC_DIR には、実際の画面を撮った PNG（1320x2868）を置く。SHOTS の src の名前で読む。
省くと、2026-11-25 の試し撮りのフォルダ（TRIAL_DIR）を見る。本撮影の画像に替えるときは、
同じ名前で別のフォルダに置いて SRC_DIR に渡すか、SHOTS の src を書き換える。

出来上がり（--out を省くとこのファイルと同じフォルダ）:
  P-01.png〜P-07.png   体裁 P「上に見出し、下に画面」
  Q-01.png〜Q-03.png   体裁 Q「画面いっぱい＋帯」（1〜3 枚目だけ）
  contact-sheet-P.jpg  P の 7 枚を横に並べた一覧
  first3-P.jpg・first3-Q.jpg  検索結果で並んで見える最初の 3 枚

守ること: 画面の画素は描き足しも消しもしない（縮めて角を丸めるだけ）。見出しは画面の外（P）か、帯（Q）に置く。
端末の枠の絵は使わない。字はヒラギノ角ゴシック W8（macOS に入っている書体）。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
TRIAL_DIR = Path('/private/tmp/claude-501/-Users-nariiwa-Projects-webcad-planner--claude-worktrees-pr-76-update-19d733/'
                 'cd58c9fe-3b35-40a1-9c66-729eb89f82ae/scratchpad/promo-trial')

W, H = 1320, 2868
FONT = '/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc'

# 色はアプリの assets/app.css の変数から取った（--hp-bg・--hp-text・--hp-primary）
PAPER = (250, 247, 242)   # --hp-bg 淡い紙色
INK = (45, 42, 39)        # --hp-text 墨
CORAL = (242, 74, 46)     # --hp-primary 赤橙。見出しの中の {…} の部分をこの色にする

# 並び。lines は P の見出し（2 行まで、行は手で割る。{…} は赤橙）。q は Q の 1 行の見出し、q_band は Q の帯の上端（画面の画素）。
# q_band は画面の大事な所（家・窓・操作の部品）をなるべく隠さない位置を、画像ごとに目で見て決めた
SHOTS = [
    dict(src='20-iphone-3d-exterior-framed.png', lines=['描いた間取りが、', '{そのまま家}になる。'],
         q='描いた間取りが、{そのまま家}に。', q_band=430),
    dict(src='01-iphone-2d-1f.png', lines=['指先で、', '{間取りを描く}。'],
         q='指先で、{間取りを描く}。', q_band=2440),
    dict(src='22-iphone-walk-1st-ldk.png', lines=['建てる前に、', '{家の中を歩ける}。'],
         q='建てる前に、{家の中を歩ける}。', q_band=1062),
    dict(src='21-iphone-3d-interior-1f-ldk.png', lines=['家具の置き方まで、', '{立体で}確かめる。']),
    dict(src='06-iphone-ai-chat.png', lines=['『ソファを置いて』と', '{頼むだけ}。']),
    dict(src='00-iphone-start-choice.png', lines=['間取り図の写真から、', '{下書き}を作る。']),
    dict(src='27-iphone-kominka-exterior.png', lines=['外壁も内装も、', 'ひと押しで{別の家}に。']),
]

# ---- 体裁 P の寸法 ----
P_HEAD_H = 600        # 見出しの帯の高さ（全体の約 1/5）
P_FS = 112            # 見出しの字の大きさ（入らないときは自動で縮める）
P_LINE = 1.28         # 行の高さ
P_SIDE = 80           # 見出しの左右の余白
P_BOTTOM = 70         # 画面の下の余白
P_RADIUS = 96         # 画面の角の丸み（縮めた後の画素）
# ---- 体裁 Q の寸法 ----
Q_BAND_H = 220
Q_FS = 86
Q_BAND = (30, 28, 26, 200)   # 帯の色（墨、透明度 約 78%）
Q_CORAL = (255, 138, 112)    # 濃い帯の上で読める赤橙（--hp-primary を明るくした色）


def font(size):
    return ImageFont.truetype(FONT, size, index=0)


def parse(text):
    """'あ{い}う' を [('あ', False), ('い', True), ('う', False)] にする"""
    out, buf, hi = [], '', False
    for ch in text:
        if ch in '{}':
            if buf:
                out.append((buf, hi))
            buf, hi = '', ch == '{'
        else:
            buf += ch
    if buf:
        out.append((buf, hi))
    return out


def line_width(segs, f):
    return sum(f.getlength(s) for s, _ in segs)


def draw_line(draw, cx, y, text, f, base, accent):
    segs = parse(text)
    x = cx - line_width(segs, f) / 2
    for s, hi in segs:
        draw.text((x, y), s, font=f, fill=accent if hi else base)
        x += f.getlength(s)


def fit_size(texts, size, max_w):
    while size > 40 and max(line_width(parse(t), font(size)) for t in texts) > max_w:
        size -= 2
    return size


def rounded_mask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m


def make_p(scr, lines):
    img = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(img)
    fs = fit_size(lines, P_FS, W - 2 * P_SIDE)
    f = font(fs)
    lh = fs * P_LINE
    block = lh * (len(lines) - 1) + fs
    asc = f.getbbox('間')[1]  # 字の上の空き
    y0 = (P_HEAD_H - block) / 2 + 20 - asc
    for i, t in enumerate(lines):
        draw_line(d, W / 2, y0 + i * lh, t, f, INK, CORAL)

    # 画面を縦横同じ比で縮める（歪ませない）
    sh = H - P_HEAD_H - P_BOTTOM
    sw = round(scr.width * sh / scr.height)
    small = scr.resize((sw, sh), Image.LANCZOS)
    x, y = (W - sw) // 2, P_HEAD_H
    # 影
    sh_img = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh_img).rounded_rectangle((x, y + 18, x + sw, y + sh + 18), P_RADIUS, fill=70)
    sh_img = sh_img.filter(ImageFilter.GaussianBlur(40))
    img.paste(Image.new('RGB', (W, H), (63, 45, 28)), (0, 0), sh_img)
    img.paste(small, (x, y), rounded_mask((sw, sh), P_RADIUS))
    # 外の細い線（白い画面が紙の地に溶けないように）
    d = ImageDraw.Draw(img, 'RGBA')
    d.rounded_rectangle((x - 2, y - 2, x + sw + 1, y + sh + 1), P_RADIUS + 2, outline=(45, 42, 39, 40), width=3)
    return img


def make_q(scr, text, band_top):
    img = scr.convert('RGBA').resize((W, H), Image.LANCZOS) if scr.size != (W, H) else scr.convert('RGBA')
    over = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    d.rectangle((0, band_top, W, band_top + Q_BAND_H), fill=Q_BAND)
    fs = fit_size([text], Q_FS, W - 120)
    f = font(fs)
    asc = f.getbbox('間')[1]
    draw_line(d, W / 2, band_top + (Q_BAND_H - fs) / 2 - asc + 4, text, f, (255, 255, 255), Q_CORAL)
    return Image.alpha_composite(img, over).convert('RGB')


def sheet(paths, out, h=1000, gap=28, pad=48, bg=(226, 222, 215)):
    ims = [Image.open(p).convert('RGB') for p in paths]
    w = round(W * h / H)
    canvas = Image.new('RGB', (pad * 2 + len(ims) * w + (len(ims) - 1) * gap, pad * 2 + h), bg)
    for i, im in enumerate(ims):
        t = im.resize((w, h), Image.LANCZOS)
        r = 36
        canvas.paste(t, (pad + i * (w + gap), pad), rounded_mask((w, h), r))
    canvas.save(out, quality=88)


def main():
    args = sys.argv[1:]
    out = HERE
    if '--out' in args:
        i = args.index('--out')
        out = Path(args[i + 1])
        del args[i:i + 2]
    src = Path(args[0]) if args else TRIAL_DIR
    out.mkdir(parents=True, exist_ok=True)
    for n, s in enumerate(SHOTS, 1):
        scr = Image.open(src / s['src']).convert('RGB')
        if scr.size != (W, H):
            print(f'注意: {s["src"]} は {scr.size}。{W}x{H} を想定している')
        make_p(scr, s['lines']).save(out / f'P-{n:02d}.png')
        if 'q' in s:
            make_q(scr, s['q'], s['q_band']).save(out / f'Q-{n:02d}.png')
    sheet([out / f'P-{n:02d}.png' for n in range(1, len(SHOTS) + 1)], out / 'contact-sheet-P.jpg', h=900)
    sheet([out / f'P-{n:02d}.png' for n in (1, 2, 3)], out / 'first3-P.jpg')
    sheet([out / f'Q-{n:02d}.png' for n in (1, 2, 3)], out / 'first3-Q.jpg')
    print('書き出し:', out)


if __name__ == '__main__':
    main()
