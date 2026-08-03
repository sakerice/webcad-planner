import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report import assert_coverage, collect_rows, compare_frame, evaluate


def row(index, recall, precision, instances=None):
    return {"index": index, "recall": recall, "precision": precision,
            "instances": instances or {}}


class EvaluateTest(unittest.TestCase):
    def test_all_above_threshold_passes(self):
        rows = [row(0, 0.97, 0.97), row(1, 0.96, 0.85)]
        got = evaluate(rows, min_recall=0.95, min_precision=0.80)
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["failures"], [])

    def test_low_recall_fails_and_names_the_frame(self):
        rows = [row(0, 0.97, 0.90), row(7, 0.40, 0.90)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.70)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertEqual(len(got["failures"]), 1)
        self.assertEqual(got["failures"][0]["index"], 7)
        self.assertIn("recall", got["failures"][0]["reasons"][0])

    def test_low_precision_fails(self):
        rows = [row(3, 0.99, 0.30)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.70)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("precision", got["failures"][0]["reasons"][0])

    def test_precision_failure_message_describes_what_is_measured(self):
        # The message must not claim precision detects a fabricated hob
        # directly. It measures structure with no counterpart in the truth
        # render of the same camera pose.
        rows = [row(3, 0.99, 0.30)]
        got = evaluate(rows, min_recall=0.90, min_precision=0.70)
        reason = got["failures"][0]["reasons"][0]
        self.assertIn("no counterpart in the truth render", reason)
        self.assertIn("same camera pose", reason)

    def test_missing_instance_is_named_in_the_failure(self):
        # dining_table (0.80) sits strictly between min_precision (0.60) and
        # min_recall (0.95): it only fails if the per-instance loop is gated
        # by min_recall, as the design requires (instance recall measures
        # missingness, the same direction as the frame-level recall check).
        rows = [row(2, 0.99, 0.99, {"sofa": 0.97, "dining_table": 0.80})]
        got = evaluate(rows, min_recall=0.95, min_precision=0.60)
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(got["failures"][0]["reasons"])
        self.assertIn("dining_table", joined)
        self.assertNotIn("sofa", joined)

    def test_empty_rows_fail_rather_than_silently_pass(self):
        got = evaluate([], min_recall=0.90, min_precision=0.70)
        self.assertEqual(got["verdict"], "FAIL")

    def test_recall_only_failure_would_flip_to_pass_if_thresholds_were_swapped(self):
        # min_recall (0.95) is the stricter threshold here. recall=0.85 fails
        # against min_recall but would PASS against min_precision (0.75) --
        # so if evaluate() ever compared recall to the wrong threshold
        # variable, this row's failure would silently disappear.
        rows = [row(0, 0.85, 0.99)]
        got = evaluate(rows, min_recall=0.95, min_precision=0.75)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("recall", got["failures"][0]["reasons"][0])

    def test_precision_only_failure_would_flip_to_pass_if_thresholds_were_swapped(self):
        # Mirror of the above with the thresholds' roles reversed: min_precision
        # (0.95) is now the stricter one. precision=0.85 fails against
        # min_precision but would PASS against min_recall (0.75).
        rows = [row(0, 0.99, 0.85)]
        got = evaluate(rows, min_recall=0.75, min_precision=0.95)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("precision", got["failures"][0]["reasons"][0])


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

    def test_appearance_detail_would_wreck_precision_if_measured_against_the_line_drawing(self):
        """The regression C3 fixes. Scoring the same appearance-only
        generation against the truth LINE DRAWING instead of the truth BASE
        RENDER collapses precision, failing a correct generation."""
        regions = _regions(sofa=(120, 200))
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._dirs(tmp)
            edge_png = truth / "edge" / "0000.png"
            base_png = truth / "base" / "0000.png"
            gen_png = gen / "0000.png"
            _save(edge_png, _line_drawing(regions))
            _save(base_png, _render(regions))
            _save(gen_png, _appearance_upgrade(regions))

            against_base = compare_frame(edge_png, base_png, gen_png, 1, {})
            against_line = compare_frame(edge_png, edge_png, gen_png, 1, {})

        self.assertGreater(against_base["precision"], 0.95)
        self.assertLess(against_line["precision"], 0.6)

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

    def test_half_resolution_generated_frame_is_upscaled_and_still_scores_high(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            notes = []
            rows, expected = collect_rows(truth, gen, radius=2, warn=notes.append)
        self.assertEqual((len(rows), expected), (1, 1))
        self.assertGreater(rows[0]["recall"], 0.9)
        self.assertTrue(any("upscaling" in n for n in notes), notes)

    def test_resize_is_logged_once_per_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 144))
            shutil.copy(truth / "edge" / "0000.png", truth / "edge" / "0001.png")
            shutil.copy(truth / "base" / "0000.png", truth / "base" / "0001.png")
            shutil.copy(gen / "0000.png", gen / "0001.png")
            notes = []
            rows, _ = collect_rows(truth, gen, radius=2, warn=notes.append)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len([n for n in notes if "upscaling" in n]), 1, notes)

    def test_mismatched_aspect_ratio_fails_loudly_instead_of_being_stretched(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth, gen = self._fixture(tmp, (256, 256))
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth, gen, radius=2)
        self.assertIn("aspect ratio mismatch", str(ctx.exception))


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

        result = evaluate(rows, min_recall=0.85, min_precision=0.50)
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


if __name__ == "__main__":
    unittest.main()
