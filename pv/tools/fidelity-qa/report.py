#!/usr/bin/env python3
"""Layer 1 の真実フレームと Seedance 出力フレームを比較して PASS/FAIL を出す。

使い方:
  python3 pv/tools/fidelity-qa/report.py \
      --truth pv/renders/<shot> --generated <frames-dir> \
      --min-recall 0.90 --min-precision 0.85 [--radius 2] [--json out.json]
"""
import argparse
import json
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

    boxes = {}
    legend_path = truth_dir / "instance-legend.json"
    instance_dir = truth_dir / "instance"
    if legend_path.exists() and instance_dir.exists():
        legend = json.loads(legend_path.read_text())
        first_instance = sorted(instance_dir.glob("*.png"))
        if first_instance:
            boxes = instance_boxes(first_instance[0], legend)

    rows = []
    for truth_png in sorted((truth_dir / "edge").glob("*.png")):
        generated_png = gen_dir / truth_png.name
        if not generated_png.exists():
            continue
        rows.append(compare_frame(truth_png, generated_png, args.radius, boxes))

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
