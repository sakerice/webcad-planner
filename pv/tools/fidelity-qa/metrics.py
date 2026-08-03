#!/usr/bin/env python3
"""生成フレームが設計の構造を保っているかを測る。

scipy も cv2 も無い環境なので、形態処理は numpy のシフト論理和で行う。
"""
from pathlib import Path

import numpy as np
from PIL import Image


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """4近傍膨張を radius 回反復する（菱形構造要素）。境界で巻き込まない。"""
    out = mask.copy()
    for _ in range(int(radius)):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def _gray(source) -> np.ndarray:
    img = Image.open(source) if isinstance(source, (str, Path)) else source
    return np.asarray(img.convert("L")).astype(np.int16)


def edge_mask(source, threshold: int = 32) -> np.ndarray:
    """濃淡画像から二値エッジを作る。Path でも PIL.Image でも受ける。

    4近傍との輝度差が threshold 以上なら、その境界に接する **両側** の画素を
    エッジとして立てる。PIL の FIND_EDGES ではなくこの近傍差分を使う理由は2つある。

    1. FIND_EDGES は 3x3 ラプラシアンなので、白地に1px の暗線を引いた線画
       （index.html の `makeEdgeDataUrlFromSegmentation` が出す edge guide が
       まさにこれ）に掛けると、**線そのものの画素が False になり**、左右の白画素
       だけが立つ「中空の二重線」になる。真実側を線画の暗画素として取る
       (`line_edge_mask`) 一方で生成側を FIND_EDGES で取ると、完全に忠実な
       再現でも radius 0 で recall 0.0 になってしまう。近傍差分は境界の両側を
       立てるため、暗線の画素自体を必ず含む。
    2. FIND_EDGES は画像の最外周1px に、内容と無関係な偽エッジを作る
       （一様な白画像でも外周が立つ）。近傍差分にはその副作用がない。

    threshold は「隣接画素との輝度差」に対する閾値であり、ラプラシアン応答に
    対する閾値ではない。同じ数値でも意味が変わっている点に注意。
    """
    g = _gray(source)
    mask = np.zeros(g.shape, dtype=bool)
    vertical = np.abs(np.diff(g, axis=0)) >= threshold
    mask[:-1, :] |= vertical
    mask[1:, :] |= vertical
    horizontal = np.abs(np.diff(g, axis=1)) >= threshold
    mask[:, :-1] |= horizontal
    mask[:, 1:] |= horizontal
    return mask


def line_edge_mask(source, threshold: int = 128) -> np.ndarray:
    """線画(白地・暗線)から二値エッジを作る。暗い画素がそのままエッジ。

    Layer 1 の `edge/<index>.png` は合成された線画であって写真ではない。
    そこからさらにエッジを「検出」する必要はなく、暗い画素を拾えばよい。
    再検出すると上の 1. の中空二重線が起きる。
    """
    return _gray(source) < threshold


def _ratio(hit: int, total: int) -> float:
    # 対象が存在しないときは減点しない。存在しないものは壊しようがない。
    return 1.0 if total == 0 else hit / total


def edge_recall(truth: np.ndarray, generated: np.ndarray, radius: int) -> float:
    """設計側のエッジのうち、生成側の近傍に対応が見つかった割合。消失の検出。

    `truth` は Layer 1 の線画 (`edge/<index>.png` を `line_edge_mask` で取ったもの)
    を想定する。設計された構造が生成側に残っているかを直接測る指標であり、
    「消えたソファ」を捕まえるのはこちら。
    """
    near = dilate(generated, radius)
    return _ratio(int((truth & near).sum()), int(truth.sum()))


def edge_precision(reference: np.ndarray, generated: np.ndarray, radius: int) -> float:
    """生成側のエッジのうち、`reference` の近傍に対応物がある割合。

    `reference` は **同一カメラ姿勢の真実ベースレンダ** (`base/<index>.png`) から
    取ったエッジであることを前提とする。線画ではない。線画を基準にすると、
    Layer 2 が担うべき布のしわ・接地影・木目・映り込みといった質感の描写が
    すべて「線画の外」に落ちるため、**正しい生成ほど precision が下がる**という
    逆向きの評価になってしまう。ベースレンダは同じジオメトリを実際に材質・
    照明つきでレンダしたものなので、そのエッジ地図には既に材質・陰影由来の
    細部が含まれている。

    したがってこの指標が意味するのは「捏造されたコンロを直接検出する」ことでは
    なく、**同一カメラ姿勢の真実レンダに対応物を持たない構造が生成側にどれだけ
    現れたか**である。質感の追加でも 1.0 にはならない（ベースレンダより細部は
    必ず増える）ので、閾値は実際の生成出力の分布から決めるほかない。

    注: 生成側が完全に空の場合、precision は 1.0 を返す（対応物のない構造が
    無いことは真）。つまり precision だけで「生成側が何かを出した」とは判定
    できない。recall と併せてこそ有効。
    """
    near = dilate(reference, radius)
    return _ratio(int((generated & near).sum()), int(generated.sum()))


def instance_boxes(instance_png, legend: dict) -> dict:
    """instance_guide.png と legend から、部材名 -> (y0,x0,y1,x1) を作る。

    legend は index.html の instance-legend.json 形式:
      {"version": 2,
       "instances": [{"id": 1, "color": "#rrggbb", "type": "sofa", ...}, ...]}

    実際に `aiInstanceSummary()` が出す要素には "label" が無く、部材種別は
    "type" に入る。名前は label -> "type#id" -> id の順で決める。ここで id
    だけに落ちると失敗レポートが "instance '7' が消えた" になり、
    「どの家具が消えたかを名指しする」という設計の約束を満たせない。

    Malformed entries (null color, invalid hex, missing label) are skipped gracefully.
    """
    arr = np.asarray(Image.open(instance_png).convert("RGB"))
    boxes = {}
    for entry in legend.get("instances", []):
        # Handle null or missing color field
        color = entry.get("color")
        if color is None:
            continue
        color = str(color).lstrip("#")
        if len(color) != 6:
            continue

        # Attempt to parse hex; skip if invalid
        try:
            rgb = tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            # Invalid hex string
            continue

        hit = np.all(arr == np.array(rgb, dtype=arr.dtype), axis=-1)
        if not hit.any():
            continue
        ys, xs = np.nonzero(hit)
        name = entry.get("label")
        if not name:
            kind = entry.get("type")
            name = f"{kind}#{entry.get('id')}" if kind else str(entry.get("id"))
        boxes[name] = (int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1)
    return boxes


def instance_recall(truth: np.ndarray, generated: np.ndarray, boxes: dict, radius: int) -> dict:
    """部材ごとに、その bbox 内でのエッジ再現率を出す。どの家具が消えたかを名指しできる。"""
    out = {}
    for name, (y0, x0, y1, x1) in boxes.items():
        out[name] = edge_recall(truth[y0:y1, x0:x1], generated[y0:y1, x0:x1], radius)
    return out
