#!/usr/bin/env python3
"""Layer 1 の真実フレームと生成フレームを比較し、**何がどう変わったか** を述べる。

    python3 pv/tools/fidelity-qa/report.py \
        --truth pv/renders/<shot> --generated <frames-dir> \
        --min-locked-recall 0.55 --max-locked-contradiction 0.20 \
        --min-locked-instance-recall 0.45 --min-soft-recall 0.55 \
        --min-soft-instance-recall 0.45 --max-unverifiable-fraction 0.5 \
        [--radius 2] [--json out.json]

閾値はすべて必須引数で既定値を持たない。ショットと生成系列ごとに実測から
決めるものであり、コードに埋めた数字が黙って判定を左右してはならない。

## 判定の形

このゲートの仕事は数字を出すことではなく、**何が変わり、それが目指す品質に
とって有益か** を述べることである。画素はカテゴリ・セグメンテーション
（`categories.py`）で3つのティアに分かれる。

  LOCKED  壁・窓/ガラス・建具/開口・屋根・部屋の床スラブ。間取りを定義する。
          消失・変位・すり替えは run 全体の FAIL。カテゴリ名とフレームを
          名指しする。
  SOFT    設備機器・家具。在るべきだが描画は変わってよい。独自の閾値で
          別枠に出し、LOCKED の verdict を汚さない。
  FREE    真実側のどのカテゴリにも対応物を持たない、生成側の追加構造。
          **一切減点しない。** 量・位置・どのカテゴリの上に乗ったかを述べ、
          有益かどうかの判断は人間に渡す。人が歩いている、食事が置かれて
          いる、本が開かれている——これらは生活の想定を示す良い変化である。

verdict は3値。

  PASS             LOCKED も SOFT も閾値内。exit 0
  SOFT_REGRESSION  LOCKED は無事だが SOFT が閾値割れ。exit 3
  FAIL             LOCKED が閾値割れ、または検証可能な範囲が足りない。exit 1

## 比較の基準

  真実側の参照は **同一カメラ姿勢のベースレンダ** `base/<index>.png` である。
  `edge/` の合成線画ではない。線画は instance map から機械的に導いた輪郭で、
  どのシェーディング済みレンダにも写らない境界（同色の壁同士が接する境界、
  遮蔽されて見えない輪郭）まで引くため、ピクセル完全な再現ですら
  recall 0.35〜0.43 に落ちる。`edge/` は guideStride で間引かれた索引集合を
  列挙するためだけに使う。

  LOCKED/SOFT の recall と contradiction は、そのベースレンダのエッジのうち
  **カテゴリのシルエット上に乗っているものだけ** を分母にする（`categories`
  モジュールの冒頭ドキュメント参照）。陰影だけの変化は Layer 2 の仕事なので
  分母から外す。これは常にベースレンダのエッジの部分集合であり、写っていない
  ものを要求しない性質は保たれる。

  解像度の向き: 真実 PNG は生成フレームより大きいので、真実側を生成側の寸法へ
  **縮小** する（ベースレンダは LANCZOS、セグメンテーションと instance guide は
  NEAREST）。逆向き（生成側を拡大）はぼかしを生み、輝度段差が `edge_mask` の
  閾値を割り込んで実在するエッジが消える——ピクセル完全な生成が
  recall 0.255〜0.752 に落ちた実測がある。生成側の方が大きい入力は拒否する。
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import categories as cat
from metrics import (
    dilate,
    edge_mask,
    edge_precision,
    edge_recall,
    instance_recall,
    instance_regions,
)

# 真実ベースレンダを生成フレームの寸法へ縮小するときの再標本化。
# LANCZOS は写真的画像の縮小に適した高品質フィルタ。
# (segmentation / instance guide は NEAREST 固定 — flat な ID カラーなので
#  平滑化フィルタは legend に無い中間色を作って厳密一致を壊す。)
RESAMPLE_BASE = Image.LANCZOS


def load_truth_base(truth_base_png, target_size, on_resize=None):
    """真実ベースレンダを開き、必要なら生成フレームの寸法へ縮小して返す。

    かつては逆向き（生成フレームを真実側の寸法へ拡大）だった。拡大は
    ぼかしを生み、輝度段差が `edge_mask` の閾値を割り込んで実在するエッジが
    消える。縮小方向に直した後は、ピクセル完全な生成が全フレームで
    recall とも厳密に 1.000 になることを測定で確認した。

    生成フレームが真実より **大きい** 場合は縮小の逆（真実の拡大）になって
    しまうので、ここで即座に拒否する。アスペクト比が違う場合は解像度差では
    なく別画角の取り違えなので、引き伸ばして辻褄を合わせず即座に落とす。
    """
    img = Image.open(truth_base_png)
    if img.size == target_size:
        return img
    tw, th = img.size
    gw, gh = target_size
    if abs(tw / th - gw / gh) > 1e-3:
        raise SystemExit(
            f"error: aspect ratio mismatch for {truth_base_png}: "
            f"truth {tw}x{th} ({tw / th:.4f}) vs generated {gw}x{gh} ({gw / gh:.4f}). "
            "This is a mismatched shot, not a resolution difference.")
    if gw > tw or gh > th:
        raise SystemExit(
            f"error: generated frame {gw}x{gh} is larger than the truth render {tw}x{th} "
            f"for {truth_base_png}. Comparison always downscales the truth down to the "
            "generated frame's size, never the reverse — upscaling the truth would blur "
            "it and push real edges below edge_mask's detection threshold, invalidating "
            "the comparison (this is the exact failure mode that scored a pixel-perfect "
            "generation 0.255-0.752, in mirror image: here it would be the truth losing "
            "its edges instead of the generated side). Re-capture the truth render at a "
            "resolution at least as large as the generated frames, or check whether "
            "the generator's auto-upscale produced an oversized generated frame.")
    if on_resize:
        on_resize(f"truth frames are {tw}x{th}; downscaling to the generated size "
                  f"{gw}x{gh} before edge extraction")
    return img.resize(target_size, RESAMPLE_BASE)


def _fmt(value):
    return "n/a" if value is None else f"{value:.3f}"


def _fmt_px(n):
    return f"{n:,}"


def describe_frame(row) -> list:
    """1フレーム分の「何が増え、何が失われ、どのカテゴリか」を日本語まじりの
    英文で並べる。オペレータの問いは "what changed and does it help" なので、
    数値の隣に必ず言葉を置く。JSON にも同じ文字列を残す。
    """
    lines = []
    for key in cat.LOCKED_KEYS + cat.SOFT_KEYS:
        entry = row["categories"].get(key)
        if entry is None:
            continue
        tier = entry["tier"].upper()
        if entry["recall"] is None:
            lines.append(
                f"[{tier}] {key}: unverifiable — the truth base render has no detectable "
                f"edge on this category's silhouette in this frame "
                f"({_fmt_px(entry['area_px'])} px of area, {_fmt_px(entry['structure_px'])} px "
                "of silhouette edge). Nothing could be checked here; not counted toward PASS.")
            continue
        held = entry["recall"]
        lost = entry["lost_px"]
        msg = (f"[{tier}] {key}: {held * 100:.1f}% of its silhouette survived; "
               f"{_fmt_px(lost)} px lost")
        if entry["lost_zone"]:
            msg += f", concentrated {entry['lost_zone']} ({entry['lost_zone_share'] * 100:.0f}% of the loss)"
        if entry["contradiction"]:
            msg += (f"; {entry['contradiction'] * 100:.1f}% of the silhouette was REPLACED — "
                    "new structure with no counterpart in the truth sits where the old "
                    "outline used to be")
        else:
            msg += "; nothing was drawn in its place"
        added = row["added"]["by_category"].get(key)
        if added:
            msg += (f". Added on top of it: {_fmt_px(added['pixels'])} px of new structure "
                    f"({added['zone']}) — not penalised")
        lines.append(msg + ".")

    free = row["added"]
    lines.append(
        f"[FREE] {_fmt_px(free['total_px'])} px of generated structure has no counterpart "
        f"in the truth render ({free['share_of_frame'] * 100:.2f}% of the frame). This is "
        "where a person walking through, a meal on the table, a book or a mug shows up. "
        "It is measured and described, never penalised.")
    if free["by_category"]:
        parts = [f"{k} {_fmt_px(v['pixels'])} px ({v['zone']})"
                 for k, v in sorted(free["by_category"].items(),
                                    key=lambda kv: -kv[1]["pixels"])[:5]]
        lines.append("       sitting over: " + ", ".join(parts) + ".")
    return lines


def compare_frame(index, truth_base_png, truth_segmentation_png, generated_png, radius,
                  instance_png=None, legend=None, on_resize=None):
    """1フレーム分のカテゴリ別・instance 別の数値と記述を作る。"""
    generated_img = Image.open(generated_png)
    size = generated_img.size
    truth_img = load_truth_base(truth_base_png, size, on_resize=on_resize)

    base_edges = edge_mask(truth_img)
    generated = edge_mask(generated_img)
    near_generated = dilate(generated, radius)
    near_truth = dilate(base_edges, radius)
    # 真実側に対応物を持たない生成側の構造。FREE ティアと contradiction の素。
    unexplained = generated & ~near_truth

    masks = cat.category_masks(truth_segmentation_png, target_size=size)

    entries = {}
    for key, mask in masks.items():
        structure = cat.structure_edges(base_edges, mask)
        recall = cat.category_recall(structure, near_generated)
        lost = cat.lost_structure(structure, near_generated)
        zone, zone_share = cat.zone_of(lost)
        entries[key] = {
            "tier": cat.TIER_OF.get(key, cat.CONTEXT),
            "description": cat.DESCRIPTION_OF.get(key, key),
            "area_px": int(mask.sum()),
            "structure_px": int(structure.sum()),
            "recall": recall,
            "lost_px": int(lost.sum()),
            "lost_zone": zone,
            "lost_zone_share": zone_share,
            "contradiction": cat.category_contradiction(structure, lost, unexplained, radius),
        }

    added_by_cat = cat.added_structure(unexplained, masks)
    total_added = int(unexplained.sum())

    instances = {}
    if instance_png is not None and legend is not None:
        regions = instance_regions(instance_png, legend, target_size=size)
        # 部材ごとの recall も輪郭（マスク内側の縁）で測る。カテゴリ側と同じ
        # 理由 — 張地の皺や木目は Layer 2 が変えてよい領域であり、そこを
        # 分母に入れるとリライトしただけで部材が消えたことになる。
        # `metrics.instance_recall`（マスク全体版）は素の値として併記する。
        scores = cat.instance_silhouette_recall(base_edges, generated, regions, radius)
        whole_mask_scores = instance_recall(base_edges, generated, regions, radius)
        for name, (box, mask) in regions.items():
            y0, x0, y1, x1 = box
            full = np.zeros_like(base_edges)
            full[y0:y1, x0:x1] = mask
            key = cat.dominant_category(full, masks)
            instances[name] = {
                "recall": scores[name],
                "whole_mask_recall": whole_mask_scores[name],
                "category": key,
                "tier": cat.TIER_OF.get(key, cat.CONTEXT),
            }

    row = {
        "index": index,
        "size": [size[0], size[1]],
        "whole_frame": {
            # 記述のためだけの数値。閾値は掛からない。とくに precision は
            # 「生成側が真実に無いものをどれだけ描いたか」でしかなく、
            # 生活感の付与そのものが下げる。これを合否に使わないのが今回の
            # 設計変更の核心である。
            "recall": edge_recall(base_edges, generated, radius),
            "novelty_precision": edge_precision(base_edges, generated, radius),
        },
        "categories": entries,
        "instances": instances,
        "added": {
            "total_px": total_added,
            "share_of_frame": total_added / base_edges.size,
            "by_category": added_by_cat,
        },
    }
    row["narrative"] = describe_frame(row)
    return row


class Thresholds:
    """判定に使う閾値。すべて呼び出し側が明示する。既定値は持たない。"""

    def __init__(self, min_locked_recall, max_locked_contradiction,
                 min_locked_instance_recall, min_soft_recall,
                 min_soft_instance_recall, max_unverifiable_fraction):
        self.min_locked_recall = min_locked_recall
        self.max_locked_contradiction = max_locked_contradiction
        self.min_locked_instance_recall = min_locked_instance_recall
        self.min_soft_recall = min_soft_recall
        self.min_soft_instance_recall = min_soft_instance_recall
        self.max_unverifiable_fraction = max_unverifiable_fraction

    def as_dict(self):
        return dict(self.__dict__)


def evaluate(rows, thresholds: Thresholds):
    """カテゴリ・ティア別に PASS / SOFT_REGRESSION / FAIL を出す。

    LOCKED だけが run の合否を決める。SOFT は自分の閾値で別枠に出す —
    家具の張地が変わったことと壁が消えたことを同じ土俵に載せない、という
    のがこの層の要求そのものだからである。ただし SOFT を黙って捨てもしない:
    設計した家具が消えるのは実際の欠陥であり、SOFT_REGRESSION として
    exit code 3 で表に出す。

    FREE ティアは合否計算に一切入らない。生成側が足した構造は、それが
    どれだけ多くても FAIL の理由にならない。人が歩き、食事が置かれ、本が
    開かれるのは良い変化だからである。

    検証不能 (`None`) の扱いは従来どおり: 1.0 とは区別し、PASS の根拠には
    数えず、しかし黙って捨てず名指しで残す。run 全体で検証可能な検査の
    割合が足りなければ、それ自体を FAIL 理由にする。
    """
    if not rows:
        return {
            "verdict": "FAIL",
            "locked": {"verdict": "FAIL",
                       "failures": [{"index": -1, "reasons": ["no frames were compared"]}]},
            "soft": {"verdict": "PASS", "findings": []},
            "unverifiable": {"count": 0, "total_checks": 0, "frames": []},
            "free": {"total_added_px": 0,
                     "note": "FREE-tier additions are never penalised"},
            "thresholds": thresholds.as_dict(),
        }

    locked_failures = []
    soft_findings = []
    unverifiable_frames = []
    unverifiable_count = 0
    total_checks = 0
    total_added = 0

    for r in rows:
        locked_reasons = []
        soft_reasons = []
        unverifiable_here = []
        total_added += r["added"]["total_px"]

        for key in cat.LOCKED_KEYS:
            entry = r["categories"].get(key)
            if entry is None:
                continue
            total_checks += 1
            if entry["recall"] is None:
                unverifiable_here.append(f"category '{key}'")
                unverifiable_count += 1
                continue
            if entry["recall"] < thresholds.min_locked_recall:
                locked_reasons.append(
                    f"LOCKED category '{key}' ({entry['description']}) silhouette recall "
                    f"{entry['recall']:.3f} < {thresholds.min_locked_recall:.3f} — "
                    f"{_fmt_px(entry['lost_px'])} px of plan-defining outline is missing"
                    + (f", concentrated {entry['lost_zone']}" if entry["lost_zone"] else "")
                    + ". Walls, their lengths and openings define the floor plan and must "
                      "not change.")
            if (entry["contradiction"] is not None
                    and entry["contradiction"] > thresholds.max_locked_contradiction):
                locked_reasons.append(
                    f"LOCKED category '{key}' ({entry['description']}) contradiction "
                    f"{entry['contradiction']:.3f} > {thresholds.max_locked_contradiction:.3f} — "
                    "its outline was not merely lost but REPLACED: structure with no "
                    "counterpart in the truth render sits where the plan's outline used to be"
                    + (f", {entry['lost_zone']}" if entry["lost_zone"] else "") + ".")

        for key in cat.SOFT_KEYS:
            entry = r["categories"].get(key)
            if entry is None:
                continue
            total_checks += 1
            if entry["recall"] is None:
                unverifiable_here.append(f"category '{key}'")
                unverifiable_count += 1
                continue
            if entry["recall"] < thresholds.min_soft_recall:
                soft_reasons.append(
                    f"SOFT category '{key}' ({entry['description']}) silhouette recall "
                    f"{entry['recall']:.3f} < {thresholds.min_soft_recall:.3f} — designed "
                    "objects look absent or heavily reworked. Reported on its own threshold; "
                    "this does not fail the locked structure.")

        for name, info in sorted(r.get("instances", {}).items()):
            total_checks += 1
            if info["recall"] is None:
                unverifiable_here.append(f"instance '{name}'")
                unverifiable_count += 1
                continue
            if info["tier"] == cat.LOCKED:
                if info["recall"] < thresholds.min_locked_instance_recall:
                    locked_reasons.append(
                        f"LOCKED instance '{name}' (category '{info['category']}') recall "
                        f"{info['recall']:.3f} < {thresholds.min_locked_instance_recall:.3f} — "
                        "this specific plan-defining element went missing or moved.")
            elif info["tier"] == cat.SOFT:
                if info["recall"] < thresholds.min_soft_instance_recall:
                    soft_reasons.append(
                        f"SOFT instance '{name}' (category '{info['category']}') recall "
                        f"{info['recall']:.3f} < {thresholds.min_soft_instance_recall:.3f} — "
                        "this designed object looks absent or heavily reworked.")

        if unverifiable_here:
            unverifiable_frames.append({"index": r["index"],
                                        "checks": sorted(unverifiable_here)})
        if locked_reasons:
            locked_failures.append({"index": r["index"], "reasons": locked_reasons})
        if soft_reasons:
            soft_findings.append({"index": r["index"], "reasons": soft_reasons})

    if total_checks and unverifiable_count / total_checks > thresholds.max_unverifiable_fraction:
        locked_failures.append({"index": -1, "reasons": [
            f"{unverifiable_count} of {total_checks} checks across this run were "
            "unverifiable (no detectable truth edge in the region) — too little of the "
            "design could actually be checked for this run to read as a clean PASS "
            f"(limit {thresholds.max_unverifiable_fraction:.3f})"]})

    locked_verdict = "FAIL" if locked_failures else "PASS"
    soft_verdict = "FAIL" if soft_findings else "PASS"
    if locked_verdict == "FAIL":
        verdict = "FAIL"
    elif soft_verdict == "FAIL":
        verdict = "SOFT_REGRESSION"
    else:
        verdict = "PASS"

    return {
        "verdict": verdict,
        "locked": {"verdict": locked_verdict, "failures": locked_failures},
        "soft": {"verdict": soft_verdict, "findings": soft_findings},
        "unverifiable": {
            "count": unverifiable_count,
            "total_checks": total_checks,
            "frames": unverifiable_frames,
        },
        "free": {
            "total_added_px": total_added,
            "note": "FREE-tier additions (a person walking through, a meal on the table, "
                    "a book, a mug, a throw over the sofa) are measured and described but "
                    "never penalised — they demonstrate how the home would be lived in",
        },
        "thresholds": thresholds.as_dict(),
    }


EXIT_CODE = {"PASS": 0, "FAIL": 1, "SOFT_REGRESSION": 3}


def _load_legend(truth_dir: Path):
    """instance-legend.json を読む。instance guide があるのに legend が無い/
    壊れている場合は綺麗に落ちる。家具を一切検査せずに PASS と読める run を
    作らないため。instance が丸ごと無いショットは (None, None)。
    """
    legend_path = truth_dir / "instance-legend.json"
    instance_dir = truth_dir / "instance"
    has_frames = instance_dir.is_dir() and any(instance_dir.glob("*.png"))
    if not has_frames:
        return None, None

    if not legend_path.exists():
        raise SystemExit(
            f"error: {instance_dir} has instance guide frames but {legend_path} is missing. "
            "Per-instance checks cannot run, and a run that cannot check the designed "
            "objects must not be allowed to report PASS.")
    try:
        legend = json.loads(legend_path.read_text())
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        raise SystemExit(f"error: unreadable instance legend {legend_path}: {exc}")
    if not isinstance(legend, dict):
        raise SystemExit(
            f"error: malformed instance legend {legend_path}: expected a JSON object with an "
            f'"instances" list, got {type(legend).__name__}')
    if not isinstance(legend.get("instances"), list):
        raise SystemExit(
            f"error: malformed instance legend {legend_path}: "
            '"instances" must be a list of legend entries')
    return legend, instance_dir


def collect_rows(truth_dir: Path, gen_dir: Path, radius: int, warn=None):
    """真実の edge フレームごとに1行を作る。

    `truth_dir / "edge"` は guideStride で間引かれた索引集合の列挙にだけ使う。
    その画素内容はどちらの指標の参照にもならない（モジュール冒頭参照）。

    セグメンテーションは **フレームごとに** 読む。カメラが動くのでフレーム0の
    カテゴリ配置は他フレームの配置を説明しない。instance の bbox も同じ理由で
    毎フレーム読み直す。

    セグメンテーションが1枚も無いショットは即座に落とす。カテゴリ判定こそが
    この層の仕事であり、それができない run が PASS と読めてはならない。
    """
    warn = warn or (lambda msg: None)
    legend, instance_dir = _load_legend(truth_dir)
    if legend is None:
        warn(f"no instance/ guide frames under {truth_dir} — "
             "per-instance checks skipped for the whole run")

    seg_dir = truth_dir / "segmentation"
    if not (seg_dir.is_dir() and any(seg_dir.glob("*.png"))):
        raise SystemExit(
            f"error: {seg_dir} has no segmentation guide frames. The whole verdict is "
            "category-aware — locked structure (walls, windows, doors, roof, floor slabs) "
            "is separated from soft furnishings and from free additions using the "
            "segmentation guide. Without it nothing can be tiered, and a run that cannot "
            "tell a vanished wall from an added mug must not report PASS.")

    resize_notified = []

    def on_resize(msg):
        if not resize_notified:
            resize_notified.append(msg)
            warn(msg)

    base_dir = truth_dir / "base"
    rows = []
    truth_pngs = sorted((truth_dir / "edge").glob("*.png"))
    for truth_png in truth_pngs:
        generated_png = gen_dir / truth_png.name
        if not generated_png.exists():
            continue

        base_png = base_dir / truth_png.name
        if not base_png.exists():
            raise SystemExit(
                f"error: the metrics are measured against the truth base render, but "
                f"{base_png} does not exist. The base render is written for every frame; "
                "a missing one means the truth render is incomplete.")

        seg_png = seg_dir / truth_png.name
        if not seg_png.exists():
            raise SystemExit(
                f"error: {seg_png} does not exist but {truth_png} does. Segmentation guides "
                "are written at the same guideStride-thinned indices as the edge guides; a "
                "frame with an edge guide but no segmentation cannot be tiered, and skipping "
                "it silently would hide whichever frame lost a wall.")

        instance_png = None
        if legend is not None:
            candidate = instance_dir / truth_png.name
            if candidate.exists():
                instance_png = candidate
            else:
                warn(f"no instance guide for frame {truth_png.stem} — "
                     "per-instance checks skipped for this frame")

        rows.append(compare_frame(int(truth_png.stem), base_png, seg_png, generated_png,
                                  radius, instance_png=instance_png, legend=legend,
                                  on_resize=on_resize))
    return rows, len(truth_pngs)


def assert_coverage(rows, expected, truth_dir: Path, gen_dir: Path):
    """真実の edge フレームはすべて生成側の相手を見つけていなければならない。

    フレームの対応付けはファイル名だけで行う。抽出器の命名規約が1つでも
    ずれると1枚しか一致せず、このチェックが無いと「PASS — 1 frames compared」
    と出して exit 0 してしまう。
    """
    if len(rows) == expected:
        return
    matched = sorted(f"{r['index']:04d}" for r in rows)
    raise SystemExit(
        f"error: only {len(rows)} of {expected} truth edge frames under {truth_dir / 'edge'} "
        f"found a generated counterpart in {gen_dir}. Every truth edge frame must be paired. "
        f"Matched: {matched or 'none'}. Generated frames must be named with the truth frame "
        "index (0000.png, 0012.png, ...), not the extractor's centisecond token.")


def main():
    ap = argparse.ArgumentParser(
        description="Category-aware fidelity gate: says what changed and whether it helps.")
    ap.add_argument("--truth", required=True, help="pv/renders/<shot-id>")
    ap.add_argument("--generated", required=True, help="生成動画から抽出したフレームのディレクトリ")
    ap.add_argument("--min-locked-recall", type=float, required=True,
                    help="LOCKED カテゴリ (walls/windows/doors/roof/rooms) のシルエット "
                         "recall 下限。割れると run は FAIL。")
    ap.add_argument("--max-locked-contradiction", type=float, required=True,
                    help="LOCKED カテゴリのシルエットが「消えた上に別の構造に置き換わった」"
                         "割合の上限。自由空間への追加物は寄与しない。")
    ap.add_argument("--min-locked-instance-recall", type=float, required=True,
                    help="LOCKED カテゴリに属する個別部材の recall 下限。どの壁・どの窓が "
                         "消えたかを名指しする。")
    ap.add_argument("--min-soft-recall", type=float, required=True,
                    help="SOFT カテゴリ (fixtures/furniture) のシルエット recall 下限。"
                         "別枠報告で、LOCKED の verdict は汚さない。")
    ap.add_argument("--min-soft-instance-recall", type=float, required=True,
                    help="SOFT カテゴリに属する個別部材の recall 下限。")
    ap.add_argument("--max-unverifiable-fraction", type=float, required=True,
                    help="run 全体で「検証不能」だった検査の割合の上限。超えると FAIL。")
    ap.add_argument("--radius", type=int, default=2)
    ap.add_argument("--json", default=None)
    ap.add_argument("--quiet-narrative", action="store_true",
                    help="フレームごとの記述文を stdout に出さない (JSON には常に残る)")
    args = ap.parse_args()

    truth_dir = Path(args.truth)
    gen_dir = Path(args.generated)

    def warn(msg):
        print(f"note: {msg}", file=sys.stderr)

    rows, expected = collect_rows(truth_dir, gen_dir, args.radius, warn=warn)
    assert_coverage(rows, expected, truth_dir, gen_dir)

    thresholds = Thresholds(
        min_locked_recall=args.min_locked_recall,
        max_locked_contradiction=args.max_locked_contradiction,
        min_locked_instance_recall=args.min_locked_instance_recall,
        min_soft_recall=args.min_soft_recall,
        min_soft_instance_recall=args.min_soft_instance_recall,
        max_unverifiable_fraction=args.max_unverifiable_fraction,
    )
    result = evaluate(rows, thresholds)
    result["compared"] = len(rows)
    result["rows"] = rows

    print(f"{result['verdict']} — {len(rows)} frames compared")
    print(f"  LOCKED (walls, windows, doors, roof, floor slabs): {result['locked']['verdict']}"
          "  — the floor plan must not change")
    print(f"  SOFT   (fixtures, furniture):                      {result['soft']['verdict']}"
          "  — reported on its own threshold, never folded into LOCKED")
    print(f"  FREE   additions: {result['free']['total_added_px']:,} px of generated structure "
          "with no counterpart in the truth — never penalised")

    if not args.quiet_narrative:
        for r in rows:
            print(f"  frame {r['index']:>4}:")
            for line in r["narrative"]:
                print(f"    {line}")

    uv = result["unverifiable"]
    if uv["count"]:
        print(f"  note: {uv['count']} of {uv['total_checks']} check(s) were unverifiable — "
              "the truth base render has no detectable edge in that region (e.g. two "
              "same-tone surfaces meeting), so whether the structure survived generation "
              f"could not be scored. These do NOT count toward PASS ({result['verdict']} "
              "above reflects only what could be checked):")
        for entry in uv["frames"]:
            print(f"    frame {entry['index']:>4}: " + ", ".join(entry["checks"]))

    for f in result["locked"]["failures"]:
        print(f"  LOCKED FAIL frame {f['index']:>4}: " + "; ".join(f["reasons"]))
    for f in result["soft"]["findings"]:
        print(f"  SOFT  finding frame {f['index']:>4}: " + "; ".join(f["reasons"]))

    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2))

    raise SystemExit(EXIT_CODE[result["verdict"]])


if __name__ == "__main__":
    main()
