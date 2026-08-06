"""カテゴリ対応ゲート (`report.py`) のテスト。

フィクスチャの作り方について（過去に4回、対称すぎるフィクスチャのせいで
誤った実装でも同じ数値が出てテストが何も検証していなかった）:

  truth/base/<i>.png   材質と照明つきの **シェーディング済みレンダ**。
                       平坦なペイント・バイ・ナンバーではない。平坦にすると、
                       生成側が加える質感がすべて構造上「参照外」になり、
                       まさに直したいバグをフィクスチャが再現してしまう。
  truth/segmentation/<i>.png
                       同じ region map を legend の色で塗ったもの。ティア
                       分けの唯一の入力。
  truth/edge/<i>.png   線画。**比較の参照ではない**。索引の列挙にだけ使う。
  generated/<i>.png    同じくシェーディング済みレンダ。
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import categories as cat
from report import (
    EXIT_CODE,
    Thresholds,
    assert_coverage,
    collect_rows,
    evaluate,
)
from metrics import edge_mask, edge_precision, line_edge_mask


# ---------------------------------------------------------------------------
# thresholds
# ---------------------------------------------------------------------------

def thresholds(min_locked_recall=0.75, max_locked_contradiction=0.20,
               min_locked_instance_recall=0.50, min_soft_recall=0.75,
               min_soft_instance_recall=0.50, max_unverifiable_fraction=0.50,
               max_locked_finish_drift=200.0):
    """テスト用の閾値。**production には既定値は無い** — CLI は7つすべてを
    必須引数として要求する。ここで既定値を持たせているのはテストの記述量を
    減らすためだけであり、各テストは自分が動かしたい閾値だけを明示する。

    `max_locked_finish_drift` の既定 200.0 は「色味 L1 の理論最大」であり、
    仕上げドリフトを **一切効かせない** 値である。他のテストの verdict を
    後から足した検査が黙って動かさないための中立値であり、production の
    推奨値ではない。仕上げドリフトを見るテストは自分で値を渡す。"""
    return Thresholds(
        min_locked_recall=min_locked_recall,
        max_locked_contradiction=max_locked_contradiction,
        min_locked_instance_recall=min_locked_instance_recall,
        min_soft_recall=min_soft_recall,
        min_soft_instance_recall=min_soft_instance_recall,
        max_unverifiable_fraction=max_unverifiable_fraction,
        max_locked_finish_drift=max_locked_finish_drift,
    )


# ---------------------------------------------------------------------------
# row builders for the evaluate()-level tests
# ---------------------------------------------------------------------------

def category(tier, recall, contradiction=0.0, lost_px=0, area_px=1000,
             structure_px=100):
    return {"tier": tier, "description": f"{tier} category", "area_px": area_px,
            "structure_px": structure_px, "recall": recall, "lost_px": lost_px,
            "lost_zone": "centre" if lost_px else None, "lost_zone_share": 1.0,
            "contradiction": contradiction}


def row(index, categories=None, instances=None, added_px=0):
    return {
        "index": index,
        "size": [100, 100],
        "whole_frame": {"recall": 1.0, "novelty_precision": 1.0},
        "categories": categories or {},
        "instances": instances or {},
        "added": {"total_px": added_px, "share_of_frame": added_px / 10000.0,
                  "by_category": {}},
        "narrative": [],
    }


def instance(tier, recall, category_key=None, finish_drift=0.0):
    """テスト用の instance 行。

    `finish_drift` の既定 0.0 は「指定した仕上げがそのまま戻ってきた」であり、
    仕上げ以外を見るテストの verdict を汚さない。部材1件につき検査は2件
    (recall と finish) 数えられる点に注意 — `max_unverifiable_fraction` の
    分母がその分増える。"""
    return {"recall": recall, "whole_mask_recall": recall,
            "finish_drift": finish_drift, "finish_drift_ungraded": finish_drift,
            "category": category_key or ("walls" if tier == cat.LOCKED else "furniture"),
            "tier": tier}


class TierVerdictTest(unittest.TestCase):
    """LOCKED だけが run の合否を決め、SOFT は別枠、FREE は決して減点しない。"""

    def test_everything_within_threshold_passes(self):
        rows = [row(0, {"walls": category(cat.LOCKED, 0.99),
                        "furniture": category(cat.SOFT, 0.99)})]
        got = evaluate(rows, thresholds())
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["locked"]["failures"], [])
        self.assertEqual(got["soft"]["findings"], [])

    def test_a_locked_category_below_its_floor_fails_and_names_category_and_frame(self):
        rows = [row(0, {"walls": category(cat.LOCKED, 0.99)}),
                row(7, {"walls": category(cat.LOCKED, 0.30, lost_px=1234)})]
        got = evaluate(rows, thresholds(min_locked_recall=0.75))
        self.assertEqual(got["verdict"], "FAIL")
        self.assertEqual(len(got["locked"]["failures"]), 1)
        self.assertEqual(got["locked"]["failures"][0]["index"], 7)
        reason = got["locked"]["failures"][0]["reasons"][0]
        self.assertIn("walls", reason)
        self.assertIn("1,234", reason)
        self.assertIn("centre", reason)

    def test_a_soft_category_below_its_floor_is_a_regression_not_a_failure(self):
        """家具の張地が変わったことを、壁が消えたことと同じ verdict にしない。

        誤った実装（SOFT を LOCKED と同じバケツに入れる）は verdict を FAIL
        にするので、ここで落ちる。
        """
        rows = [row(0, {"walls": category(cat.LOCKED, 0.99),
                        "furniture": category(cat.SOFT, 0.10)})]
        got = evaluate(rows, thresholds(min_soft_recall=0.75))
        self.assertEqual(got["verdict"], "SOFT_REGRESSION")
        self.assertEqual(got["locked"]["verdict"], "PASS")
        self.assertEqual(got["soft"]["verdict"], "FAIL")
        self.assertEqual(got["locked"]["failures"], [])
        self.assertIn("furniture", got["soft"]["findings"][0]["reasons"][0])

    def test_a_locked_failure_outranks_a_soft_one(self):
        rows = [row(0, {"walls": category(cat.LOCKED, 0.10),
                        "furniture": category(cat.SOFT, 0.10)})]
        got = evaluate(rows, thresholds())
        self.assertEqual(got["verdict"], "FAIL")
        self.assertEqual(got["soft"]["verdict"], "FAIL")

    def test_the_two_tiers_do_not_share_a_threshold(self):
        """同じ recall 0.60 が、LOCKED では失格、SOFT では合格になる閾値を
        与える。ティアごとに別の閾値を見ていない実装（片方をもう片方の変数と
        比べている、あるいは1つの閾値を共有している）はここで落ちる。"""
        rows = [row(0, {"walls": category(cat.LOCKED, 0.60),
                        "furniture": category(cat.SOFT, 0.60)})]
        got = evaluate(rows, thresholds(min_locked_recall=0.80, min_soft_recall=0.50))
        self.assertEqual(got["locked"]["verdict"], "FAIL")
        self.assertEqual(got["soft"]["verdict"], "PASS")

        # mirror image: now SOFT is the strict one and LOCKED the lenient one
        got = evaluate(rows, thresholds(min_locked_recall=0.50, min_soft_recall=0.80))
        self.assertEqual(got["locked"]["verdict"], "PASS")
        self.assertEqual(got["soft"]["verdict"], "FAIL")

    def test_context_categories_never_reach_the_verdict(self):
        """敷地外の隣家・道路・空は、消えても失格にしない（そもそもこの画角
        には写らないし、間取りを定義しない）。"""
        rows = [row(0, {"walls": category(cat.LOCKED, 0.99),
                        "neighbour": category(cat.CONTEXT, 0.0),
                        "sky": category(cat.CONTEXT, 0.0)})]
        got = evaluate(rows, thresholds())
        self.assertEqual(got["verdict"], "PASS")

    def test_empty_rows_fail_rather_than_silently_pass(self):
        got = evaluate([], thresholds())
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("no frames", got["locked"]["failures"][0]["reasons"][0])

    def test_exit_codes_separate_the_three_verdicts(self):
        self.assertEqual(EXIT_CODE["PASS"], 0)
        self.assertEqual(EXIT_CODE["FAIL"], 1)
        self.assertEqual(EXIT_CODE["SOFT_REGRESSION"], 3)
        self.assertEqual(len(set(EXIT_CODE.values())), 3)


class FreeTierIsNeverPenalisedTest(unittest.TestCase):
    """この層の要求そのもの: 人が歩き、食事が置かれ、本が開かれるのは
    良い変化である。量がどれだけ大きくても FAIL の理由にしてはならない。"""

    def test_a_huge_number_of_added_pixels_does_not_change_the_verdict(self):
        clean = [row(0, {"walls": category(cat.LOCKED, 0.99)}, added_px=0)]
        crowded = [row(0, {"walls": category(cat.LOCKED, 0.99)}, added_px=500000)]
        self.assertEqual(evaluate(clean, thresholds())["verdict"], "PASS")
        self.assertEqual(evaluate(crowded, thresholds())["verdict"], "PASS")

    def test_the_additions_are_still_reported_not_discarded(self):
        crowded = [row(0, {"walls": category(cat.LOCKED, 0.99)}, added_px=500000)]
        got = evaluate(crowded, thresholds())
        self.assertEqual(got["free"]["total_added_px"], 500000)
        self.assertIn("never penalised", got["free"]["note"])


class ContradictionThresholdTest(unittest.TestCase):
    def test_replacement_fails_even_when_recall_is_comfortable(self):
        """輪郭の大半は残っているが、一部が **別の構造にすり替わっている**
        場合。recall だけを見る実装はこれを通してしまう。"""
        rows = [row(0, {"walls": category(cat.LOCKED, 0.95, contradiction=0.40)})]
        got = evaluate(rows, thresholds(min_locked_recall=0.75,
                                        max_locked_contradiction=0.20))
        self.assertEqual(got["verdict"], "FAIL")
        reason = " ".join(got["locked"]["failures"][0]["reasons"])
        self.assertIn("contradiction", reason)
        self.assertIn("REPLACED", reason)

    def test_the_contradiction_threshold_is_an_upper_bound_not_a_lower_one(self):
        """向きを取り違えた実装（`<` と `>` の混同）はここで落ちる。"""
        low = [row(0, {"walls": category(cat.LOCKED, 0.95, contradiction=0.01)})]
        high = [row(0, {"walls": category(cat.LOCKED, 0.95, contradiction=0.99)})]
        t = thresholds(max_locked_contradiction=0.20)
        self.assertEqual(evaluate(low, t)["verdict"], "PASS")
        self.assertEqual(evaluate(high, t)["verdict"], "FAIL")

    def test_soft_categories_are_not_gated_on_contradiction(self):
        """ソファが張り替えられて輪郭が引き直されても、それは間取りの矛盾では
        ない。SOFT に contradiction の閾値は掛けない。"""
        rows = [row(0, {"furniture": category(cat.SOFT, 0.99, contradiction=0.99)})]
        self.assertEqual(evaluate(rows, thresholds())["verdict"], "PASS")


class InstanceTierTest(unittest.TestCase):
    def test_a_locked_instance_fails_the_run_and_is_named(self):
        rows = [row(0, {}, {"wall#6": instance(cat.LOCKED, 0.05),
                            "sofa#3": instance(cat.SOFT, 0.99)})]
        got = evaluate(rows, thresholds(min_locked_instance_recall=0.50))
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(got["locked"]["failures"][0]["reasons"])
        self.assertIn("wall#6", joined)
        self.assertNotIn("sofa#3", joined)

    def test_a_soft_instance_only_produces_a_soft_finding(self):
        rows = [row(0, {}, {"sofa#3": instance(cat.SOFT, 0.05)})]
        got = evaluate(rows, thresholds(min_soft_instance_recall=0.50))
        self.assertEqual(got["verdict"], "SOFT_REGRESSION")
        self.assertEqual(got["locked"]["failures"], [])
        self.assertIn("sofa#3", got["soft"]["findings"][0]["reasons"][0])

    def test_instance_tiers_do_not_share_a_threshold(self):
        rows = [row(0, {}, {"wall#6": instance(cat.LOCKED, 0.60),
                            "sofa#3": instance(cat.SOFT, 0.60)})]
        got = evaluate(rows, thresholds(min_locked_instance_recall=0.80,
                                        min_soft_instance_recall=0.40))
        self.assertEqual(got["locked"]["verdict"], "FAIL")
        self.assertEqual(got["soft"]["verdict"], "PASS")

        got = evaluate(rows, thresholds(min_locked_instance_recall=0.40,
                                        min_soft_instance_recall=0.80))
        self.assertEqual(got["locked"]["verdict"], "PASS")
        self.assertEqual(got["soft"]["verdict"], "FAIL")

    def test_a_category_level_threshold_cannot_stand_in_for_the_instance_one(self):
        """カテゴリ全体は健全なのに個別の壁が1枚消えている、という状況。
        カテゴリの数字だけを見る実装はここで落ちる（壁1枚の消失はカテゴリの
        分母に薄まる — 実データでもそうだった: 壁を1枚消してもカテゴリ recall
        は 1.000 -> 0.93〜0.99 しか動かず、その壁自身の instance recall は
        0.000〜0.36 まで落ちた）。"""
        rows = [row(0, {"walls": category(cat.LOCKED, 0.97)},
                    {"wall#6": instance(cat.LOCKED, 0.02)})]
        got = evaluate(rows, thresholds(min_locked_recall=0.75,
                                        min_locked_instance_recall=0.50))
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("wall#6", " ".join(got["locked"]["failures"][0]["reasons"]))


class UnverifiableTest(unittest.TestCase):
    """検証不能 (`None`) は 1.0 と区別し、PASS の根拠には数えず、しかし
    黙って捨てない。"""

    def test_a_single_unverifiable_check_does_not_fail_and_is_named(self):
        rows = [row(0, {"walls": category(cat.LOCKED, None)},
                    {"sofa#3": instance(cat.SOFT, 0.99)})]
        got = evaluate(rows, thresholds())
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["unverifiable"]["count"], 1)
        # 3 = カテゴリ 'walls' の recall + sofa#3 の recall + sofa#3 の仕上げ
        self.assertEqual(got["unverifiable"]["total_checks"], 3)
        self.assertEqual(got["unverifiable"]["frames"],
                         [{"index": 0, "checks": ["category 'walls'"]}])

    def test_none_is_never_compared_against_a_threshold(self):
        """`None` を 0.0 として扱う実装は、どんなに緩い閾値でも失格になる
        ので、ここで落ちる。"""
        rows = [row(0, {"walls": category(cat.LOCKED, None)})]
        got = evaluate(rows, thresholds(min_locked_recall=0.99,
                                        max_unverifiable_fraction=1.0))
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["locked"]["failures"], [])

    def test_a_mostly_unverifiable_run_fails_on_its_own_threshold(self):
        rows = [row(0, {"walls": category(cat.LOCKED, None),
                        "rooms": category(cat.LOCKED, None),
                        "furniture": category(cat.SOFT, 0.99)})]
        got = evaluate(rows, thresholds(max_unverifiable_fraction=0.50))
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("unverifiable", got["locked"]["failures"][-1]["reasons"][0])

    def test_the_unverifiable_limit_is_a_real_knob_not_a_hardcoded_half(self):
        rows = [row(0, {"walls": category(cat.LOCKED, None),
                        "rooms": category(cat.LOCKED, None),
                        "furniture": category(cat.SOFT, 0.99)})]
        # 2 of 3 unverifiable = 0.667
        self.assertEqual(evaluate(rows, thresholds(max_unverifiable_fraction=0.70))
                         ["verdict"], "PASS")
        self.assertEqual(evaluate(rows, thresholds(max_unverifiable_fraction=0.60))
                         ["verdict"], "FAIL")

    def test_thresholds_are_recorded_in_the_machine_readable_output(self):
        got = evaluate([row(0)], thresholds(min_locked_recall=0.61))
        self.assertEqual(got["thresholds"]["min_locked_recall"], 0.61)
        self.assertEqual(sorted(got["thresholds"]), [
            "max_locked_contradiction", "max_locked_finish_drift",
            "max_unverifiable_fraction",
            "min_locked_instance_recall", "min_locked_recall",
            "min_soft_instance_recall", "min_soft_recall"])


# ---------------------------------------------------------------------------
# image fixtures -- see the module docstring
# ---------------------------------------------------------------------------

FIELD, ROOM, SOFA, INVENTED = 0, 1, 2, 3
LEVELS = {FIELD: 30, ROOM: 200, SOFA: 110, INVENTED: 160}

# WALL2 renders at the exact same grey level as ROOM: a real seam the line
# drawing marks (region ids differ) that no shaded render can show. This is
# the `wall#2` failure mode measured on the real render.
WALL2 = 6
LEVELS[WALL2] = LEVELS[ROOM]

FENCE = 7
LEVELS[FENCE] = 140

# A wall region that DOES have contrast against its surroundings, used for the
# "a wall vanished" end-to-end test.
WALL = 8
LEVELS[WALL] = 70

# MUG stands in for the lived-in additions the user explicitly wants: a mug on
# the table, an open book, a plant. It exists only in generated frames. Its
# level is DARK rather than bright on purpose: _appearance_upgrade raises the
# exposure and the daylight falloff, which pushes the room block into the 230s,
# so a bright object would clip against it at 255 and produce no edge at all
# (measured: a 240-level mug produced exactly 0 added pixels -- a fixture that
# tested nothing).
MUG = 9
LEVELS[MUG] = 60

SEGMENTATION_COLOUR = {
    FIELD: "#ffffff",      # sky/background      CONTEXT
    ROOM: "#54c878",       # rooms/floor slabs   LOCKED
    WALL: "#ff4b4b",       # walls               LOCKED
    WALL2: "#ff4b4b",      # walls               LOCKED
    SOFA: "#d45cff",       # furniture           SOFT
    FENCE: "#d45cff",      # furniture           SOFT
    INVENTED: "#ff4b4b",   # only ever in generated frames
    MUG: "#d45cff",        # only ever in generated frames
}

SOFA_H, SOFA_W = 20, 25


def _rgb(hexcolour):
    h = hexcolour.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _line_drawing(regions: np.ndarray) -> np.ndarray:
    """White paper with a 1px dark stroke on every region boundary."""
    img = np.full(regions.shape, 255, dtype=np.uint8)
    img[:, :-1][regions[:, :-1] != regions[:, 1:]] = 20
    img[:-1, :][regions[:-1, :] != regions[1:, :]] = 20
    return img


def _segmentation(regions: np.ndarray) -> np.ndarray:
    out = np.zeros(regions.shape + (3,), dtype=np.uint8)
    for rid, hexcolour in SEGMENTATION_COLOUR.items():
        out[regions == rid] = _rgb(hexcolour)
    return out


def _save(path: Path, arr: np.ndarray):
    Image.fromarray(arr.astype(np.uint8)).save(path)


def _regions(size=300, sofa=None, invented=False) -> np.ndarray:
    """Architectural truth: a room block, optionally a sofa inside it,
    optionally a wall the design never had.

    The sofa is deliberately small next to the room outline so that losing it
    moves the whole-frame numbers only a few points: the per-instance and
    per-category checks have to be what catch it."""
    r = np.zeros((size, size), dtype=np.uint8)
    r[100:280, 100:280] = ROOM
    if sofa is not None:
        y, x = sofa
        r[y:y + SOFA_H, x:x + SOFA_W] = SOFA
    if invented:
        r[110:270, 40:60] = INVENTED
    return r


def _render(regions: np.ndarray, *, exposure: int = 0, rug_contrast: int = 45,
            daylight: int = 20) -> np.ndarray:
    """A shaded render of `regions`, WITH material and lighting detail.

    A real base render is not a flat paint-by-numbers of the region map: it is
    rendered with materials and lighting, so its edge map already carries a rug
    weave, a daylight falloff and contact shading. Modelling it as flat would
    rig every fixture here."""
    out = np.zeros(regions.shape, dtype=np.int16)
    for rid, level in LEVELS.items():
        out[regions == rid] = level
    out[200:270:6, 120:170] += rug_contrast          # rug weave, a designed material
    gradient = np.linspace(-daylight, daylight, out.shape[1]).astype(np.int16)
    inside = regions != FIELD
    out[inside] += np.broadcast_to(gradient[None, :], out.shape)[inside]
    out += exposure
    return np.clip(out, 0, 255).astype(np.uint8)


def _appearance_upgrade(regions: np.ndarray) -> np.ndarray:
    """A generation that changed ONLY appearance: warmer exposure, a stronger
    daylight falloff, a more pronounced weave -- all at the same places the
    base render already has them. No geometry touched."""
    return _render(regions, exposure=18, rug_contrast=70, daylight=32)


def _write_truth_frame(truth: Path, name: str, regions: np.ndarray):
    _save(truth / "edge" / name, _line_drawing(regions))
    _save(truth / "base" / name, _render(regions))
    _save(truth / "segmentation" / name, _segmentation(regions))


def _make_truth_dirs(root: Path, with_instance=False):
    truth = root / "truth"
    for sub in ("edge", "base", "segmentation"):
        (truth / sub).mkdir(parents=True)
    if with_instance:
        (truth / "instance").mkdir(parents=True)
    gen = root / "generated"
    gen.mkdir(parents=True)
    return truth, gen


def _build_camera_move_fixture(root: Path):
    """Two-frame fixture simulating a camera push.

    The sofa's instance-guide box moves between frames, mirroring a real camera
    move. In frame 1 the sofa is present in truth but absent from the generated
    frame. A stale frame-0 box would keep inspecting region A for frame 1 too --
    where frame 1's truth has nothing at all, so an empty-truth box trivially
    scores None and the vanish goes unflagged."""
    truth, gen = _make_truth_dirs(root, with_instance=True)
    (truth / "instance-legend.json").write_text(json.dumps({
        "version": 2,
        "instances": [{"id": 1, "color": "#ff0000", "label": "sofa"}],
    }))

    def instance_png(y, x):
        arr = np.zeros((300, 300, 3), dtype=np.uint8)
        arr[y:y + SOFA_H, x:x + SOFA_W] = (255, 0, 0)
        return arr

    truth0 = _regions(sofa=(110, 110))
    _write_truth_frame(truth, "0000.png", truth0)
    _save(gen / "0000.png", _appearance_upgrade(truth0))
    _save(truth / "instance" / "0000.png", instance_png(110, 110))

    truth1 = _regions(sofa=(160, 130))
    _write_truth_frame(truth, "0001.png", truth1)
    _save(gen / "0001.png", _appearance_upgrade(_regions(sofa=None)))
    _save(truth / "instance" / "0001.png", instance_png(160, 130))

    return truth, gen


class LayerPairingTest(unittest.TestCase):
    def _run(self, truth_regions, generated_render, radius=1):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _make_truth_dirs(Path(tmp))
            _write_truth_frame(truth, "0000.png", truth_regions)
            _save(gen / "0000.png", generated_render)
            rows, expected = collect_rows(truth, gen, radius=radius)
        self.assertEqual(expected, 1)
        return rows[0]

    def test_appearance_only_upgrade_keeps_every_locked_category_high(self):
        """A stronger weave, a warmer exposure and a steeper daylight falloff
        are precisely what Layer 2 exists to add. They must not read as a
        changed floor plan."""
        regions = _regions(sofa=(120, 200))
        got = self._run(regions, _appearance_upgrade(regions))
        self.assertGreater(got["categories"]["rooms"]["recall"], 0.95, got["categories"])
        self.assertLess(got["categories"]["rooms"]["contradiction"], 0.05)

    def test_precision_against_the_line_drawing_would_still_collapse(self):
        """Guardrail predating this change: scoring an appearance-only
        generation against the truth LINE DRAWING instead of the truth BASE
        RENDER collapses the novelty measure, because Layer 2's legitimate
        material/lighting detail has no counterpart in a line drawing.
        compare_frame() cannot express "reference the line drawing" at all any
        more, so the guardrail is exercised at the metrics level."""
        regions = _regions(sofa=(120, 200))
        line = line_edge_mask(Image.fromarray(_line_drawing(regions)))
        base_edges = edge_mask(Image.fromarray(_render(regions)))
        generated = edge_mask(Image.fromarray(_appearance_upgrade(regions)))

        self.assertGreater(edge_precision(base_edges, generated, 1), 0.95)
        self.assertLess(edge_precision(line, generated, 1), 0.6)

    def test_vanished_room_structure_still_drops_that_categorys_recall(self):
        regions = _regions(sofa=(120, 200))
        gone = _appearance_upgrade(np.zeros_like(regions))
        got = self._run(regions, gone)
        self.assertLess(got["categories"]["rooms"]["recall"], 0.2, got["categories"])


class AddedObjectIsFreeNotAPenaltyTest(unittest.TestCase):
    """要求そのもの: テーブルに置かれたマグ、開いた本、床を歩く人物は
    「良い変化」であって減点対象ではない。旧 precision は新しいエッジを
    一律に減点したので、これが下がった。"""

    def _fixture(self, root: Path, mug: bool):
        truth, gen = _make_truth_dirs(root)
        regions = _regions(sofa=(120, 200))
        _write_truth_frame(truth, "0000.png", regions)
        generated_regions = regions.copy()
        if mug:
            # a compact object in open floor space, well away from any
            # category boundary of the room block
            generated_regions[180:220, 180:220] = MUG
        _save(gen / "0000.png", _appearance_upgrade(generated_regions))
        return truth, gen

    def test_the_mug_shows_up_as_a_free_addition_and_costs_no_locked_recall(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(Path(tmp) / "with", mug=True)
            with_mug, _ = collect_rows(truth, gen, radius=1)
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(Path(tmp) / "without", mug=False)
            without_mug, _ = collect_rows(truth, gen, radius=1)

        # the addition is measured ...
        self.assertGreater(with_mug[0]["added"]["total_px"],
                           without_mug[0]["added"]["total_px"] + 100)
        self.assertIn("rooms", with_mug[0]["added"]["by_category"])
        # ... and described in words for the operator
        narrative = " ".join(with_mug[0]["narrative"])
        self.assertIn("FREE", narrative)
        self.assertIn("never penalised", narrative)

        # ... and costs nothing on the locked tier
        self.assertAlmostEqual(with_mug[0]["categories"]["rooms"]["recall"],
                               without_mug[0]["categories"]["rooms"]["recall"],
                               delta=0.02)
        self.assertLess(with_mug[0]["categories"]["rooms"]["contradiction"], 0.02)

        t = thresholds(min_locked_recall=0.90, max_locked_contradiction=0.10)
        self.assertEqual(evaluate(with_mug, t)["verdict"], "PASS")

    def test_the_old_blanket_precision_would_have_charged_for_the_mug(self):
        """この対照が無いと「マグを足しても PASS」は当たり前に見えてしまう。
        旧指標なら実際に下がったことを同じフィクスチャで示す。"""
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(Path(tmp) / "with", mug=True)
            with_mug, _ = collect_rows(truth, gen, radius=1)
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(Path(tmp) / "without", mug=False)
            without_mug, _ = collect_rows(truth, gen, radius=1)

        self.assertLess(with_mug[0]["whole_frame"]["novelty_precision"],
                        without_mug[0]["whole_frame"]["novelty_precision"] - 0.01)


class VanishedWallFailsLockedTest(unittest.TestCase):
    """壁が消えたら LOCKED で落ち、どのカテゴリのどこかを名指しする。"""

    def _regions(self, wall=True):
        r = np.zeros((300, 300), dtype=np.uint8)
        r[100:280, 100:280] = ROOM
        if wall:
            # cols 200:220 keeps the wall clear of the rug weave that
            # _render lays down at cols 120:170 -- otherwise the rug's own
            # stripes sit exactly on the wall's silhouette and "rescue" the
            # score of a wall that is not there (measured: recall 0.409
            # instead of 0.03).
            r[120:260, 200:220] = WALL
        return r

    def _run(self, generated_regions):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _make_truth_dirs(Path(tmp))
            _write_truth_frame(truth, "0000.png", self._regions(wall=True))
            _save(gen / "0000.png", _appearance_upgrade(generated_regions))
            rows, _ = collect_rows(truth, gen, radius=1)
        return rows

    def test_removing_the_wall_craters_the_walls_category_and_names_it(self):
        rows = self._run(self._regions(wall=False))
        walls = rows[0]["categories"]["walls"]
        self.assertLess(walls["recall"], 0.2, rows[0]["categories"])
        got = evaluate(rows, thresholds(min_locked_recall=0.75))
        self.assertEqual(got["verdict"], "FAIL")
        reason = " ".join(got["locked"]["failures"][0]["reasons"])
        self.assertIn("walls", reason)
        self.assertIn("floor plan", reason)

    def test_keeping_the_wall_passes_on_the_same_fixture_and_thresholds(self):
        """壁を残した同じフィクスチャ。これが無いと、上のテストは「何を
        入れても FAIL する実装」でも通ってしまう。"""
        rows = self._run(self._regions(wall=True))
        self.assertGreater(rows[0]["categories"]["walls"]["recall"], 0.9)
        got = evaluate(rows, thresholds(min_locked_recall=0.75))
        self.assertEqual(got["verdict"], "PASS")


class SoftFurnitureLossIsNotALockedFailureTest(unittest.TestCase):
    def _run(self, generated_regions):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _make_truth_dirs(Path(tmp))
            _write_truth_frame(truth, "0000.png", _regions(sofa=(120, 200)))
            _save(gen / "0000.png", _appearance_upgrade(generated_regions))
            rows, _ = collect_rows(truth, gen, radius=1)
        return rows

    def test_a_dropped_sofa_is_a_soft_regression_not_a_locked_failure(self):
        rows = self._run(_regions(sofa=None))
        self.assertLess(rows[0]["categories"]["furniture"]["recall"], 0.2,
                        rows[0]["categories"])
        got = evaluate(rows, thresholds(min_locked_recall=0.75, min_soft_recall=0.75))
        self.assertEqual(got["verdict"], "SOFT_REGRESSION")
        self.assertEqual(got["locked"]["verdict"], "PASS")
        self.assertIn("furniture", got["soft"]["findings"][0]["reasons"][0])


class NarrativeTest(unittest.TestCase):
    def test_every_frame_describes_what_was_lost_and_what_was_added(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _make_truth_dirs(Path(tmp))
            regions = _regions(sofa=(120, 200))
            _write_truth_frame(truth, "0000.png", regions)
            changed = _regions(sofa=None)
            changed[180:220, 180:220] = MUG
            _save(gen / "0000.png", _appearance_upgrade(changed))
            rows, _ = collect_rows(truth, gen, radius=1)

        text = "\n".join(rows[0]["narrative"])
        self.assertIn("[LOCKED] rooms", text)
        self.assertIn("[SOFT] furniture", text)
        self.assertIn("[FREE]", text)
        self.assertIn("lost", text)
        self.assertIn("no counterpart in the truth render", text)
        # the narrative travels in the machine-readable output too
        self.assertEqual(rows[0]["narrative"], json.loads(json.dumps(rows[0]))["narrative"])


class SegmentationGateTest(unittest.TestCase):
    """ティア分けができない run は PASS と読めてはならない。"""

    def test_a_shot_with_no_segmentation_at_all_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _build_camera_move_fixture(Path(tmp))
            shutil.rmtree(truth / "segmentation")
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth, gen, radius=1)
        message = str(ctx.exception)
        # Assert on the WHOLE-SHOT gate's own wording, not merely on the word
        # "segmentation". Deleting the run-level gate leaves the per-frame gate
        # ("<file> does not exist but ...") to raise instead, whose message
        # also contains "segmentation" -- a looser assertion passed the
        # mutation where the run-level gate had been removed entirely.
        self.assertIn("no segmentation guide frames", message)
        self.assertIn("vanished wall from an added mug", message)

    def test_a_single_frame_missing_its_segmentation_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _build_camera_move_fixture(Path(tmp))
            (truth / "segmentation" / "0001.png").unlink()
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth, gen, radius=1)
        message = str(ctx.exception)
        self.assertIn("0001", message)
        self.assertIn("segmentation", message)


class ResolutionTest(unittest.TestCase):
    def _fixture(self, tmp, gen_size):
        truth, gen = _make_truth_dirs(Path(tmp))
        regions = np.zeros((288, 512), dtype=np.uint8)
        regions[60:230, 100:400] = ROOM
        regions[120:180, 150:220] = SOFA
        _write_truth_frame(truth, "0000.png", regions)
        shaded = Image.fromarray(_appearance_upgrade(regions))
        shaded.resize(gen_size, Image.BICUBIC).save(gen / "0000.png")
        return truth, gen

    def test_half_resolution_generated_frame_is_matched_by_downscaling_truth(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            notes = []
            rows, expected = collect_rows(truth, gen, radius=2, warn=notes.append)
        self.assertEqual((len(rows), expected), (1, 1))
        self.assertGreater(rows[0]["categories"]["rooms"]["recall"], 0.9)
        self.assertTrue(any("downscaling" in n for n in notes), notes)

    def test_resize_is_logged_once_per_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            for sub in ("edge", "base", "segmentation"):
                shutil.copy(truth / sub / "0000.png", truth / sub / "0001.png")
            shutil.copy(gen / "0000.png", gen / "0001.png")
            notes = []
            rows, _ = collect_rows(truth, gen, radius=2, warn=notes.append)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len([n for n in notes if "downscaling" in n]), 1, notes)

    def test_mismatched_aspect_ratio_fails_loudly_instead_of_being_stretched(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 256))
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth, gen, radius=2)
        self.assertIn("aspect ratio mismatch", str(ctx.exception))

    def test_generated_larger_than_truth_refuses_to_upscale_the_truth(self):
        """report.py always downscales the truth down to the generated frame's
        size, never the reverse. Resizing the truth UP would blur it and push
        real edges below edge_mask's threshold -- the same failure mode that
        scored a pixel-perfect generation 0.255-0.752, in mirror image."""
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (1024, 576))   # double the truth
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth, gen, radius=2)
        message = str(ctx.exception)
        self.assertIn("1024x576", message)
        self.assertIn("512x288", message)
        self.assertIn("larger than the truth", message)

    def test_the_logged_note_always_matches_what_actually_happened(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            notes = []
            collect_rows(truth, gen, radius=2, warn=notes.append)
        self.assertTrue(any("512x288" in n and "downscaling" in n and "256x144" in n
                            for n in notes), notes)


class CoverageTest(unittest.TestCase):
    def test_unmatched_truth_frames_fail_instead_of_reporting_a_one_frame_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (gen_dir / "0001.png").unlink()
            rows, expected = collect_rows(truth_dir, gen_dir, radius=1)
            self.assertEqual((len(rows), expected), (1, 2))
            with self.assertRaises(SystemExit) as ctx:
                assert_coverage(rows, expected, truth_dir, gen_dir)
        self.assertIn("only 1 of 2", str(ctx.exception))

    def test_full_coverage_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            rows, expected = collect_rows(truth_dir, gen_dir, radius=1)
            assert_coverage(rows, expected, truth_dir, gen_dir)
        self.assertEqual(len(rows), 2)


class CollectRowsTest(unittest.TestCase):
    def test_instance_box_follows_the_camera_and_catches_a_frame_local_vanish(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            rows, _ = collect_rows(truth_dir, gen_dir, radius=1)

        self.assertEqual(len(rows), 2)
        frame0, frame1 = rows
        self.assertGreater(frame0["instances"]["sofa"]["recall"], 0.9, frame0["instances"])
        self.assertLess(frame1["instances"]["sofa"]["recall"], 0.3, frame1["instances"])

        # the sofa sits on furniture-coloured segmentation, so it is SOFT --
        # dropping it is a soft regression, not a changed floor plan
        self.assertEqual(frame1["instances"]["sofa"]["tier"], cat.SOFT)
        result = evaluate(rows, thresholds(min_soft_instance_recall=0.85,
                                           min_soft_recall=0.0))
        self.assertEqual(result["verdict"], "SOFT_REGRESSION")
        self.assertEqual(result["soft"]["findings"][0]["index"], 1)
        self.assertIn("sofa", " ".join(result["soft"]["findings"][0]["reasons"]))

    def test_missing_instance_guide_for_one_frame_skips_only_that_frame_and_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance" / "0001.png").unlink()
            warnings = []
            rows, _ = collect_rows(truth_dir, gen_dir, radius=1, warn=warnings.append)

        self.assertEqual(len(rows), 2)
        self.assertIn("sofa", rows[0]["instances"])
        self.assertEqual(rows[1]["instances"], {})
        self.assertTrue(any("0001" in w for w in warnings), warnings)

    def test_missing_instance_data_for_whole_run_warns_once_and_skips_everywhere(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            shutil.rmtree(truth_dir / "instance")
            (truth_dir / "instance-legend.json").unlink()
            warnings = []
            rows, _ = collect_rows(truth_dir, gen_dir, radius=1, warn=warnings.append)

        self.assertEqual(len(rows), 2)
        for r in rows:
            self.assertEqual(r["instances"], {})
        self.assertEqual(len(warnings), 1)

    def test_missing_base_render_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "base" / "0001.png").unlink()
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth_dir, gen_dir, radius=1)
        self.assertIn("base", str(ctx.exception))


class LegendGateTest(unittest.TestCase):
    def test_instance_frames_without_a_legend_fail_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance-legend.json").unlink()
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth_dir, gen_dir, radius=1)
        message = str(ctx.exception)
        self.assertIn("instance-legend.json", message)
        self.assertIn("missing", message)

    def test_malformed_legend_json_fails_clean_instead_of_raising_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance-legend.json").write_text("{not valid json")
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth_dir, gen_dir, radius=1)
            self.assertIn("instance-legend.json", str(ctx.exception))

    def test_valid_json_that_is_not_an_object_fails_clean_and_names_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance-legend.json").write_text('[{"id": 1}]')
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth_dir, gen_dir, radius=1)
        message = str(ctx.exception)
        self.assertIn("instance-legend.json", message)
        self.assertIn("list", message)

    def test_instances_field_of_the_wrong_type_fails_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance-legend.json").write_text('{"instances": "sofa"}')
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth_dir, gen_dir, radius=1)
        self.assertIn("instances", str(ctx.exception))


class PixelPerfectDifferentResolutionTest(unittest.TestCase):
    """Both preserved fixes at once.

    Cause A: the truth reference is the base render, not the line drawing.
    `WALL2` renders at the exact same grey level as `ROOM`; their shared
    boundary is a real seam the line drawing marks but that no shaded render
    can show -- the `wall#2` failure mode measured on T91-ldk-push (recall
    0.000 against a pixel-perfect reproduction).

    Cause B: the resize direction. The "generated" frame here is the truth base
    render downscaled with LANCZOS. If report.py upscaled the generated frame
    to the truth's resolution instead, the blur would push real edges below
    edge_mask's threshold (measured: 0.255-0.752), not read exactly 1.000.
    """

    TRUTH_SIZE = (480, 270)
    GEN_SIZE = (240, 135)

    def _regions(self):
        w, h = self.TRUTH_SIZE
        regions = np.zeros((h, w), dtype=np.uint8)
        regions[40:230, 40:220] = ROOM
        regions[40:230, 220:440] = WALL2   # same render level as ROOM
        regions[100:140, 60:140] = SOFA
        return regions

    def _build(self, root: Path, indices):
        truth, gen = _make_truth_dirs(root)
        regions = self._regions()
        base = _render(regions)
        for i in indices:
            name = f"{i:04d}.png"
            _write_truth_frame(truth, name, regions)
            Image.fromarray(base).resize(self.GEN_SIZE, Image.LANCZOS).save(gen / name)
        return truth, gen

    def test_a_perfect_generation_scores_one_on_every_gated_category(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp), [0, 12, 24])
            notes = []
            rows, expected = collect_rows(truth, gen, radius=0, warn=notes.append)
        self.assertEqual((len(rows), expected), (3, 3))
        for r in rows:
            for key in cat.LOCKED_KEYS + cat.SOFT_KEYS:
                entry = r["categories"].get(key)
                if entry is None or entry["recall"] is None:
                    continue
                self.assertEqual(entry["recall"], 1.0, (key, r["index"], entry))
                self.assertEqual(entry["contradiction"], 0.0, (key, r["index"], entry))
        self.assertTrue(any("downscaling" in n for n in notes), notes)
        self.assertEqual(evaluate(rows, thresholds(min_locked_recall=0.999,
                                                   min_soft_recall=0.999,
                                                   max_locked_contradiction=0.0))
                         ["verdict"], "PASS")


class SameToneInstanceIsUnverifiableEndToEndTest(unittest.TestCase):
    """An instance whose truth-side edges are entirely zero because it meets a
    same-tone neighbour -- `wall2` here, mirroring the real `wall#2` on
    T91-ldk-push -- must score None, never 1.0, even on an otherwise
    pixel-perfect generation."""

    SIZE = 300

    def _regions(self):
        r = np.zeros((self.SIZE, self.SIZE), dtype=np.uint8)
        r[100:280, 100:280] = ROOM
        r[150:200, 190:210] = WALL2      # identical render level to ROOM
        r[120:140, 150:175] = SOFA
        return r

    def _instance_png(self):
        arr = np.zeros((self.SIZE, self.SIZE, 3), dtype=np.uint8)
        arr[150:200, 190:210] = (0, 0, 255)   # wall2
        arr[120:140, 150:175] = (255, 0, 0)   # sofa
        return arr

    def _build(self, root: Path):
        truth, gen = _make_truth_dirs(root, with_instance=True)
        (truth / "instance-legend.json").write_text(json.dumps({
            "version": 2,
            "instances": [
                {"id": 1, "color": "#0000ff", "label": "wall2"},
                {"id": 2, "color": "#ff0000", "label": "sofa"},
            ],
        }))
        regions = self._regions()
        _write_truth_frame(truth, "0000.png", regions)
        _save(truth / "instance" / "0000.png", self._instance_png())
        _save(gen / "0000.png", _appearance_upgrade(regions))
        return truth, gen

    def test_same_tone_instance_scores_none_not_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp))
            rows, expected = collect_rows(truth, gen, radius=1)
        self.assertEqual((len(rows), expected), (1, 1))
        instances = rows[0]["instances"]
        self.assertIsNone(instances["wall2"]["recall"], instances)
        self.assertGreater(instances["sofa"]["recall"], 0.9, instances)

    def test_run_still_passes_and_names_the_unverifiable_instance(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp))
            rows, _ = collect_rows(truth, gen, radius=1)
        result = evaluate(rows, thresholds(min_locked_recall=0.90,
                                           min_soft_recall=0.90,
                                           min_locked_instance_recall=0.90,
                                           min_soft_instance_recall=0.90))
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(len(result["unverifiable"]["frames"]), 1)
        self.assertIn("instance 'wall2'",
                      result["unverifiable"]["frames"][0]["checks"])


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# 仕上げ(色味)ドリフト
# ---------------------------------------------------------------------------

class FinishDriftGateTest(unittest.TestCase):
    """指定した仕上げが変わったら run は FAIL し、どの部材かを名指しする。

    ここは `evaluate` の配線だけを見る（画像からの計測は
    `test_metrics.FinishDriftTest` と下の end-to-end が受け持つ）。
    """

    def test_a_drifted_finish_fails_the_run_and_names_the_object(self):
        rows = [row(0, {}, {"stair#22": instance(cat.SOFT, 0.99, finish_drift=17.8),
                            "wall#4": instance(cat.LOCKED, 0.99, finish_drift=7.4)})]
        got = evaluate(rows, thresholds(max_locked_finish_drift=12.0))
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(got["locked"]["failures"][0]["reasons"])
        self.assertIn("stair#22", joined)
        self.assertNotIn("wall#4", joined)
        self.assertIn("finish", joined)

    def test_the_finish_threshold_is_a_real_knob_not_a_constant(self):
        rows = [row(0, {}, {"stair#22": instance(cat.SOFT, 0.99, finish_drift=17.8)})]
        self.assertEqual(evaluate(rows, thresholds(max_locked_finish_drift=20.0))
                         ["verdict"], "PASS")
        self.assertEqual(evaluate(rows, thresholds(max_locked_finish_drift=15.0))
                         ["verdict"], "FAIL")

    def test_finish_drift_is_gated_on_every_tier_not_only_locked_categories(self):
        """実測の根拠: T92 で本当に仕上げが変わっていた上位は
        lattice-screen#35 (69.5) と balcony#20 (19.4) で、どちらもカテゴリは
        exterior=CONTEXT。stair#22 (12.7) と stair-corner#23 (17.8) は
        furniture=SOFT。LOCKED カテゴリの部材だけを見る実装は、実在した
        仕上げ変化を1件も捕まえられない。"""
        for tier, key in [(cat.CONTEXT, "exterior"), (cat.SOFT, "furniture"),
                          (cat.LOCKED, "walls")]:
            rows = [row(0, {}, {"thing#1": instance(tier, 0.99, category_key=key,
                                                    finish_drift=69.5)})]
            got = evaluate(rows, thresholds(max_locked_finish_drift=12.0))
            self.assertEqual(got["verdict"], "FAIL", f"tier={tier}")
            self.assertEqual(got["locked"]["verdict"], "FAIL", f"tier={tier}")

    def test_a_soft_recall_regression_does_not_borrow_the_finish_verdict(self):
        """仕上げは無傷で recall だけ落ちた部材は SOFT_REGRESSION のまま。
        仕上げ検査を recall と同じバケツに入れる実装はここで落ちる。"""
        rows = [row(0, {}, {"sofa#3": instance(cat.SOFT, 0.05, finish_drift=0.4)})]
        got = evaluate(rows, thresholds(min_soft_instance_recall=0.50,
                                        max_locked_finish_drift=12.0))
        self.assertEqual(got["verdict"], "SOFT_REGRESSION")
        self.assertEqual(got["locked"]["verdict"], "PASS")

    def test_an_undefined_finish_is_unverifiable_not_a_pass(self):
        rows = [row(0, {}, {"sofa#3": instance(cat.SOFT, 0.99, finish_drift=None)})]
        got = evaluate(rows, thresholds(max_locked_finish_drift=0.0,
                                        max_unverifiable_fraction=1.0))
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["locked"]["failures"], [])
        self.assertEqual(got["unverifiable"]["count"], 1)
        self.assertEqual(got["unverifiable"]["frames"],
                         [{"index": 0, "checks": ["instance 'sofa#3' finish"]}])

    def test_a_missing_finish_field_is_loud_not_silently_skipped(self):
        """`compare_frame` が finish_drift を落とした日に、ゲートが黙って
        無効化されたまま PASS を出さないこと。"""
        broken = instance(cat.LOCKED, 0.99)
        del broken["finish_drift"]
        with self.assertRaises(KeyError):
            evaluate([row(0, {}, {"wall#4": broken})], thresholds())


# 色つきの end-to-end フィクスチャ。既存の `_render` はグレースケールなので、
# 色味 L1 は定義上つねに 0 になる — 仕上げドリフトを実際に動かすには色が要る。
FINISH_PALETTE = {FIELD: (30, 32, 36), ROOM: (198, 194, 188), SOFA: (100, 117, 142)}


def _colour_render(regions, recolour=None, gain=(1.0, 1.0, 1.0)):
    """材質と照明つきの色付きレンダ。平坦なペイント・バイ・ナンバーではない
    （面内に木目と採光の傾斜を入れてある）。"""
    palette = dict(FINISH_PALETTE)
    palette.update(recolour or {})
    out = np.zeros(regions.shape + (3,), dtype=np.float64)
    for rid, colour in palette.items():
        out[regions == rid] = colour
    out[200:270:6, 120:170] += 45                       # 木目
    gradient = np.linspace(-20, 20, regions.shape[1])   # 採光の傾斜
    inside = regions != FIELD
    out[inside] += gradient[None, :, None].repeat(regions.shape[0], 0)[inside]
    out *= np.array(gain, dtype=np.float64)
    return np.clip(out, 0, 255).astype(np.uint8)


class FinishDriftEndToEndTest(unittest.TestCase):
    """instance guide を実際に読み、色味の変わった部材を名指しできること。"""

    SOFA_BOX = (120, 200)

    def _run(self, generated):
        regions = _regions(sofa=self.SOFA_BOX)
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = _make_truth_dirs(Path(tmp), with_instance=True)
            (truth / "instance-legend.json").write_text(json.dumps({
                "version": 2,
                "instances": [{"id": 1, "color": "#ff0000", "label": "sofa#1"}],
            }))
            _save(truth / "edge" / "0000.png", _line_drawing(regions))
            _save(truth / "segmentation" / "0000.png", _segmentation(regions))
            _save(truth / "base" / "0000.png", _colour_render(regions))
            guide = np.zeros((300, 300, 3), dtype=np.uint8)
            y, x = self.SOFA_BOX
            guide[y:y + SOFA_H, x:x + SOFA_W] = (255, 0, 0)
            _save(truth / "instance" / "0000.png", guide)
            _save(gen / "0000.png", generated(regions))
            rows, _ = collect_rows(truth, gen, radius=1)
        return rows

    def test_every_instance_carries_a_finish_number(self):
        rows = self._run(lambda r: _colour_render(r))
        self.assertIn("finish_drift", rows[0]["instances"]["sofa#1"])
        self.assertIn("finish_drift_ungraded", rows[0]["instances"]["sofa#1"])
        self.assertIn("colour_grade", rows[0])

    def test_a_faithful_reproduction_has_no_finish_drift(self):
        rows = self._run(lambda r: _colour_render(r))
        self.assertLess(rows[0]["instances"]["sofa#1"]["finish_drift"], 0.5)
        self.assertEqual(evaluate(rows, thresholds(min_locked_recall=0.75,
                                                   max_locked_finish_drift=12.0))
                         ["verdict"], "PASS")

    def test_a_brighter_generation_still_passes_the_finish_gate(self):
        """正当に明るいだけの生成で仕上げ違反を出してはならない。"""
        rows = self._run(lambda r: _colour_render(r, gain=(1.25, 1.25, 1.25)))
        self.assertLess(rows[0]["instances"]["sofa#1"]["finish_drift"], 2.0)
        self.assertEqual(evaluate(rows, thresholds(min_locked_recall=0.75,
                                                   max_locked_finish_drift=12.0))
                         ["verdict"], "PASS")

    def test_a_recoloured_sofa_fails_locked_and_is_named(self):
        """青灰色 [100,117,142] がクリーム色の木 [230,217,196] に化けた
        — 実データ (stair-corner#23) で起きたのと同じ変化。"""
        rows = self._run(lambda r: _colour_render(r, recolour={SOFA: (230, 217, 196)}))
        self.assertGreater(rows[0]["instances"]["sofa#1"]["finish_drift"], 12.0)
        got = evaluate(rows, thresholds(min_locked_recall=0.75,
                                        max_locked_finish_drift=12.0))
        self.assertEqual(got["verdict"], "FAIL")
        reason = " ".join(got["locked"]["failures"][0]["reasons"])
        self.assertIn("sofa#1", reason)
        self.assertIn("finish", reason)

    def test_a_recolour_at_the_same_brightness_is_invisible_to_edge_recall(self):
        """これが仕上げ検査の存在理由。

        青灰 [100,117,142] を **輝度をほぼ揃えた** 木の茶 [150,105,62]
        (輝度 115.3 -> 105.6) に置き換える。周囲との明暗差はほぼそのままなので
        シルエットのエッジは残り、recall は満点のまま — 色味だけが 40 近く
        動く。仕上げドリフトを足さない限り、この変化はゲートを素通りする。

        (明るいクリーム色に振った上のテストでは、床とのコントラストごと
        消えるので recall も落ちる。仕上げ検査が要るのは、そうならない
        「同じ明るさで色だけ違う」置き換えのほうである。)"""
        rows = self._run(lambda r: _colour_render(r, recolour={SOFA: (150, 105, 62)}))
        self.assertGreater(rows[0]["instances"]["sofa#1"]["finish_drift"], 12.0)
        self.assertGreater(rows[0]["instances"]["sofa#1"]["recall"], 0.9)
        got = evaluate(rows, thresholds(min_locked_recall=0.75,
                                        min_soft_instance_recall=0.45,
                                        max_locked_finish_drift=200.0))
        self.assertEqual(got["verdict"], "PASS")

    def test_the_narrative_says_which_finish_moved(self):
        rows = self._run(lambda r: _colour_render(r, recolour={SOFA: (230, 217, 196)}))
        text = " ".join(rows[0]["narrative"])
        self.assertIn("[FINISH]", text)
        self.assertIn("sofa#1", text)
