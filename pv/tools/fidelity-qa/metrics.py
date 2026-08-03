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

    production では **もう使われていない**。report.py は recall/precision の
    両方を真実ベースレンダ (`base/<index>.png` を `edge_mask` で取ったもの)
    基準に揃えており、`edge/<index>.png`（この関数が読む合成線画）はもはや
    比較の参照にしていない — フレーム索引の列挙にだけ使われる
    (`report.py` の `collect_rows` docstring 参照)。この関数が今も存在する
    唯一の理由は tests/test_report.py の `LayerPairingTest` が、"線画を
    precision の基準にすると質感描写のぶんだけ precision が不当に落ちる"
    という、既に直った過去のバグの回帰ガードを再現するために使っているから
    である。すなわちこれは Layer 1 のリーダーではなく、テスト専用の
    ヒストリカル・フィクスチャ生成器。
    """
    return _gray(source) < threshold


def _ratio(hit: int, total: int) -> float:
    """precision 用の比。生成側が空 (`total == 0`) なら 1.0 を返す — これは
    正しい: 「対応物のない構造が生成側に無い」ことは生成側が空であれば
    自明に真だからである（`edge_precision` のドキュメント参照）。

    recall 側にはこの関数を使わない。recall の分母は真実側のエッジ数であり、
    そこが 0 になるのは「真実ベースレンダにこの範囲で検出可能なエッジが
    無かった」ことを意味する。対象の物体は設計上なお存在し得る（同色の壁
    同士が接する境界、フラットな壁面、深い陰影など）ので、1.0（＝完全再現
    と判定）を返すのは誤りであり、この関数を recall に流用しないこと。
    そちらは `_recall_ratio` を使う。
    """
    return 1.0 if total == 0 else hit / total


def _recall_ratio(hit: int, total: int):
    """recall / per-instance recall 用の比。`total == 0` のとき **1.0 を返し
    てはいけない**。真実ベースレンダにこの範囲で検出可能なエッジが無かった
    というだけで、対象の物体が設計から消えたわけでも、生成側の忠実さが
    保証されたわけでもない — 単に「この範囲は検証できなかった」ことを
    意味する。これを 1.0（＝完全に忠実）と区別なく返すと、実データで
    `wall#2` のように壁面が同色で接するせいでエッジが立たない箇所が、
    生成側が何を描いていようと機械的に満点を取ってしまう（false PASS）。
    そのため `None` を返して「検証不能」を明示し、呼び出し側
    (`report.py` の `evaluate`) がこれを PASS の根拠に数えないようにする。
    """
    return None if total == 0 else hit / total


def edge_recall(truth: np.ndarray, generated: np.ndarray, radius: int):
    """`truth` のエッジのうち、生成側の近傍に対応が見つかった割合。消失の検出。

    `truth` のエッジが1つも無い場合は `None`（検証不能）を返す。詳細は
    `_recall_ratio` のドキュストリング参照。

    `truth` は呼び出し側が用意した参照マスクを受け取るだけの汎用関数だが、
    report.py での実際の使われ方には注意が要る。かつては **同一カメラ姿勢の
    真実ベースレンダ** ではなく Layer 1 の合成線画 (`edge/<index>.png` を
    `line_edge_mask` で取ったもの) を truth として渡していた。それは
    precision が線画を基準にしてはいけない理由 (`edge_precision` 参照) と
    まったく同じ理由で誤りだった。線画は instance map から導かれた輪郭線で
    あり、**どのシェーディング済みレンダにも写りようがない境界**（同色の壁
    同士が接する境界、遮蔽されて見えない輪郭）まで律儀に引く。ピクセル完全
    な再現を Topview 相当の解像度に落として測ったところ、線画を truth に
    使うと whole-frame recall が 0.35–0.43 まで落ち、`wall#2` のような
    インスタンスは 0.000 になった — そこには最初から見るべきものが無いから
    落としようがないのに、である。したがって report.py は precision と
    同じく **真実ベースレンダのエッジ** (`edge_mask(base/<index>.png)`) を
    truth として渡す。設計された構造（＝ベースレンダに実在するエッジ）が
    生成側に残っているかを測る指標であり、「消えたソファ」を捕まえるのは
    こちら。

    ただし真実ベースレンダそのものにも、同色の壁同士が接する境界のように
    検出可能なエッジが無い箇所が実在する（`wall#2` が実測でまさにこれ）。
    そこは「壊しようがない」のではなく「見えようがない」のであり、
    生成側の忠実さを一切保証しない。そのため truth が空のときは 1.0 では
    なく `None` を返す。
    """
    near = dilate(generated, radius)
    return _recall_ratio(int((truth & near).sum()), int(truth.sum()))


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

    recall と precision がいま同じ `reference`（真実ベースレンダのエッジ）を
    見ている点は意図的である。両者は同じ画像を異なる向き（truth を膨張して
    generated と重ねるか、generated を膨張して reference と重ねるか）で
    比べており、"何が消えたか" と "何が余分に現れたか" を別の許容度で測る。
    """
    near = dilate(reference, radius)
    return _ratio(int((generated & near).sum()), int(generated.sum()))


