#!/usr/bin/env python3
"""Layer 1 の真実フレームと Seedance 出力フレームを比較して PASS/FAIL を出す。

使い方:
  python3 pv/tools/fidelity-qa/report.py \
      --truth pv/renders/<shot> --generated <frames-dir> \
      --min-recall 0.90 --min-precision 0.85 [--radius 2] [--json out.json]
"""
import argparse
import json
import sys
from pathlib import Path

from metrics import edge_mask, edge_precision, edge_recall, instance_boxes, instance_recall


def compare_frame(truth_edge_png, generated_png, radius, boxes):
    truth = edge_mask(truth_edge_png)
    generated = edge_mask(generated_png)
    return {
        "index": int(Path(truth_edge_png).stem),
        "recall": edge_recall(truth, generated, radius),
        "precision": edge_precision(truth, generated, radius),
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
            reasons.append(f"precision {r['precision']:.3f} < {min_precision:.3f} (structure was invented)")
        for name, score in sorted(r.get("instances", {}).items()):
            if score < min_recall:
                reasons.append(f"instance '{name}' recall {score:.3f} < {min_recall:.3f}")
        if reasons:
            failures.append({"index": r["index"], "reasons": reasons})

    return {"verdict": "FAIL" if failures else "PASS", "failures": failures}


def _load_legend(truth_dir: Path):
    """Load instance-legend.json if both the legend and the per-frame instance
    guide directory exist under truth_dir. Returns (legend, instance_dir), or
    (None, None) if there is no instance data for this shot at all.

    Raises SystemExit with a clean message (no traceback) if the legend JSON
    is present but malformed.
    """
    legend_path = truth_dir / "instance-legend.json"
    instance_dir = truth_dir / "instance"
    if not (legend_path.exists() and instance_dir.exists()):
        return None, None
    try:
        legend = json.loads(legend_path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"error: malformed instance legend {legend_path}: {exc}")
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
    per-instance coverage is degraded (no legend/instance dir for the whole
    shot, or a single frame missing its instance guide) so a caller can
    surface it — an empty "instances" dict must never be allowed to look like
    a verified-clean furniture check.
    """
    warn = warn or (lambda msg: None)
    legend, instance_dir = _load_legend(truth_dir)
    if legend is None:
        warn(f"no instance-legend.json/instance/ under {truth_dir} — "
             "per-instance checks skipped for the whole run")

    rows = []
    for truth_png in sorted((truth_dir / "edge").glob("*.png")):
        generated_png = gen_dir / truth_png.name
        if not generated_png.exists():
            continue

        boxes = {}
        if legend is not None:
            instance_png = instance_dir / truth_png.name
            if instance_png.exists():
                boxes = instance_boxes(instance_png, legend)
            else:
                warn(f"no instance guide for frame {truth_png.stem} — "
                     "per-instance checks skipped for this frame")

        rows.append(compare_frame(truth_png, generated_png, radius, boxes))
    return rows


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

    rows = collect_rows(truth_dir, gen_dir, args.radius, warn=warn)

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
