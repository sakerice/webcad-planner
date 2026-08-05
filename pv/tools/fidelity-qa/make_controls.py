#!/usr/bin/env python3
"""ゲートの合否分離を較正するための **合成対照** を作る。

閾値は「実際の生成物3系列」だけでは決められない。良い変化（生活感の追加）と
悪い変化（間取りの改変）の両方を、意図的に作った入力で分離できることを確認
する必要がある。そのための2種類を、ピクセル完全なアンカー（真実ベースレンダを
生成解像度へ落としたもの）の上に構成する。

  control-wall-removed/
      壁インスタンス1枚を消す。消し方は2通り用意する:
        flat    その壁自身のマスクのすぐ外側の色の平均で塗り潰す。
                「壁が別の面に置き換わった」に相当。輪郭のコントラストは
                残りやすいので、こちらは **難しい** 側の対照になる。
        inpaint 同じ走査線上でマスク外の最も近い画素を引き伸ばす。
                「壁が無くなり、周囲の面が続いている」に相当。
      どちらでも LOCKED ティアが落ちること、そしてどの壁かが名指しされる
      ことを確認する。

  control-added-object/
      人物大の不透明な図形（頭＋胴）を1体、床スラブの上に立てる。位置は
      **LOCKED カテゴリのシルエットを最も踏まない列** を総当たりで選ぶ
      （＝「開いた床に立っている」を機械的に保証する）。踏んだ画素数は
      ログに出るので、対照が知らぬ間に「壁を隠す物体」に化けたら分かる。
      これが FAIL しないことが、生活感の追加を罰しない性質の検査になる。

使い方:

    python3 pv/tools/fidelity-qa/make_controls.py \
        --truth pv/renders/T91-ldk-push --anchor /tmp/T91-perfect \
        --out /tmp/controls --wall-index 18

`--anchor` は「そのショットの真実ベースレンダを生成解像度へ落とした列」で
あることを前提とする。ここに実際の生成物を渡すと、対照が「生成の癖 + 改変」
の混合になり、閾値較正の役に立たない。
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import categories as cat
from metrics import dilate

FIGURE_W, FIGURE_H = 96, 330


def _rgb(hex_colour):
    h = str(hex_colour).lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def wall_instance_mask(truth: Path, index_name: str, wall_index: int, size):
    legend = json.loads((truth / "instance-legend.json").read_text())
    entry = next(e for e in legend["instances"]
                 if e.get("type") == "wall" and e.get("index") == wall_index)
    img = Image.open(truth / "instance" / f"{index_name}.png").convert("RGB")
    if img.size != size:
        img = img.resize(size, Image.NEAREST)
    arr = np.asarray(img)
    mask = np.all(arr == np.array(_rgb(entry["color"]), dtype=arr.dtype), axis=-1)
    return mask, f"wall#{entry.get('id')}"


def erase_flat(arr, mask):
    """マスクのすぐ外側の色の平均で塗り潰す。"""
    ring = dilate(mask, 3) & ~mask
    fill = (arr[ring].mean(axis=0).astype(np.uint8) if ring.any()
            else np.array([200, 200, 200], np.uint8))
    out = arr.copy()
    out[mask] = fill
    return out


def erase_inpaint(arr, mask):
    """同じ走査線上のマスク外で最も近い画素を引き伸ばす。"""
    out = arr.copy()
    h, _w = mask.shape
    for y in range(h):
        row = mask[y]
        if not row.any():
            continue
        good = np.nonzero(~row)[0]
        if good.size == 0:
            continue
        bad = np.nonzero(row)[0]
        nearest = good[np.abs(good[None, :] - bad[:, None]).argmin(axis=1)]
        out[y, bad] = arr[y, nearest]
    return out


def figure_mask(shape, cx, feet):
    img = Image.new("L", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(img)
    top = feet - FIGURE_H
    draw.ellipse([cx - 34, top, cx + 34, top + 68], fill=255)
    draw.polygon([(cx - 30, top + 60), (cx + 30, top + 60),
                  (cx + FIGURE_W // 2, feet), (cx - FIGURE_W // 2, feet)], fill=255)
    return np.asarray(img) > 0


def place_figure(shape, masks):
    """LOCKED シルエットを最も踏まない位置に人物大の図形を置く。

    「開いた床に立っている」を目分量ではなく総当たりで決める。踏んだ LOCKED
    シルエットの画素数を返すので、対照の性格が変わったら数字で分かる。
    """
    locked = np.zeros(shape, dtype=bool)
    for key in cat.LOCKED_KEYS:
        if key in masks:
            locked |= cat.silhouette(masks[key])
    floor = masks.get("rooms")
    if floor is None or not floor.any():
        raise SystemExit("error: this frame has no rooms/floor-slab category; a "
                         "free-standing object cannot be placed on open floor.")

    best = None
    for cx in range(FIGURE_W, shape[1] - FIGURE_W, 8):
        column = np.nonzero(floor[:, cx])[0]
        if column.size < 20:
            continue
        feet = int(column.max())
        if feet - FIGURE_H < 0:
            continue
        mask = figure_mask(shape, cx, feet)
        covered = int((mask & locked).sum())
        on_floor = int((mask & floor).sum())
        score = (covered, -on_floor)
        if best is None or score < best[0]:
            best = (score, cx, feet, covered, on_floor)
    if best is None:
        raise SystemExit("error: no column in this frame has enough visible floor "
                         "slab to stand a figure on.")
    _score, cx, feet, covered, on_floor = best
    return figure_mask(shape, cx, feet), {
        "figure_at_x": cx, "feet_y": feet,
        "locked_silhouette_px_covered": covered,
        "figure_px_over_floor": on_floor,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth", required=True, help="pv/renders/<shot-id>")
    ap.add_argument("--anchor", required=True,
                    help="真実ベースレンダを生成解像度へ落とした列のディレクトリ")
    ap.add_argument("--out", required=True)
    ap.add_argument("--wall-index", type=int, required=True,
                    help="消す壁の instance-legend の index")
    args = ap.parse_args()

    truth = Path(args.truth)
    anchor = Path(args.anchor)
    out = Path(args.out)
    flat_dir = out / "control-wall-removed"
    inpaint_dir = out / "control-wall-removed-inpaint"
    object_dir = out / "control-added-object"
    for d in (flat_dir, inpaint_dir, object_dir):
        d.mkdir(parents=True, exist_ok=True)

    log = {}
    for edge_png in sorted((truth / "edge").glob("*.png")):
        name = edge_png.stem
        source = anchor / f"{name}.png"
        if not source.exists():
            continue
        img = Image.open(source).convert("RGB")
        arr = np.asarray(img)

        mask, wall_name = wall_instance_mask(truth, name, args.wall_index, img.size)
        Image.fromarray(erase_flat(arr, mask)).save(flat_dir / f"{name}.png")
        Image.fromarray(erase_inpaint(arr, mask)).save(inpaint_dir / f"{name}.png")

        masks = cat.category_masks(truth / "segmentation" / f"{name}.png",
                                   target_size=img.size)
        figure, info = place_figure(arr.shape[:2], masks)
        with_figure = arr.copy()
        with_figure[figure] = np.array([30, 27, 36], np.uint8)
        Image.fromarray(with_figure).save(object_dir / f"{name}.png")

        info.update({"erased": wall_name, "erased_px": int(mask.sum()),
                     "figure_px": int(figure.sum())})
        log[name] = info

    print(json.dumps(log, indent=1))


if __name__ == "__main__":
    main()
