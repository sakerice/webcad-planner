#!/usr/bin/env python3
"""プラン（正解でも読み取り結果でも）を元の図面の上に重ねて描く。

正解プランを作ったら、まずこれで図面と重ねて見る。数字で比べる前に、
正解そのものがずれていないかを目で確かめるため。読み取り結果を重ねれば、
点数の内訳がどこで落ちたのかも図で分かる。

    python3 tools/plan-eval/overlay.py madori-3f <プラン.json> <出力の接頭辞> [--dx 0 --dy 0]

図面の画素と mm の対応は fixtures.json に書いてある（ページごと）。
赤=壁 / 青=部屋（名前） / 緑=窓 / 橙=扉。
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")


def font(size):
    for path in ("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
                 "/System/Library/Fonts/Hiragino Sans GB.ttc",
                 "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render_page(pdf, page, dpi, crop, out):
    x, y, w, h = crop
    base = out[:-4]
    subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(page), "-l", str(page),
                    "-x", str(x), "-y", str(y), "-W", str(w), "-H", str(h),
                    "-png", "-singlefile", pdf, base], check=True)
    return base + ".png"


def main():
    args = sys.argv[1:]
    opt = {}
    for k in ("dx", "dy"):
        if "--" + k in args:
            i = args.index("--" + k)
            opt[k] = float(args[i + 1])
            del args[i:i + 2]
    name, plan_path, prefix = args[0], args[1], args[2]
    fx = json.load(open(os.path.join(HERE, "fixtures.json"), encoding="utf-8"))[name]
    plan = json.load(open(plan_path, encoding="utf-8"))
    plan = plan.get("plan", plan)
    dx, dy = opt.get("dx", 0), opt.get("dy", 0)
    tmp = tempfile.mkdtemp()
    outs = []
    for pg in fx["pages"]:
        src = render_page(os.path.join(ROOT, fx["pdf"]), pg["page"], pg["dpi"], pg["crop"],
                          os.path.join(tmp, "p%d.png" % pg["page"]))
        img = Image.open(src).convert("RGB")
        img = Image.blend(img, Image.new("RGB", img.size, "white"), 0.35)
        d = ImageDraw.Draw(img)
        ox, oy = pg["originPx"]
        sx, sy = pg["mmPerPx"]
        P = lambda x, y: (ox + (x + dx) / sx, oy + (y + dy) / sy)
        f = pg["floor"]
        on = lambda o: (o.get("floor") or 1) == f
        for r in [r for r in plan.get("rooms", []) if on(r)]:
            a, b = P(r["x"], r["y"]), P(r["x"] + r["w"], r["y"] + r["d"])
            d.rectangle([a, b], outline=(40, 90, 220), width=2)
            d.text(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), r.get("n") or "?", fill=(40, 90, 220),
                   font=font(18), anchor="mm")
        for w in [w for w in plan.get("walls", []) if on(w)]:
            d.line([P(w["x1"], w["y1"]), P(w["x2"], w["y2"])], fill=(220, 30, 30), width=4)
        for it in [i for i in plan.get("items", []) if on(i)]:
            t = str(it.get("type", ""))
            if t.startswith("window"):
                col = (20, 160, 60)
            elif t.startswith("door-"):
                col = (240, 140, 0)
            else:
                col = (150, 150, 150)
            # アプリの物は中心で回る。90°・270°なら幅と奥行きが入れ替わって見える。
            w, dd = it["w"], it["d"]
            cx, cy = it["x"] + w / 2, it["y"] + dd / 2
            if round((it.get("rot") or 0) / 90) % 2:
                w, dd = dd, w
            a, b = P(cx - w / 2, cy - dd / 2), P(cx + w / 2, cy + dd / 2)
            d.rectangle([a, b], outline=col, width=3)
        d.text((10, 10), "%d階  %s" % (f, os.path.basename(plan_path)), fill=(0, 0, 0), font=font(22))
        out = "%s-%dF.png" % (prefix, f)
        img.save(out)
        outs.append(out)
    print("\n".join(outs))


if __name__ == "__main__":
    main()
