import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import dilate, edge_precision, edge_recall, instance_recall


def blank(h=20, w=20):
    return np.zeros((h, w), dtype=bool)


class DilateTest(unittest.TestCase):
    def test_radius_zero_is_identity(self):
        m = blank(); m[5, 5] = True
        np.testing.assert_array_equal(dilate(m, 0), m)

    def test_radius_one_grows_four_neighbours(self):
        m = blank(); m[5, 5] = True
        out = dilate(m, 1)
        self.assertEqual(out.sum(), 5)
        for y, x in [(5, 5), (4, 5), (6, 5), (5, 4), (5, 6)]:
            self.assertTrue(out[y, x])

    def test_dilation_does_not_wrap_at_border(self):
        m = blank(); m[0, 0] = True
        out = dilate(m, 1)
        self.assertEqual(out.sum(), 3)
        self.assertFalse(out[-1, 0])


class EdgeMetricTest(unittest.TestCase):
    def test_identical_masks_score_one(self):
        m = blank(); m[3:12, 7] = True
        self.assertEqual(edge_recall(m, m, 1), 1.0)
        self.assertEqual(edge_precision(m, m, 1), 1.0)

    def test_one_pixel_shift_is_tolerated_at_radius_one(self):
        t = blank(); t[3:12, 7] = True
        g = blank(); g[3:12, 8] = True
        self.assertEqual(edge_recall(t, g, 1), 1.0)

    def test_missing_structure_drops_recall_but_not_precision(self):
        t = blank(); t[3:12, 7] = True; t[3:12, 15] = True
        g = blank(); g[3:12, 7] = True          # 右の壁が消えた
        self.assertAlmostEqual(edge_recall(t, g, 0), 0.5)
        self.assertEqual(edge_precision(t, g, 0), 1.0)

    def test_invented_structure_drops_precision_but_not_recall(self):
        t = blank(); t[3:12, 7] = True
        g = blank(); g[3:12, 7] = True; g[3:12, 15] = True   # 無い壁が生えた
        self.assertEqual(edge_recall(t, g, 0), 1.0)
        self.assertAlmostEqual(edge_precision(t, g, 0), 0.5)

    def test_empty_generated_scores_zero_recall(self):
        t = blank(); t[3:12, 7] = True
        self.assertEqual(edge_recall(t, blank(), 1), 0.0)

    def test_empty_truth_scores_one_recall(self):
        self.assertEqual(edge_recall(blank(), blank(), 1), 1.0)


class InstanceRecallTest(unittest.TestCase):
    def test_reports_per_instance_and_names_the_missing_one(self):
        t = blank(); t[2:8, 2:8] = True; t[12:18, 12:18] = True
        g = blank(); g[2:8, 2:8] = True                     # sofa は残り table は消えた
        boxes = {"sofa": (2, 2, 8, 8), "table": (12, 12, 18, 18)}
        got = instance_recall(t, g, boxes, radius=0)
        self.assertEqual(got["sofa"], 1.0)
        self.assertEqual(got["table"], 0.0)


if __name__ == "__main__":
    unittest.main()
