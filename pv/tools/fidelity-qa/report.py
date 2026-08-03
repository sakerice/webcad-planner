#!/usr/bin/env python3
"""Layer 1 の真実フレームと Seedance 出力フレームを比較して PASS/FAIL を出す。

使い方:
  python3 pv/tools/fidelity-qa/report.py \
      --truth pv/renders/<shot> --generated <frames-dir> \
      --min-recall 0.90 --min-precision 0.85 [--radius 2] [--json out.json]

比較の非対称性（重要）:

  recall    真実の線画 `edge/<index>.png` （設計された構造そのもの）に対して、
            生成フレームのエッジが対応を持つ割合。設計構造の消失を検出する。
  precision 生成フレームのエッジのうち、**同一カメラ姿勢の真実ベースレンダ**
            `base/<index>.png` のエッジに対応物を持つ割合。線画ではなく
            ベースレンダを基準にするのは、Layer 2 が担うべき質感（布のしわ・
            接地影・木目・映り込み）が線画には一切無く、それを基準にすると
            正しい生成ほど precision が下がる逆向きの評価になるため。

`base/` は全フレーム分あるが `edge/` は guideStride 間引きなので、比較対象は
edge フレームの索引に限られる。precision は必ず **そのフレーム自身の** base を
参照する（カメラが動くので他フレームの base では意味がない）。
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

from metrics import (
    edge_mask,
    edge_precision,
    edge_recall,
    instance_boxes,
    instance_recall,
    line_edge_mask,
)

# 生成側を真実側の寸法へ引き伸ばすときの再標本化。BICUBIC を選ぶのは、
# LANCZOS のリンギングが境界の両脇に偽の輝度段差を作り、それが
# 「生成側が発明した構造」として precision を押し下げるため。拡大は
# ぼけるだけで構造を作らない、という前提を壊さない補間を使う。
RESAMPLE = Image.BICUBIC


def load_generated(generated_png, truth_size, on_resize=None):
    """生成フレームを開き、必要なら真実フレームの寸法へ拡大して返す。

    Layer 1 の真実 PNG は 2560x1440、Topview の出力は 720p なので抽出フレームは
    1280x720 になる。そのままでは numpy のブロードキャストで落ちる。真実側を
    縮小するのではなく生成側を拡大するのは、真実の線画を素の解像度のまま
    (1px ストロークを保ったまま) 使いたいからで、縮小すると細い線が消える。

    アスペクト比が違う場合は解像度差ではなく別画角の取り違えなので、
    引き伸ばして辻褄を合わせず即座に落とす。
    """
    img = Image.open(generated_png)
    if img.size == truth_size:
        return img
    tw, th = truth_size
    gw, gh = img.size
    if abs(tw / th - gw / gh) > 1e-3:
        raise SystemExit(
            f"error: aspect ratio mismatch for {generated_png}: "
            f"truth {tw}x{th} ({tw / th:.4f}) vs generated {gw}x{gh} ({gw / gh:.4f}). "
            "This is a mismatched shot, not a resolution difference."
        )
    if on_resize:
        on_resize(f"generated frames are {gw}x{gh}; upscaling to the truth size {tw}x{th} "
                  "before edge extraction")
    return img.resize(truth_size, RESAMPLE)


def compare_frame(truth_edge_png, truth_base_png, generated_png, radius, boxes,
                  on_resize=None):
    truth = line_edge_mask(truth_edge_png)
    base_edges = edge_mask(truth_base_png)
    generated_img = load_generated(generated_png, (truth.shape[1], truth.shape[0]),
                                   on_resize=on_resize)
    generated = edge_mask(generated_img)
    return {
        "index": int(Path(truth_edge_png).stem),
        "recall": edge_recall(truth, generated, radius),
        "precision": edge_precision(base_edges, generated, radius),
        "instances": instance_recall(truth, generated, boxes, radius) if boxes else {},
    }


def evaluate(rows, min_recall, min_precision):
    if not rows:
        return {"verdict": "FAIL", "failures": [
            {"index": -1, "reasons": ["no frames were compared"]}]}

    failures = []
    for r in rows:
        reasons = []
        if r["recall"] < min_recall:
            reasons.append(f"recall {r['recall']:.3f} < {min_recall:.3f} (design structure went missing)")
        if r["precision"] < min_precision:
            reasons.append(
                f"precision {r['precision']:.3f} < {min_precision:.3f} "
                "(structure in the generated frame with no counterpart in the truth render "
                "of the same camera pose)")
        for name, score in sorted(r.get("instances", {}).items()):
            if score < min_recall:
                reasons.append(f"instance '{name}' recall {score:.3f} < {min_recall:.3f}")
        if reasons:
            failures.append({"index": r["index"], "reasons": reasons})

    return {"verdict": "FAIL" if failures else "PASS", "failures": failures}


def _load_legend(truth_dir: Path):
    """Load instance-legend.json when the shot has per-frame instance guides.

    Returns (legend, instance_dir), or (None, None) when the shot carries no
    instance data at all (no instance/ directory, or an empty one).

    Raises SystemExit with a clean message (no traceback) when instance frames
    exist but the legend is missing, unreadable, or structurally wrong. A gate
    that reports PASS while checking no furniture at all is worse than one that
    errors: the per-instance check is the only thing that can name which piece
    of designed furniture the generator dropped.
    """
    legend_path = truth_dir / "instance-legend.json"
    instance_dir = truth_dir / "instance"
    has_frames = instance_dir.is_dir() and any(instance_dir.glob("*.png"))
    if not has_frames:
        return None, None

    if not legend_path.exists():
        raise SystemExit(
            f"error: {instance_dir} has instance guide frames but {legend_path} is missing. "
            "Per-instance furniture checks cannot run, and a run that cannot check furniture "
            "must not be allowed to report PASS.")
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
    """Build one comparison row per truth edge frame that has a matching
    generated frame.

    Instance bounding boxes are recomputed for every truth frame from that
    frame's own instance guide PNG (truth_dir/instance/<name>.png) — the
    camera moves shot to shot, so a bounding box measured on frame 0 does not
    describe where an object sits in frame N. Reusing frame 0's boxes for
    every frame would either miss an object that genuinely vanished (its real,
    moved-to region is never inspected) or falsely flag an intact object
    whose old frame-0 region now shows something else entirely.

    `warn`, if given, is called with a message for every situation where
    per-instance coverage is degraded (no instance data for the whole shot, or
    a single frame missing its instance guide) so a caller can surface it — an
    empty "instances" dict must never be allowed to look like a verified-clean
    furniture check.

    Returns (rows, expected) where `expected` is the number of truth edge
    frames found; the caller must compare it against len(rows). See
    assert_coverage().
    """
    warn = warn or (lambda msg: None)
    legend, instance_dir = _load_legend(truth_dir)
    if legend is None:
        warn(f"no instance/ guide frames under {truth_dir} — "
             "per-instance checks skipped for the whole run")

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
                f"error: precision is measured against the truth base render, but {base_png} "
                "does not exist. The base render is written for every frame; a missing one "
                "means the truth render is incomplete.")

        boxes = {}
        if legend is not None:
            instance_png = instance_dir / truth_png.name
            if instance_png.exists():
                boxes = instance_boxes(instance_png, legend)
            else:
                warn(f"no instance guide for frame {truth_png.stem} — "
                     "per-instance checks skipped for this frame")

        rows.append(compare_frame(truth_png, base_png, generated_png, radius, boxes,
                                  on_resize=on_resize))
    return rows, len(truth_pngs)


def assert_coverage(rows, expected, truth_dir: Path, gen_dir: Path):
    """Every truth edge frame must have found a generated counterpart.

    report.py pairs frames purely by filename. The frame extractor
    (pv/tools/extract_video_frames.swift) names its output by centisecond
    (frame_0050 for t=0.5s) while truth frames are named by frame index
    (0012), so a mapping that is off by even one convention silently matches a
    single file — and without this check the gate would print
    "PASS — 1 frames compared" and exit 0 on a run it never examined.
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth", required=True, help="pv/renders/<shot-id>")
    ap.add_argument("--generated", required=True, help="生成動画から抽出したフレームのディレクトリ")
    ap.add_argument("--min-recall", type=float, required=True)
    ap.add_argument("--min-precision", type=float, required=True)
    ap.add_argument("--radius", type=int, default=2)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    truth_dir = Path(args.truth)
    gen_dir = Path(args.generated)

    def warn(msg):
        print(f"note: {msg}", file=sys.stderr)

    rows, expected = collect_rows(truth_dir, gen_dir, args.radius, warn=warn)
    assert_coverage(rows, expected, truth_dir, gen_dir)

    result = evaluate(rows, args.min_recall, args.min_precision)
    result["compared"] = len(rows)
    result["rows"] = rows

    print(f"{result['verdict']} — {len(rows)} frames compared")
    for f in result["failures"]:
        print(f"  frame {f['index']:>4}: " + "; ".join(f["reasons"]))

    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2))

    raise SystemExit(0 if result["verdict"] == "PASS" else 1)


if __name__ == "__main__":
    main()