def _legend_name(entry: dict) -> str:
    """label -> "type#id" -> id の順で部材名を決める。"""
    name = entry.get("label")
    if name:
        return name
    kind = entry.get("type")
    return f"{kind}#{entry.get('id')}" if kind else str(entry.get("id"))


def _instance_hits(instance_png, legend: dict, target_size=None):
    """instance_guide.png と legend から、部材名 -> フルフレームの bool マスク
    (その部材自身の色に一致する画素) を列挙する。`instance_boxes` (外接矩形
    だけが要る呼び出し元向け) と `instance_regions` (外接矩形 + 実画素マスク
    が要る呼び出し元向け) の共通ロジック。

    legend は index.html の instance-legend.json 形式:
      {"version": 2,
       "instances": [{"id": 1, "color": "#rrggbb", "type": "sofa", ...}, ...]}

    実際に `aiInstanceSummary()` が出す要素には "label" が無く、部材種別は
    "type" に入る。名前は label -> "type#id" -> id の順で決める
    (`_legend_name`)。ここで id だけに落ちると失敗レポートが "instance '7'
    が消えた" になり、「どの家具が消えたかを名指しする」という設計の約束を
    満たせない。

    Malformed entries (null color, invalid hex, missing label) are skipped gracefully.

    `target_size`, if given, is an (width, height) pair the loaded guide is
    resized to *before* colours are read, using `Image.NEAREST` — never a
    smoothing filter. report.py now scores recall/precision at the
    *generated* frame's resolution (the truth base render is downscaled
    to match, see report.py's `load_truth_base`), so the instance guide has
    to be downscaled to that same grid to keep its boxes aligned with the
    masks being compared. The instance guide is flat per-object ID colour,
    not a photograph: any smoothing resample (LANCZOS, BILINEAR, BOX, ...)
    blends two neighbouring objects' colours at their shared boundary into a
    value that appears nowhere in the legend, and the exact-RGB match below
    then finds nothing for the blended rows/columns — measured directly:
    an 8px-tall test stripe downscaled 10x keeps 16 exact-colour pixels
    under NEAREST and exactly 0 under LANCZOS, BILINEAR or BOX alike.
    """
    img = Image.open(instance_png).convert("RGB")
    if target_size is not None and img.size != target_size:
        img = img.resize(target_size, Image.NEAREST)
    arr = np.asarray(img)
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
        yield _legend_name(entry), hit


def instance_boxes(instance_png, legend: dict, target_size=None) -> dict:
    """instance_guide.png と legend から、部材名 -> (y0,x0,y1,x1) を作る。

    これは外接矩形（extent）だけを返す。`instance_recall` が実際に採点する
    画素は外接矩形の中身全部ではなく `instance_regions` が返す部材自身の
    マスクに限定されている — 理由は `instance_regions` のドキュストリング
    参照。この関数自体は矩形だけを要る呼び出し元・テスト向けに残す。
    """
    boxes = {}
    for name, hit in _instance_hits(instance_png, legend, target_size):
        ys, xs = np.nonzero(hit)
        boxes[name] = (int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1)
    return boxes


def instance_regions(instance_png, legend: dict, target_size=None) -> dict:
    """instance_guide.png と legend から、部材名 -> (bbox, その部材自身の
    画素マスク) を作る。`instance_recall` はこちらを使う。

    `instance_boxes` は外接矩形しか返さないため、それをそのまま
    `instance_recall` に渡すと矩形の中身全部（自分より大きい隣接物体や
    部屋の輪郭を含む）が採点対象になってしまう。矩形に対して物体自身が
    小さいほど、その物体を消してもスコアが「他の何か」で薄まって高いまま
    残る（実測: 108 instance-frame 中 9 件が 0.80 超、`window#70` は
    フレーム0000で 0.968 — 消してもほぼ満点）。

    instance guide は物体ごとの正確な画素を legend の色として最初から
    持っている。そこでここでは bbox はクロップの高速化にだけ使い、実際に
    採点する画素は物体自身のマスクに限定した (bbox, mask) を返す。mask は
    bbox にクロップした範囲と同じ shape の bool 配列で、True がその部材
    自身の画素。
    """
    regions = {}
    for name, hit in _instance_hits(instance_png, legend, target_size):
        ys, xs = np.nonzero(hit)
        y0, x0 = int(ys.min()), int(xs.min())
        y1, x1 = int(ys.max()) + 1, int(xs.max()) + 1
        regions[name] = ((y0, x0, y1, x1), hit[y0:y1, x0:x1])
    return regions


