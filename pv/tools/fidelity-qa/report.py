#!/usr/bin/env python3
"""Layer 1 の真実フレームと Seedance 出力フレームを比較して PASS/FAIL を出す。

使い方:
  python3 pv/tools/fidelity-qa/report.py \
      --truth pv/renders/<shot> --generated <frames-dir> \
      --min-recall 0.90 --min-precision 0.85 --min-instance-recall 0.90 \
      [--radius 2] [--json out.json]

比較の基準（両指標とも同じ参照を見る）:

  recall    真実の **同一カメラ姿勢のベースレンダ** `base/<index>.png` の
            エッジのうち、生成フレームのエッジが対応を持つ割合。設計構造の
            消失を検出する。
  precision 生成フレームのエッジのうち、同じ真実ベースレンダのエッジに
            対応物を持つ割合。

  以前は recall だけ真実の合成線画 `edge/<index>.png` を参照していた
  （precision は先に base render 基準に直っていた）。線画は instance map
  から機械的に導いた輪郭線で、**どのシェーディング済みレンダにも写らない
  境界**（同色の壁同士が接する境界、遮蔽されて見えない輪郭）まで律儀に引く。
  ピクセル完全な再現を Topview 相当の解像度に落として測ったところ、線画を
  recall の参照にすると whole-frame recall が 0.35–0.43 まで落ち、
  `wall#2` のようなインスタンスは 0.000 になった — そこには最初から見る
  べきものが無いから落としようがないのに、である。recall も precision と
  同じくベースレンダを参照するよう揃えた。`edge/` はもはや比較の参照には
  ならない（`instance/` + `instance-legend.json` の bbox 定義としては
  引き続き使う）。フレーム索引の列挙にだけ `edge/` のファイル名を使う —
  guideStride で間引かれた索引の集合を持っているのがこのディレクトリだから。

解像度の向き（重要）: 真実 PNG は 2560x1440、Topview の出力は 720p なので
抽出フレームは 1280x720 になる。以前は生成フレームを真実側の寸法へ拡大して
いたが、これは間違っていた。拡大はぼかしを生み、輝度段差が `edge_mask` の
閾値を割り込んで実在するエッジが消える。ピクセル完全な生成を測ると
recall は 0.255〜0.752 まで落ちた。正しい向きは逆で、真実ベースレンダを
生成フレームの寸法へ**縮小**する — この向きだとピクセル完全な生成は全
フレームで recall/precision とも厳密に 1.000 になる。

`base/` は全フレーム分あるが `edge/`（索引の出所）は guideStride 間引きな
ので、比較対象は edge フレームの索引に限られる。base は必ず **そのフレーム
自身の** ものを参照する（カメラが動くので他フレームの base では意味が
ない）。
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
)

# 真実ベースレンダを生成フレームの寸法へ縮小するときの再標本化。
# LANCZOS を選ぶのは通常の写真的画像の縮小に適した高品質フィルタだから。
# (instance guide はこれとは別に NEAREST 固定 — metrics.instance_boxes 参照。
# あちらは flat な ID カラーなので、平滑化フィルタは色を壊す。)
RESAMPLE_BASE = Image.LANCZOS


def load_truth_base(truth_base_png, target_size, on_resize=None):
    """真実ベースレンダを開き、必要なら生成フレームの寸法へ縮小して返す。

    かつては逆向き（生成フレームを真実側の寸法へ拡大）だった。拡大は
    ぼかしを生み、輝度段差が `edge_mask` の閾値を割り込んで実在するエッジが
    消える。縮小方向に直した後は、ピクセル完全な生成が全フレームで
    recall/precision とも厳密に 1.000 になることを測定で確認した。

    アスペクト比が違う場合は解像度差ではなく別画角の取り違えなので、
    引き伸ばして辻褄を合わせず即座に落とす。
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
            "This is a mismatched shot, not a resolution difference."
        )
    if on_resize:
        on_resize(f"truth frames are {tw}x{th}; downscaling to the generated size "
                  f"{gw}x{gh} before edge extraction")
    return img.resize(target_size, RESAMPLE_BASE)


def compare_frame(index, truth_base_png, generated_png, radius, instance_png=None,
                  legend=None, on_resize=None):
    """1フレーム分の recall/precision/instances を計算する。

    真実側の参照はどちらの指標も同じ `base_edges`（真実ベースレンダのエッジ、
    生成フレームの解像度へ縮小済み）。`instance_png` と `legend` が渡された
    場合、instance guide も同じ解像度へ (NEAREST で) 縮小してから bbox を
    読む — recall/precision の参照と同じグリッド上でないと bbox がずれる。
    """
    generated_img = Image.open(generated_png)
    truth_img = load_truth_base(truth_base_png, generated_img.size, on_resize=on_resize)

    base_edges = edge_mask(truth_img)
    generated = edge_mask(generated_img)

    boxes = {}
    if instance_png is not None and legend is not None:
        boxes = instance_boxes(instance_png, legend, target_size=generated_img.size)

    return {
        "index": index,
        "recall": edge_recall(base_edges, generated, radius),
        "precision": edge_precision(base_edges, generated, radius),
        "instances": instance_recall(base_edges, generated, boxes, radius) if boxes else {},
    }


