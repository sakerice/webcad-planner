import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report import collect_rows, evaluate


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


def _write_gray(path, arr):
    Image.fromarray(arr.astype(np.uint8)).save(path)


def _write_rgb(path, arr):
    Image.fromarray(arr.astype(np.uint8)).save(path)


def _build_camera_move_fixture(root: Path):
    """Two-frame fixture simulating a camera push.

    A large background block is identical across every truth/generated
    frame, so whole-frame recall/precision stay high no matter what happens
    to the small 'sofa' feature -- any FAIL this fixture produces has to come
    from the per-instance check, not a whole-frame side effect.

    The sofa's instance-guide box moves between frames, mirroring a real
    camera move: region A=(10,10)-(30,30) in frame 0, region B=(60,60)-(80,80)
    in frame 1. In frame 1 the sofa is present in truth but absent from the
    generated frame (the vanish this fixture exists to catch). A stale
    frame-0 box would keep inspecting region A for frame 1 too -- where
    frame 1's truth has nothing at all, so an empty-truth box trivially
    scores recall=1.0 and the vanish goes unflagged.
    """
    size = 300
    truth_edge = root / "truth" / "edge"
    truth_instance = root / "truth" / "instance"
    gen = root / "generated"
    truth_edge.mkdir(parents=True)
    truth_instance.mkdir(parents=True)
    gen.mkdir(parents=True)

    (root / "truth" / "instance-legend.json").write_text(json.dumps({
        "instances": [{"id": 1, "color": "#ff0000", "label": "sofa"}]
    }))

    def blank():
        return np.zeros((size, size), dtype=np.uint8)

    def blank_rgb():
        return np.zeros((size, size, 3), dtype=np.uint8)

    # Shared background block, far from both instance regions, identical in
    # every frame.
    bg = blank()
    bg[100:280, 100:280] = 255

    # --- frame 0: sofa at region A, reproduced correctly ---
    t0 = bg.copy(); t0[15:25, 15:25] = 255
    g0 = bg.copy(); g0[15:25, 15:25] = 255
    _write_gray(truth_edge / "0000.png", t0)
    _write_gray(gen / "0000.png", g0)
    inst0 = blank_rgb(); inst0[10:30, 10:30] = (255, 0, 0)
    _write_rgb(truth_instance / "0000.png", inst0)

    # --- frame 1: sofa moved to region B; truth still has it, generated
    # dropped it (the vanish) ---
    t1 = bg.copy(); t1[65:75, 65:75] = 255
    g1 = bg.copy()  # no sofa square: the generator failed to reproduce it
    _write_gray(truth_edge / "0001.png", t1)
    _write_gray(gen / "0001.png", g1)
    inst1 = blank_rgb(); inst1[60:80, 60:80] = (255, 0, 0)
    _write_rgb(truth_instance / "0001.png", inst1)

    return root / "truth", gen


class CollectRowsTest(unittest.TestCase):
    def test_instance_box_follows_the_camera_and_catches_a_frame_local_vanish(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            rows = collect_rows(truth_dir, gen_dir, radius=1)

        self.assertEqual(len(rows), 2)
        frame0, frame1 = rows[0], rows[1]

        # Frame 0's sofa is reproduced correctly under its own (region A) box.
        self.assertGreater(frame0["instances"]["sofa"], 0.9)

        # Frame 1's sofa vanished in the generated frame. Using frame 1's own
        # instance guide (region B) must catch this: recall must be near
        # zero, not near one.
        self.assertLess(frame1["instances"]["sofa"], 0.1)

        # Whole-frame recall/precision stay high in both frames (the shared
        # background dominates the pixel count), so only the per-instance
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
            rows = collect_rows(truth_dir, gen_dir, radius=1, warn=warnings.append)

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
            rows = collect_rows(truth_dir, gen_dir, radius=1, warn=warnings.append)

        self.assertEqual(len(rows), 2)
        for r in rows:
            self.assertEqual(r["instances"], {})
        self.assertEqual(len(warnings), 1)

    def test_malformed_legend_json_fails_clean_instead_of_raising_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            truth_dir, gen_dir = _build_camera_move_fixture(Path(tmp))
            (truth_dir / "instance-legend.json").write_text("{not valid json")
            with self.assertRaises(SystemExit) as ctx:
                collect_rows(truth_dir, gen_dir, radius=1)
            self.assertIn("instance-legend.json", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