def instance_recall(truth: np.ndarray, generated: np.ndarray, regions: dict, radius: int) -> dict:
    """部材ごとに、その物体自身の画素でのエッジ再現率を出す。どの家具が消えたかを名指しできる。

    `regions` は `instance_regions()` が返す name -> (bbox, mask) の形。
    真実側・生成側の **両方** を bbox にクロップした上で、さらに `mask`
    （その部材自身の画素）で絞り込んでから比較する — bbox の中身全部ではない。

    真実側だけを mask で絞り、生成側は bbox のまま（絞らない）という設計を
    最初に試したが、これは不十分だった。理由は `edge_mask` が境界の
    **両側** の画素を立てる仕様にある: ある物体が隣接物体と接する境界
    （＝壁や部屋の輪郭のような、大きい構造物の「自分の縁」の大半はまさに
    これ）では、物体自身の縁の画素のすぐ隣（1〜2px 先）に隣接物体側の縁の
    画素が必ず存在する。生成側を mask で絞らずに bbox のまま dilate すると、
    物体自身の画素を完全に消しても、その1〜2px隣にある「隣接物体の、消され
    ていない縁」が radius 以内として拾われてしまい、消えたはずの物体が
    ほぼ満点で「再現された」と判定される。実測（T91-ldk-push, 1280x720,
    `wall#6` を丸ごと消去): 真実側だけを mask した場合 radius=0 では正しく
    recall 0.0 になるが、radius=1 で 0.968、radius=2 で 1.000 まで戻って
    しまう — bbox 全体を使うのと同じ抜け穴が、境界共有型の物体に対しては
    mask 片側どめでも残っていた。

    そのため生成側も同じ mask で絞る。これにより「物体自身の画素の近くに
    何か別の物体の縁があるかどうか」ではなく「物体自身の画素の近くに
    "物体自身の"痕跡が残っているかどうか」だけを見るようになる。副作用と
    して、物体がそっくりそのまま数 px ずれて描かれた場合、そのずれが
    radius を超えると recall が下がるようになる（境界を挟んだ相手の縁を
    誤って「セーフ」と数えられなくなる分、位置ずれそのものへの感度は上がる
    ── これは per-instance recall が本来検出したい「物体が動いた/変わった」
    にとってむしろ正しい方向で、拾えなくなるのは「別物体の縁を身代わりに
    する」という誤ったセーフティネットだけである）。

    bbox をそのまま使う（mask で絞らない）と、物体が矩形に対して小さいほど
    スコアが薄まり、物体を丸ごと消してもスコアが高いまま残る（実測: 108
    instance-frame 中 9 件が 0.80 超、`window#70` はフレーム0000で 0.968 —
    消してもほぼ満点。大きい bbox を持つ `room#16`・`wall#6`・`wall#4` も
    同様に薄まっていた）。

    report.py はここに `edge_recall` と同じ `truth`（真実ベースレンダのエッジ）
    を渡す。この per-instance の数値が Layer 3 の主指標である: bbox 一個分の
    構造が消えても whole-frame recall は数点しか動かない（ルーム全体の輪郭が
    支配的なので）が、その instance 自身の recall は 1.0 から 0.1〜0.2 程度
    まで落ちる — 測定値: フレームからある物体の bbox を丸ごと消したところ、
    whole-frame recall は 1.000→0.942（6 ポイント）しか動かなかったのに対し、
    その物体自身の recall は 1.000→0.173 まで落ち、他の全 instance は
    0.770〜0.971 のまま残った。

    真実側にその部材自身のエッジが1つも無い場合（同色の壁同士が接する境界
    など）、`edge_recall` は 1.0 ではなく `None`（検証不能）を返す。呼び出し
    側 (report.py の `evaluate`) はこれを名指しで報告し、PASS の根拠には
    数えない。"""
    out = {}
    for name, (box, mask) in regions.items():
        y0, x0, y1, x1 = box
        truth_region = truth[y0:y1, x0:x1] & mask
        generated_region = generated[y0:y1, x0:x1] & mask
        out[name] = edge_recall(truth_region, generated_region, radius)
    return out