def evaluate(rows, min_recall, min_precision, min_instance_recall):
    """PASS/FAIL を判定する。

    per-instance recall が主指標、whole-frame recall/precision は粗い副次的
    ガードという位置づけである。理由は測定で確認した感度の差にある: ある
    フレームから物体ひとつ分の bbox を丸ごと消したところ、whole-frame recall
    は 1.000→0.942 と 6 ポイントしか動かなかった（部屋全体の輪郭が支配的な
    ので、ひとつの物体の消失は薄まる）。一方その物体自身の per-instance
    recall は 1.000→0.173 まで落ち、他の全 instance は 0.770〜0.971 に
    留まった。whole-frame の数値だけを見ていると、実写生成が正しく加える
    質感変化（Layer 2 の仕事そのもの）による数点の揺らぎと、実際に家具が
    消えた場合の数点の揺らぎが区別できない。per-instance recall はここで
    はっきり分離する。

    そのため per-instance recall には whole-frame の recall/precision とは
    別の、より厳しい閾値 `min_instance_recall` を必須引数として要求する。
    ひとつの共有閾値にすると、whole-frame 側で通すために閾値を緩めた分だけ
    「物体が消えた」を見逃す方向に倒れる — 感度が違うものを同じ物差しで
    測ってはいけない、という今回の学びをそのまま設計に反映している。

    失敗理由は per-instance の名指しを先頭に、whole-frame の数値を副次的な
    文脈として後ろに置く。whole-frame の数値が「主な判定根拠」であるかの
    ような書き方をしないこと。
    """
    if not rows:
        return {"verdict": "FAIL", "failures": [
            {"index": -1, "reasons": ["no frames were compared"]}]}

    failures = []
    for r in rows:
        reasons = []
        # Primary signal first: named per-instance regressions.
        for name, score in sorted(r.get("instances", {}).items()):
            if score < min_instance_recall:
                reasons.append(
                    f"instance '{name}' recall {score:.3f} < {min_instance_recall:.3f} "
                    "(this specific designed object went missing or was altered — "
                    "the primary signal)")
        # Secondary, coarser context: whole-frame guards.
        if r["recall"] < min_recall:
            reasons.append(
                f"whole-frame recall {r['recall']:.3f} < {min_recall:.3f} "
                "(coarse guard; design structure went missing somewhere in the frame)")
        if r["precision"] < min_precision:
            reasons.append(
                f"whole-frame precision {r['precision']:.3f} < {min_precision:.3f} "
                "(coarse guard; structure in the generated frame with no counterpart "
                "in the truth render of the same camera pose)")
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

    `truth_dir / "edge"` is used only to enumerate which frame indices carry
    guide data at all (Layer 1 writes edge/instance/segmentation/depth/normal
    at the same guideStride-thinned indices) — its pixel content is no longer
    read as a comparison reference by either metric; see the module docstring.

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
                f"error: both metrics are measured against the truth base render, but "
                f"{base_png} does not exist. The base render is written for every frame; "
                "a missing one means the truth render is incomplete.")

        instance_png = None
        if legend is not None:
            candidate = instance_dir / truth_png.name
            if candidate.exists():
                instance_png = candidate
            else:
                warn(f"no instance guide for frame {truth_png.stem} — "
                     "per-instance checks skipped for this frame")

        rows.append(compare_frame(int(truth_png.stem), base_png, generated_png, radius,
                                  instance_png=instance_png, legend=legend,
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
    ap.add_argument("--min-recall", type=float, required=True,
                    help="whole-frame recall floor (coarse guard, not the primary signal)")
    ap.add_argument("--min-precision", type=float, required=True,
                    help="whole-frame precision floor (coarse guard, not the primary signal)")
    ap.add_argument("--min-instance-recall", type=float, required=True,
                    help="per-instance recall floor — the primary signal; typically stricter "
                         "than --min-recall since one vanished object barely moves the "
                         "whole-frame number")
    ap.add_argument("--radius", type=int, default=2)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    truth_dir = Path(args.truth)
    gen_dir = Path(args.generated)

    def warn(msg):
        print(f"note: {msg}", file=sys.stderr)

    rows, expected = collect_rows(truth_dir, gen_dir, args.radius, warn=warn)
    assert_coverage(rows, expected, truth_dir, gen_dir)

    result = evaluate(rows, args.min_recall, args.min_precision, args.min_instance_recall)
    result["compared"] = len(rows)
    result["rows"] = rows

    print(f"{result['verdict']} — {len(rows)} frames compared")
    print("  (per-instance recall is the primary signal; whole-frame recall/precision "
          "are coarse secondary context)")
    for f in result["failures"]:
        print(f"  frame {f['index']:>4}: " + "; ".join(f["reasons"]))

    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2))

    raise SystemExit(0 if result["verdict"] == "PASS" else 1)


if __name__ == "__main__":
    main()
