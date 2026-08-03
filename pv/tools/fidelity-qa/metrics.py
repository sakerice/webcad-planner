#!/usr/bin/env python3
"""生成フレームが設計の構造を保っているかを測る。

scipy も cv2 も無い環境なので、形態処理は numpy のシフト論理和で行う。
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


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


def edge_mask(source, threshold: int = 32) -> np.ndarray:
    """画像から二値エッジを作る。Path でも PIL.Image でも受ける。"""
    img = Image.open(source) if isinstance(source, (str, Path)) else source
    gray = img.convert("L").filter(ImageFilter.FIND_EDGES)
    return np.asarray(gray) >= threshold


def _ratio(hit: int, total: int) -> float:
    # 対象が存在しないときは減点しない。存在しないものは壊しようがない。
    return 1.0 if total == 0 else hit / total


def edge_recall(truth: np.ndarray, generated: np.ndarray, radius: int) -> float:
    """設計側のエッジのうち、生成側の近傍に対応が見つかった割合。消失の検出。"""
    near = dilate(generated, radius)
    return _ratio(int((truth & near).sum()), int(truth.sum()))


def edge_precision(truth: np.ndarray, generated: np.ndarray, radius: int) -> float:
    """生成側のエッジのうち、設計側の近傍に根拠がある割合。新規生成の検出。

    注: 生成側が完全に空の場合、precision は 1.0 を返す（発明がないことは真）。
    つまり precision だけで「生成側が何かを出した」とは判定できない。
    recall で捕捉してこそ有効。
    """
    near = dilate(truth, radius)
    return _ratio(int((generated & near).sum()), int(generated.sum()))


def instance_boxes(instance_png, legend: dict) -> dict:
    """instance_guide.png と legend から、部材名 -> (y0,x0,y1,x1) を作る。

    legend は index.html の instance-legend.json 形式:
      {"instances": [{"id": ..., "color": "#rrggbb", "label": "sofa"}, ...]}

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
        name = entry.get("label") or str(entry.get("id"))
        boxes[name] = (int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1)
    return boxes


def instance_recall(truth: np.ndarray, generated: np.ndarray, boxes: dict, radius: int) -> dict:
    """部材ごとに、その bbox 内でのエッジ再現率を出す。どの家具が消えたかを名指しできる。"""
    out = {}
    for name, (y0, x0, y1, x1) in boxes.items():
        out[name] = edge_recall(truth[y0:y1, x0:x1], generated[y0:y1, x0:x1], radius)
    return out
