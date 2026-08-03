import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report import assert_coverage, collect_rows, evaluate
from metrics import edge_mask, edge_precision, line_edge_mask


def row(index, recall, precision, instances=None):
    return {"index": index, "recall": recall, "precision": precision,
            "instances": instances or {}}


class EvaluateTest(unittest.TestCase):
    def test_all_above_threshold_passes(self):
        rows = [row(0, 0.97, 0.97), row(1, 0.96, 0.85)]
        got = evaluate(rows, min_recall=0.95, min_precision=0.80, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["failures"], [])

    def test_low_recall_fails_and_names_the_frame(self):
        rows = [row(0, 0.97, 0.90), row(7, 0.40, 0.90)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.70, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertEqual(len(got["failures"]), 1)
        self.assertEqual(got["failures"][0]["index"], 7)
        self.assertIn("recall", got["failures"][0]["reasons"][0])

    def test_low_precision_fails(self):
        rows = [row(3, 0.99, 0.30)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.70, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("precision", got["failures"][0]["reasons"][0])

    def test_precision_failure_message_describes_what_is_measured(self):
        # The message must not claim precision detects a fabricated hob
        # directly. It measures structure with no counterpart in the truth
        # render of the same camera pose.
        rows = [row(3, 0.99, 0.30)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.70, min_instance_recall=0.90)
        reason = got["failures"][0]["reasons"][0]
        self.assertIn("no counterpart in the truth render", reason)
        self.assertIn("same camera pose", reason)

    def test_missing_instance_is_named_in_the_failure(self):
        # dining_table (0.80) sits strictly between min_precision (0.60) and
        # min_instance_recall (0.95): it only fails if the per-instance loop
        # is gated by min_instance_recall, its own dedicated threshold, not by
        # min_recall or min_precision.
        rows = [row(2, 0.99, 0.99, {"sofa": 0.97, "dining_table": 0.80})]
        got = evaluate(rows, min_recall=0.95, min_precision=0.60, min_instance_recall=0.95)
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(got["failures"][0]["reasons"])
        self.assertIn("dining_table", joined)
        self.assertNotIn("sofa", joined)

    def test_instance_regression_is_reported_before_whole_frame_reasons(self):
        # Per-instance recall is the primary signal; whole-frame numbers are
        # coarse secondary context. The failure text must lead with the named
        # instance, not with the whole-frame recall/precision figures.
        rows = [row(2, 0.80, 0.80, {"dining_table": 0.10})]
        got = evaluate(rows, min_recall=0.85, min_precision=0.85, min_instance_recall=0.90)
        reasons = got["failures"][0]["reasons"]
        self.assertIn("dining_table", reasons[0])
        self.assertTrue(any("whole-frame" in r for r in reasons[1:]))

    def test_empty_rows_fail_rather_than_silently_pass(self):
        got = evaluate([], min_recall=0.90, min_precision=0.70, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "FAIL")

    def test_recall_only_failure_would_flip_to_pass_if_thresholds_were_swapped(self):
        # min_recall (0.95) is the stricter threshold here. recall=0.85 fails
        # against min_recall but would PASS against min_precision (0.75) --
        # so if evaluate() ever compared recall to the wrong threshold
        # variable, this row's failure would silently disappear.
        rows = [row(0, 0.85, 0.99)]
        got = evaluate(rows, min_recall=0.95, min_precision=0.75, min_instance_recall=0.95)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("recall", got["failures"][0]["reasons"][0])

    def test_precision_only_failure_would_flip_to_pass_if_thresholds_were_swapped(self):
        # Mirror of the above with the thresholds' roles reversed: min_precision
        # (0.95) is now the stricter one. precision=0.85 fails against
        # min_precision but would PASS against min_recall (0.75).
        rows = [row(0, 0.99, 0.85)]
        got = evaluate(rows, min_recall=0.75, min_precision=0.95, min_instance_recall=0.75)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("precision", got["failures"][0]["reasons"][0])


class UnverifiableInstanceTest(unittest.TestCase):
    """Finding 1 regression at the evaluate() level: metrics.py now reports a
    zero-truth-edge region as None ("unverifiable"), never as a perfect 1.0.
    evaluate() must never conflate the two -- a None must not count toward a
    clean PASS, must be named and counted, and a run that is LARGELY
    unverifiable must not read as clean even though nothing measurable
    failed."""

    def test_a_single_unverifiable_instance_does_not_fail_and_is_named(self):
        # sofa is measured and clean; wall2 could not be measured at all
        # (its truth-side edges are zero, e.g. two same-tone walls meeting).
        # A wrong implementation that reverted to scoring None-cases as 1.0
        # would also PASS here, but would report zero unverifiable instances
        # -- this test's second half (the unverifiable count) is what a
        # reverted implementation would fail.
        rows = [row(0, 0.99, 0.99, {"sofa": 0.97, "wall2": None})]
        got = evaluate(rows, min_recall=0.90, min_precision=0.90, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["unverifiable"]["count"], 1)
        self.assertEqual(got["unverifiable"]["total_checks"], 2)
        self.assertEqual(got["unverifiable"]["frames"],
                         [{"index": 0, "instances": ["wall2"]}])

    def test_unverifiable_instance_is_not_compared_against_the_threshold(self):
        # None must never reach a "score < threshold" comparison (which would
        # raise TypeError in Python) and must never itself appear as a named
        # per-instance regression -- it is a distinct state, not a failing
        # score of 0. A verified instance is included alongside it so this
        # run is not itself majority-unverifiable (that has its own test
        # above) -- this test isolates only "does None crash or get treated
        # as a failing score".
        rows = [row(0, 0.99, 0.99, {"wall2": None, "sofa": 0.97})]
        got = evaluate(rows, min_recall=0.90, min_precision=0.90, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["failures"], [])

    def test_majority_unverifiable_instances_fail_the_whole_run(self):
        # 2 of 3 instance-checks in this run are unverifiable -- too little
        # of the design could actually be checked for this to read as clean,
        # even though the one instance that WAS measured passed cleanly and
        # nothing else in the run measured a failure.
        rows = [row(0, 0.99, 0.99, {"a": None, "b": None, "c": 0.97})]
        got = evaluate(rows, min_recall=0.90, min_precision=0.90, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(r for f in got["failures"] for r in f["reasons"])
        self.assertIn("2 of 3", joined)
        self.assertIn("unverifiable", joined)

    def test_a_few_unverifiable_instances_among_many_do_not_fail_the_run(self):
        # Mirrors the real T91 measurement: 3 of 111 instance-checks
        # (wall#2 on three frames) were unverifiable -- nowhere near a
        # majority, so the run-wide guard above must not fire.
        instances = {f"obj{i}": 0.95 for i in range(8)}
        instances["wall2"] = None
        rows = [row(0, 0.99, 0.99, instances)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.90, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "PASS")

    def test_whole_frame_recall_none_is_reported_not_silently_passed(self):
        # A frame whose truth base render has literally no detectable edge
        # anywhere is a degenerate case distinct from a single unverifiable
        # instance (some instances legitimately cast no edge; an entire real
        # render frame doing so is essentially only possible if the capture
        # itself is broken). It must not silently PASS at 1.0, and unlike a
        # single unverifiable instance this is treated as a run failure --
        # the safer default for something this anomalous.
        rows = [row(0, None, 0.99)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.90, min_instance_recall=0.90)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("unverifiable", got["failures"][0]["reasons"][0])


# ---------------------------------------------------------------------------
# Fixture builders.
#
# The two sides of a real comparison are different KINDS of image and must be
# built as such:
#
#   truth edge/<i>.png  a synthetic line drawing -- white paper, 1px dark
#                       stroke wherever two regions meet. This is exactly what
#                       index.html's makeEdgeDataUrlFromSegmentation emits.
#   truth base/<i>.png  a shaded render -- every region filled with its own
#                       grey level, i.e. an image with real intensity steps.
#   generated/<i>.png   likewise a shaded render (Layer 2 output is
#                       photorealistic, never a line drawing).
#
# Building both sides from the same kind of image is what let three earlier
# rounds of this project ship tests that passed against a broken metric: both
# sides were processed identically wrongly and the ratio survived.
# ---------------------------------------------------------------------------


def _line_drawing(regions: np.ndarray) -> np.ndarray:
    """White paper with a 1px dark stroke on every region boundary."""
    img = np.full(regions.shape, 255, dtype=np.uint8)
    img[:, :-1][regions[:, :-1] != regions[:, 1:]] = 20
    img[:-1, :][regions[:-1, :] != regions[1:, :]] = 20
    return img


def _save(path: Path, arr: np.ndarray):
    Image.fromarray(arr.astype(np.uint8)).save(path)


# Region ids used by the fixtures below.
FIELD, ROOM, SOFA, INVENTED = 0, 1, 2, 3
LEVELS = {FIELD: 30, ROOM: 200, SOFA: 110, INVENTED: 160}

# WALL2 renders at the exact same grey level as ROOM. A boundary between a
# ROOM region and a WALL2 region is a real seam the line drawing marks
# (region ids differ) but that no shaded render can show (same tone on both
# sides) -- the `wall#2` failure mode: recall 0.000 against a pixel-perfect
# reproduction when recall was still measured against the line drawing.
WALL2 = 6
LEVELS[WALL2] = LEVELS[ROOM]

# FENCE is a second, independent furniture-like instance used by the
# per-instance erasure test below -- a distinct id/level from SOFA so the
# two instances can be told apart and erased independently.
FENCE = 7
LEVELS[FENCE] = 140


SOFA_H, SOFA_W = 20, 25


def _regions(size=300, sofa=None, invented=False) -> np.ndarray:
    """Architectural truth: a room block, optionally a sofa inside it,
    optionally a wall the design never had.

    The sofa is deliberately small next to the room outline so that losing it
    moves whole-frame recall only a few points: the per-instance check has to
    be what catches a vanished sofa, not a whole-frame side effect."""
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

    This is the point of C3. A real base render is not a flat paint-by-numbers
    of the region map: it is rendered with materials and lighting, so its edge
    map already carries a rug weave, a daylight falloff, contact shading and so
    on. Modelling the base render as flat would rig this fixture -- every
    appearance detail the generator adds would be un-referenced by
    construction, which is precisely the bug being fixed rather than a test of
    it.

    The rug sits at rows 200:270 / cols 120:170 and the sofa at rows 120:140 /
    cols 200:225, deliberately disjoint: otherwise the rug's own edges would
    mask a vanished sofa and the recall test would pass for the wrong reason.
    """
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


def _build_camera_move_fixture(root: Path):
    """Two-frame fixture simulating a camera push.

    A large room block is identical across every truth/generated frame, so
    whole-frame recall/precision stay high no matter what happens to the small
    'sofa' feature -- any FAIL this fixture produces has to come from the
    per-instance check, not a whole-frame side effect.

    The sofa's instance-guide box moves between frames, mirroring a real
    camera move: region A=(10,10)-(30,35) in frame 0, region B=(60,20)-(80,45)
    in frame 1. In frame 1 the sofa is present in truth but absent from the
    generated frame (the vanish this fixture exists to catch). A stale
    frame-0 box would keep inspecting region A for frame 1 too -- where
    frame 1's truth has nothing at all, so an empty-truth box trivially
    scores recall=1.0 and the vanish goes unflagged.

    Both regions are kept clear of the room block (rows/cols 100..280) so that
    the room's own boundary never lands inside a sofa box -- otherwise the box
    would score a non-zero recall from the wall next door and the vanish would
    look partially reproduced.
    """
    truth = root / "truth"
    (truth / "edge").mkdir(parents=True)
    (truth / "base").mkdir(parents=True)
    (truth / "instance").mkdir(parents=True)
    gen = root / "generated"
    gen.mkdir(parents=True)

    (truth / "instance-legend.json").write_text(json.dumps({
        "version": 2,
        "instances": [{"id": 1, "color": "#ff0000", "label": "sofa"}],
    }))

    def instance_png(y, x):
        arr = np.zeros((300, 300, 3), dtype=np.uint8)
        arr[y:y + SOFA_H, x:x + SOFA_W] = (255, 0, 0)
        return arr

    # --- frame 0: sofa at region A, reproduced correctly ---
    truth0 = _regions(sofa=(10, 10))
    _save(truth / "edge" / "0000.png", _line_drawing(truth0))
    _save(truth / "base" / "0000.png", _render(truth0))
    _save(gen / "0000.png", _appearance_upgrade(truth0))
    _save(truth / "instance" / "0000.png", instance_png(10, 10))

    # --- frame 1: sofa moved to region B; truth still has it, generated
    # dropped it (the vanish) ---
    truth1 = _regions(sofa=(60, 20))
    _save(truth / "edge" / "0001.png", _line_drawing(truth1))
    _save(truth / "base" / "0001.png", _render(truth1))
    _save(gen / "0001.png", _appearance_upgrade(_regions(sofa=None)))
    _save(truth / "instance" / "0001.png", instance_png(60, 20))

    return truth, gen


class LayerPairingTest(unittest.TestCase):
    """The actual Layer 1 / Layer 2 pairing: a line drawing on one side, a
    shaded render on the other."""

    def _dirs(self, tmp):
        truth = Path(tmp) / "truth"
        (truth / "edge").mkdir(parents=True)
        (truth / "base").mkdir(parents=True)
        gen = Path(tmp) / "generated"
        gen.mkdir(parents=True)
        return truth, gen

    def _run(self, truth_regions, generated_render, radius=1):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._dirs(tmp)
            _save(truth / "edge" / "0000.png", _line_drawing(truth_regions))
            _save(truth / "base" / "0000.png", _render(truth_regions))
            _save(gen / "0000.png", generated_render)
            rows, expected = collect_rows(truth, gen, radius=radius)
        self.assertEqual(expected, 1)
        return rows[0]

    def test_appearance_only_upgrade_keeps_both_scores_high(self):
        """A stronger weave, a warmer exposure and a steeper daylight falloff
        are precisely what Layer 2 exists to add. They must not read as
        invented architecture."""
        regions = _regions(sofa=(120, 200))
        got = self._run(regions, _appearance_upgrade(regions))
        self.assertGreater(got["recall"], 0.95)
        self.assertGreater(got["precision"], 0.95)

    def test_precision_against_the_line_drawing_would_still_collapse(self):
        """Guardrail for the precision fix that predates this change (C3):
        scoring an appearance-only generation against the truth LINE DRAWING
        instead of the truth BASE RENDER collapses precision, because Layer
        2's legitimate material/lighting detail (rug weave, daylight
        falloff) has no counterpart in a line drawing.

        compare_frame() no longer accepts a line-drawing reference at all --
        recall was moved onto the same base-render reference in this change
        (see PixelPerfectDifferentResolutionTest for recall's own regression
        guard, which needs a same-tone-boundary fixture that this generic
        `_regions` fixture does not have). This test exercises the
        underlying metrics.py functions directly to keep the historical
        precision guardrail alive now that compare_frame's signature can no
        longer express "reference the line drawing" at all."""
        regions = _regions(sofa=(120, 200))
        line = line_edge_mask(Image.fromarray(_line_drawing(regions)))
        base_edges = edge_mask(Image.fromarray(_render(regions)))
        generated = edge_mask(Image.fromarray(_appearance_upgrade(regions)))

        self.assertGreater(edge_precision(base_edges, generated, 1), 0.95)
        self.assertLess(edge_precision(line, generated, 1), 0.6)

    def test_invented_wall_still_drops_precision(self):
        """Precision must keep its job: a wall the design never had, added by
        the generator, has no counterpart in the base render."""
        regions = _regions(sofa=(120, 200))
        generated = _appearance_upgrade(_regions(sofa=(120, 200), invented=True))
        got = self._run(regions, generated)
        self.assertLess(got["precision"], 0.9)

    def test_vanished_furniture_still_drops_recall(self):
        """Recall must keep its job: designed structure that disappeared."""
        regions = _regions(sofa=(120, 200))
        got = self._run(regions, _appearance_upgrade(_regions(sofa=None)))
        self.assertLess(got["recall"], 0.95)


class ResolutionTest(unittest.TestCase):
    def _fixture(self, tmp, gen_size):
        truth = Path(tmp) / "truth"
        (truth / "edge").mkdir(parents=True)
        (truth / "base").mkdir(parents=True)
        gen = Path(tmp) / "generated"
        gen.mkdir(parents=True)
        regions = np.zeros((288, 512), dtype=np.uint8)
        regions[60:230, 100:400] = ROOM
        regions[120:180, 150:220] = SOFA
        _save(truth / "edge" / "0000.png", _line_drawing(regions))
        _save(truth / "base" / "0000.png", _render(regions))
        shaded = Image.fromarray(_appearance_upgrade(regions))
        shaded.resize(gen_size, Image.BICUBIC).save(gen / "0000.png")
        return truth, gen

    def test_half_resolution_generated_frame_is_matched_by_downscaling_truth_and_still_scores_high(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            notes = []
            rows, expected = collect_rows(truth, gen, radius=2, warn=notes.append)
        self.assertEqual((len(rows), expected), (1, 1))
        self.assertGreater(rows[0]["recall"], 0.9)
        self.assertTrue(any("downscaling" in n for n in notes), notes)

    def test_resize_is_logged_once_per_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            shutil.copy(truth / "edge" / "0000.png", truth / "edge" / "0001.png")
            shutil.copy(truth / "base" / "0000.png", truth / "base" / "0001.png")
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
        """Finding 3 regression: report.py always downscales the truth down
        to the generated frame's size, never the reverse. If the generated
        frame is LARGER than the truth (e.g. the truth's 2560x1440 capture
        actually came out smaller than expected, or Topview's auto-upscale
        was left on), resizing the truth UP would blur it and push real
        edges below edge_mask's threshold -- the same failure mode that
        scored a pixel-perfect generation 0.255-0.752, in mirror image. This
        must be refused with a clear error, not silently upscaled.

        A wrong implementation that resizes unconditionally (no direction
        check) would not raise here at all -- it would return a blurred,
        upscaled truth image and let the run proceed."""
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (1024, 576))   # double the truth's 512x288
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth, gen, radius=2)
        message = str(ctx.exception)
        self.assertIn("1024x576", message)
        self.assertIn("512x288", message)
        self.assertIn("larger than the truth", message)

    def test_the_logged_note_always_matches_what_actually_happened(self):
        """Finding 3's second half: report.py's note text must not just
        unconditionally say "downscaling" regardless of what happened. This
        is already implicitly covered by the tests above (the upscale case
        raises instead of ever reaching the note-printing code at all), but
        this test pins it directly: a genuine downscale is the ONLY case
        that logs a "downscaling" note, and it correctly names both sizes
        involved."""
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))   # half the truth's 512x288
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
        message = str(ctx.exception)
        self.assertIn("only 1 of 2", message)

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
        frame0, frame1 = rows[0], rows[1]

        # Frame 0's sofa is reproduced correctly under its own (region A) box.
        self.assertGreater(frame0["instances"]["sofa"], 0.9)

        # Frame 1's sofa vanished in the generated frame. Using frame 1's own
        # instance guide (region B) must catch this: recall must be near
        # zero, not near one.
        self.assertLess(frame1["instances"]["sofa"], 0.1)

        # Whole-frame recall/precision stay high in both frames (the shared
        # room outline dominates the pixel count), so only the per-instance
        # signal can explain a FAIL below.
        for r in rows:
            self.assertGreater(r["recall"], 0.85)
            self.assertGreater(r["precision"], 0.85)

        result = evaluate(rows, min_recall=0.85, min_precision=0.50, min_instance_recall=0.85)
        self.assertEqual(result["verdict"], "FAIL")
        self.assertEqual(result["failures"][0]["index"], 1)
        self.assertIn("sofa", " ".join(result["failures"][0]["reasons"]))

    def test_missing_instance_guide_for_one_frame_skips_only_that_frame_and_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance" / "0001.png").unlink()
            warnings = []
            rows, _ = collect_rows(truth_dir, gen_dir, radius=1, warn=warnings.append)

        self.assertEqual(len(rows), 2)
        self.assertIn("sofa", rows[0]["instances"])   # frame 0 unaffected
        self.assertEqual(rows[1]["instances"], {})    # frame 1 degraded, not silently "clean"
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
    """C1: a run with instance frames but no usable legend checks no furniture
    at all. It must error, never report PASS."""

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
        # The ledger item: json.JSONDecodeError was the only exception caught,
        # so a legend that parses but is a list produced an AttributeError
        # traceback out of legend.get(...).
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
    """The regression test for both causes fixed in this change, together.

    Cause A: recall's truth reference moved from the synthetic line drawing
    `edge/<index>.png` to the truth base render `base/<index>.png` (the same
    move precision already had). `WALL2` below renders at the exact same
    grey level as `ROOM`; their shared boundary is a real seam the line
    drawing marks (region ids differ) but that no shaded render, however
    perfect, can show (same tone both sides) -- this is the `wall#2` failure
    mode measured on the real render: recall 0.000 against a pixel-perfect
    reproduction, because recall was still checking a boundary nothing could
    ever show. If recall regressed back to referencing the line drawing,
    this fixture's perfect reproduction would score below 1.0, not exactly
    1.0.

    Cause B: the resize direction. This fixture's "generated" frame is the
    truth base render downscaled with LANCZOS to a lower resolution --
    exactly the experiment that was run on the real render (truth base
    renders downscaled to imitate Topview's 720p output and fed back as a
    "perfect generation"). If report.py still upscaled the generated frame
    up to the truth's resolution instead of downscaling the truth down to
    the generated's, the upscale blur would push real edges below
    edge_mask's threshold and recall/precision would fall below 1.0
    (measured on the real data: 0.255-0.752), not read exactly 1.000.
    """

    TRUTH_SIZE = (480, 270)   # (w, h)
    GEN_SIZE = (240, 135)     # half resolution, simulating a 720p-style output

    def _regions(self):
        w, h = self.TRUTH_SIZE
        regions = np.zeros((h, w), dtype=np.uint8)
        regions[40:230, 40:220] = ROOM
        regions[40:230, 220:440] = WALL2   # same render level as ROOM
        regions[100:140, 60:140] = SOFA
        return regions

    def _build(self, root: Path, indices):
        truth = root / "truth"
        (truth / "edge").mkdir(parents=True)
        (truth / "base").mkdir(parents=True)
        gen = root / "generated"
        gen.mkdir(parents=True)

        regions = self._regions()
        base = _render(regions)
        for i in indices:
            name = f"{i:04d}.png"
            _save(truth / "edge" / name, _line_drawing(regions))
            _save(truth / "base" / name, base)
            Image.fromarray(base).resize(self.GEN_SIZE, Image.LANCZOS).save(gen / name)
        return truth, gen

    def test_perfect_generation_at_a_different_resolution_scores_one_on_both_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp), [0, 12, 24])
            notes = []
            rows, expected = collect_rows(truth, gen, radius=0, warn=notes.append)
        self.assertEqual((len(rows), expected), (3, 3))
        for r in rows:
            self.assertEqual(r["recall"], 1.0, r)
            self.assertEqual(r["precision"], 1.0, r)
        self.assertTrue(any("downscaling" in n for n in notes), notes)


class SameToneInstanceIsUnverifiableEndToEndTest(unittest.TestCase):
    """Finding 1's end-to-end regression, through the real collect_rows path
    (not just evaluate() with hand-built rows): an instance whose truth-side
    edges are entirely zero because it meets a same-tone neighbour --
    `wall2` here, mirroring the real `wall#2` measured on T91-ldk-push --
    must score None, never 1.0, even on an otherwise pixel-perfect
    generation. A reverted `_recall_ratio` (i.e. the old `_ratio` behaviour)
    would make this instance read as a perfect, fully-verified 1.0 instead."""

    SIZE = 300

    def _regions(self):
        r = np.zeros((self.SIZE, self.SIZE), dtype=np.uint8)
        r[100:280, 100:280] = ROOM
        # wall2 sits entirely INSIDE the room block, away from the sofa and
        # the rug (rows 200:270, cols 120:170 in _render) -- every side of
        # its footprint borders ROOM, which renders at the identical grey
        # level (WALL2's LEVELS entry equals ROOM's) plus the same
        # column-only daylight gradient on both sides of every seam. So
        # nothing about crossing into/out of wall2 changes the rendered
        # pixel value: this footprint has zero detectable truth edges on
        # any side, mirroring the real wall#2 (an interior wall meeting
        # same-tone surfaces on all sides visible in that frame).
        r[150:200, 190:210] = WALL2
        r[120:140, 150:175] = SOFA
        return r

    def _instance_png(self):
        arr = np.zeros((self.SIZE, self.SIZE, 3), dtype=np.uint8)
        arr[150:200, 190:210] = (0, 0, 255)   # wall2
        arr[120:140, 150:175] = (255, 0, 0)   # sofa
        return arr

    def _build(self, root: Path):
        truth = root / "truth"
        (truth / "edge").mkdir(parents=True)
        (truth / "base").mkdir(parents=True)
        (truth / "instance").mkdir(parents=True)
        gen = root / "generated"
        gen.mkdir(parents=True)

        (truth / "instance-legend.json").write_text(json.dumps({
            "version": 2,
            "instances": [
                {"id": 1, "color": "#0000ff", "label": "wall2"},
                {"id": 2, "color": "#ff0000", "label": "sofa"},
            ],
        }))

        regions = self._regions()
        _save(truth / "edge" / "0000.png", _line_drawing(regions))
        _save(truth / "base" / "0000.png", _render(regions))
        _save(truth / "instance" / "0000.png", self._instance_png())
        # Pixel-perfect generation -- nothing vanished, nothing was invented.
        _save(gen / "0000.png", _appearance_upgrade(regions))
        return truth, gen

    def test_same_tone_instance_scores_none_not_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp))
            rows, expected = collect_rows(truth, gen, radius=1)
        self.assertEqual((len(rows), expected), (1, 1))
        instances = rows[0]["instances"]
        self.assertIsNone(instances["wall2"], instances)
        # The sofa is a real, detectable object and must still score cleanly
        # -- this is not "everything unverifiable", only the same-tone wall.
        self.assertGreater(instances["sofa"], 0.9, instances)

    def test_run_still_passes_and_names_the_unverifiable_instance(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp))
            rows, _ = collect_rows(truth, gen, radius=1)
        result = evaluate(rows, min_recall=0.90, min_precision=0.90, min_instance_recall=0.90)
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(result["unverifiable"]["count"], 1)
        self.assertEqual(result["unverifiable"]["frames"][0]["instances"], ["wall2"])


class InstanceErasureRegressionTest(unittest.TestCase):
    """Erasing one instance's designed structure must crater that instance's
    own recall while every other instance stays high, and evaluate()'s
    failure text must name it -- the measurement behind this change: erasing
    one object's bbox moved whole-frame recall only 1.000 -> 0.942 (six
    points) but that object's own per-instance recall from 1.000 -> 0.173,
    while every other instance stayed at 0.770-0.971. Whole-frame recall
    alone cannot be the primary gate: a legitimate appearance-only
    generation will move it by a similar handful of points, so it cannot
    tell a vanished object from ordinary Layer 2 texture work. Per-instance
    recall separates the two cleanly.
    """

    SIZE = 300

    def _regions(self, fence_present=True):
        r = np.zeros((self.SIZE, self.SIZE), dtype=np.uint8)
        r[100:280, 100:280] = ROOM
        r[120:140, 150:175] = SOFA                     # instance 1
        if fence_present:
            # Instance 2, standing outside the room block (cols 100-280) in
            # the plain FIELD background -- disjoint from the rug (cols
            # 120-170) and the sofa above. Its erasure below must replace it
            # with FIELD, the material actually surrounding it; replacing it
            # with anything else (e.g. ROOM) manufactures a *different*
            # boundary of similar strength instead of removing one.
            r[200:230, 60:90] = FENCE
        return r

    def _instance_png(self):
        arr = np.zeros((self.SIZE, self.SIZE, 3), dtype=np.uint8)
        arr[120:140, 150:175] = (255, 0, 0)   # sofa
        arr[200:230, 60:90] = (0, 255, 0)     # fence
        return arr

    def _build(self, root: Path):
        truth = root / "truth"
        (truth / "edge").mkdir(parents=True)
        (truth / "base").mkdir(parents=True)
        (truth / "instance").mkdir(parents=True)
        gen = root / "generated"
        gen.mkdir(parents=True)

        (truth / "instance-legend.json").write_text(json.dumps({
            "version": 2,
            "instances": [
                {"id": 1, "color": "#ff0000", "label": "sofa"},
                {"id": 2, "color": "#00ff00", "label": "fence"},
            ],
        }))

        regions = self._regions(fence_present=True)
        _save(truth / "edge" / "0000.png", _line_drawing(regions))
        _save(truth / "base" / "0000.png", _render(regions))
        _save(truth / "instance" / "0000.png", self._instance_png())

        # The generated frame is a correct appearance-only upgrade EXCEPT the
        # fence's designed structure has been erased -- replaced by the
        # FIELD background material actually surrounding it, exactly as if
        # the generator dropped it and painted over the gap.
        erased_regions = regions.copy()
        erased_regions[200:230, 60:90] = FIELD
        _save(gen / "0000.png", _appearance_upgrade(erased_regions))

        return truth, gen

    def test_erasing_one_instance_craters_only_that_instances_recall(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp))
            rows, expected = collect_rows(truth, gen, radius=1)
        self.assertEqual((len(rows), expected), (1, 1))
        instances = rows[0]["instances"]

        self.assertLess(instances["fence"], 0.3, instances)
        self.assertGreater(instances["sofa"], 0.7, instances)

        # Whole-frame recall is the coarse guard: it moves, but nowhere near
        # as far as the vanished instance's own recall -- the room outline
        # dominates the pixel count.
        self.assertGreater(rows[0]["recall"], 0.85, rows[0])

    def test_the_erased_instance_is_named_in_the_failure_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._build(Path(tmp))
            rows, _ = collect_rows(truth, gen, radius=1)

        # Thresholds chosen so only the per-instance check can fail this run:
        # whole-frame recall/precision stay well above their floors.
        result = evaluate(rows, min_recall=0.80, min_precision=0.80,
                          min_instance_recall=0.90)
        self.assertEqual(result["verdict"], "FAIL")
        reasons = result["failures"][0]["reasons"]
        self.assertIn("fence", reasons[0])
        self.assertNotIn("sofa", " ".join(reasons))


if __name__ == "__main__":
    unittest.main()
