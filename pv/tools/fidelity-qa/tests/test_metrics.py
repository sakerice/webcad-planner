import sys
import unittest
from pathlib import Path
from io import BytesIO

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import dilate, edge_mask, edge_precision, edge_recall, instance_boxes, instance_recall


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

    def test_radius_two_grows_diamond_shape(self):
        m = blank(); m[10, 10] = True
        out = dilate(m, 2)
        # At radius 2: first iteration grows to 4-neighbors at distance 1,
        # second iteration grows those to their 4-neighbors (including diagonals).
        # Result: center + cruciform at distance 1 + cruciform at distance 2 + diagonals at distance 2.
        self.assertTrue(out[10, 10])  # center
        # Distance 1 (4-neighbors)
        self.assertTrue(out[9, 10]); self.assertTrue(out[11, 10])
        self.assertTrue(out[10, 9]); self.assertTrue(out[10, 11])
        # Distance 2 (4-neighbors of distance-1 points, including diagonals)
        self.assertTrue(out[8, 10]); self.assertTrue(out[12, 10])
        self.assertTrue(out[10, 8]); self.assertTrue(out[10, 12])
        self.assertTrue(out[9, 9]); self.assertTrue(out[9, 11])
        self.assertTrue(out[11, 9]); self.assertTrue(out[11, 11])


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

    def test_empty_generated_scores_one_precision(self):
        t = blank(); t[3:12, 7] = True
        self.assertEqual(edge_precision(t, blank(), 1), 1.0)

    def test_empty_truth_scores_one_precision(self):
        self.assertEqual(edge_precision(blank(), blank(), 1), 1.0)


class InstanceRecallTest(unittest.TestCase):
    def test_reports_per_instance_and_names_the_missing_one(self):
        # Use non-square, asymmetric boxes to ensure test breaks if y/x convention is transposed.
        # sofa box: rows 2-8, cols 3-10 (6 rows x 7 cols)
        # table box: rows 11-18, cols 13-19 (7 rows x 6 cols)
        # If transposed to (x0,y0,x1,y1), the test would use wrong slices and fail.
        t = blank(20, 20); t[2:8, 3:10] = True; t[11:18, 13:19] = True
        g = blank(20, 20); g[2:8, 3:10] = True                     # sofa は残り table は消えた
        boxes = {"sofa": (2, 3, 8, 10), "table": (11, 13, 18, 19)}
        got = instance_recall(t, g, boxes, radius=0)
        self.assertEqual(got["sofa"], 1.0)
        self.assertEqual(got["table"], 0.0)


class EdgeMaskTest(unittest.TestCase):
    def test_edge_mask_detects_hard_edges(self):
        """Synthetic image: white rectangle on black background.
        Edges should be detected at the boundary; flat regions should not."""
        # Create image array directly and wrap in PIL.Image
        arr = np.zeros((40, 40, 3), dtype=np.uint8)
        arr[10:30, 10:30] = [255, 255, 255]  # white rectangle
        img = Image.fromarray(arr)

        mask = edge_mask(img, threshold=32)
        # Edges should be detected at the boundary
        # Interior should mostly be False (flat region)
        interior = mask[15:25, 15:25]
        # Allow some edge pixels due to filtering artifacts, but most interior should be False
        self.assertLess(interior.sum(), 5,
                        "Interior of flat region should have few edge pixels")

    def test_edge_mask_threshold_effect(self):
        """Higher threshold -> fewer edge pixels."""
        arr = np.zeros((40, 40, 3), dtype=np.uint8)
        arr[10:30, 10:30] = [255, 255, 255]
        img = Image.fromarray(arr)

        low_threshold = edge_mask(img, threshold=10)
        high_threshold = edge_mask(img, threshold=200)
        # High threshold should reject weak edges
        self.assertGreaterEqual(low_threshold.sum(), high_threshold.sum())

    def test_edge_mask_accepts_pil_image(self):
        """Verify that edge_mask can accept a PIL.Image directly."""
        arr = np.full((20, 20, 3), 100, dtype=np.uint8)
        img = Image.fromarray(arr)
        mask = edge_mask(img, threshold=32)
        # Should not raise; should return a boolean array
        self.assertEqual(mask.dtype, bool)
        self.assertEqual(mask.shape, (20, 20))


class InstanceBoxesTest(unittest.TestCase):
    def test_instance_boxes_from_synthetic_png(self):
        """Create synthetic instance PNG with two colored rectangles."""
        # Create image with two rectangles: red and blue
        img_array = np.zeros((40, 40, 3), dtype=np.uint8)
        img_array[5:15, 5:15] = [255, 0, 0]    # Red rectangle (rows 5-15, cols 5-15)
        img_array[20:35, 20:35] = [0, 0, 255]  # Blue rectangle (rows 20-35, cols 20-35)

        img = Image.fromarray(img_array)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {
            "instances": [
                {"id": 1, "color": "#FF0000", "label": "sofa"},
                {"id": 2, "color": "#0000FF", "label": "table"},
            ]
        }

        boxes = instance_boxes(buf, legend)
        # Red rectangle should be detected
        self.assertIn("sofa", boxes)
        y0, x0, y1, x1 = boxes["sofa"]
        self.assertEqual((y0, x0, y1, x1), (5, 5, 15, 15))
        # Blue rectangle should be detected
        self.assertIn("table", boxes)
        y0, x0, y1, x1 = boxes["table"]
        self.assertEqual((y0, x0, y1, x1), (20, 20, 35, 35))

    def test_instance_boxes_skips_null_color(self):
        """Malformed entry with null color should be skipped gracefully."""
        img_array = np.zeros((20, 20, 3), dtype=np.uint8)
        img_array[5:15, 5:15] = [255, 0, 0]  # Red rectangle

        img = Image.fromarray(img_array)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {
            "instances": [
                {"id": 1, "color": None, "label": "broken"},
                {"id": 2, "color": "#FF0000", "label": "sofa"},
            ]
        }

        boxes = instance_boxes(buf, legend)
        # Null color should be skipped; only sofa should remain
        self.assertNotIn("broken", boxes)
        self.assertIn("sofa", boxes)

    def test_instance_boxes_skips_invalid_hex_color(self):
        """Malformed hex color (non-hex characters) should be skipped."""
        img_array = np.zeros((20, 20, 3), dtype=np.uint8)
        img_array[5:15, 5:15] = [255, 0, 0]

        img = Image.fromarray(img_array)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {
            "instances": [
                {"id": 1, "color": "#ZZZZZZ", "label": "bad_hex"},
                {"id": 2, "color": "#FF0000", "label": "sofa"},
            ]
        }

        boxes = instance_boxes(buf, legend)
        # Bad hex should be skipped
        self.assertNotIn("bad_hex", boxes)
        self.assertIn("sofa", boxes)

    def test_instance_boxes_uses_id_when_label_missing(self):
        """Fallback to id when label is missing."""
        img_array = np.zeros((20, 20, 3), dtype=np.uint8)
        img_array[5:15, 5:15] = [255, 0, 0]

        img = Image.fromarray(img_array)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {
            "instances": [
                {"id": 42, "color": "#FF0000"},  # No label
            ]
        }

        boxes = instance_boxes(buf, legend)
        # Should use id as name
        self.assertIn("42", boxes)


if __name__ == "__main__":
    unittest.main()
