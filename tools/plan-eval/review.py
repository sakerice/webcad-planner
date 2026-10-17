#!/usr/bin/env python3
"""正解プランの確認画面（1枚の HTML）を作る。

図面の画像の上に正解の壁・部屋・建具を描き、押すとその設定が出て、その場に
コメントを置ける。コメントは Artifact の db（comments コレクション）に入り、
Claude が読み出して正解を直す。言葉だけで「どの壁か」をやり取りしないため。

    python3 tools/plan-eval/review.py madori-3f <出力.html>

画像は fixtures.json の範囲を JPEG にして埋め込む（外部の画像は読めないため）。
"""
import base64
import io
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")


def page_image(pdf, pg):
    x, y, w, h = pg["crop"]
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, "p")
        subprocess.run(["pdftoppm", "-r", str(pg["dpi"]), "-f", str(pg["page"]), "-l", str(pg["page"]),
                        "-x", str(x), "-y", str(y), "-W", str(w), "-H", str(h),
                        "-png", "-singlefile", pdf, base], check=True)
        img = Image.open(base + ".png").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=72, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), img.size


def main():
    name, out = sys.argv[1], sys.argv[2]
    fx = json.load(open(os.path.join(HERE, "fixtures.json"), encoding="utf-8"))[name]
    plan = json.load(open(os.path.join(ROOT, fx["truth"]), encoding="utf-8"))
    pdf = os.path.join(ROOT, fx["pdf"])
    pages = []
    for pg in fx["pages"]:
        # 図面のある範囲（その階の壁の外形 + 寸法線ぶんの余白）だけに詰める。余白が広いと要素が小さくて押しにくい。
        ws = [w for w in plan["walls"] if w.get("floor", 1) == pg["floor"]]
        ox, oy = pg["originPx"]
        sx, sy = pg["mmPerPx"]
        xs = [ox + v / sx for w in ws for v in (w["x1"], w["x2"])]
        ys = [oy + v / sy for w in ws for v in (w["y1"], w["y2"])]
        pad = 130
        x0, y0 = max(0, int(min(xs)) - pad), max(0, int(min(ys)) - pad)
        x1, y1 = min(pg["crop"][2], int(max(xs)) + pad), min(pg["crop"][3], int(max(ys)) + pad)
        tight = dict(pg, crop=[pg["crop"][0] + x0, pg["crop"][1] + y0, x1 - x0, y1 - y0])
        url, size = page_image(pdf, tight)
        pages.append({"floor": pg["floor"], "image": url, "size": list(size),
                      "originPx": [ox - x0, oy - y0], "mmPerPx": pg["mmPerPx"]})
    # 向き（扉の吊り元・開く側、階段の上る向き、家具の正面）は採点と同じ計算で付ける。
    notes = json.loads(subprocess.run(
        ["node", "-e", "const s=require(process.argv[1]);const p=require(process.argv[2]);"
         "process.stdout.write(JSON.stringify(s.annotate(p)))",
         os.path.join(HERE, "score.cjs"), os.path.abspath(os.path.join(ROOT, fx["truth"]))],
        check=True, capture_output=True, text=True).stdout)
    keep = lambda o, keys: {k: o[k] for k in keys if k in o}
    data = {
        "fixture": name,
        "subtitle": "%s ・ 図面の寸法線から起こした下書き。違うところを押してコメントしてください" % os.path.basename(fx["pdf"]),
        "pages": pages,
        "plan": {
            "walls": [keep(w, ("id", "x1", "y1", "x2", "y2", "floor", "memo")) for w in plan["walls"]],
            "rooms": [keep(r, ("id", "x", "y", "w", "d", "floor", "n", "memo")) for r in plan["rooms"]],
            "items": [dict(keep(i, ("id", "type", "x", "y", "w", "d", "rot", "floor", "memo", "face")),
                           note=notes.get(str(i["id"]), {})) for i in plan["items"]],
        },
    }
    # </script> で JSON が途切れないようにする。
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = open(os.path.join(HERE, "review-template.html"), encoding="utf-8").read().replace("__DATA__", blob).replace(
        "<title>正解プランの確認</title>", "<title>%s 正解チェック</title>" % name, 1)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("%s  %d KB" % (out, len(html.encode()) // 1024))


if __name__ == "__main__":
    main()
