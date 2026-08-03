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
        """Test per-instance recall with asymmetric structure inside boxes.

        Box structure:
        - sofa box: (1, 2, 9, 11) = 8 rows × 9 cols
          Truth structure at rows 1-3, cols 2-4 (top-left corner: 3×3=9 pixels)
          Generated structure at rows 2-3, cols 3-4 (overlaps: 2×2=4 pixels)
          Correct recall: 4/9 = 0.444...
          Transposed recall would be 4/6 = 0.666... (different!)

        - table box: (11, 12, 19, 21) = 8 rows × 9 cols
          Truth structure at rows 11-15, cols 12-14 (left side: 5×3=15 pixels)
          Generated has NO structure (all 0)
          Correct recall: 0/15 = 0.0
          Transposed recall: 0/? (still 0 because both are empty in transposed window)

        Transposing the y/x convention would change sofa's recall from 0.444 to 0.666,
        causing the test to fail.
        """
        t = blank(20, 20)
        g = blank(20, 20)

        # Sofa: asymmetrically positioned structure in top-left of box
        t[1:4, 2:5] = True    # 3 rows × 3 cols = 9 pixels
        g[2:4, 3:5] = True    # 2 rows × 2 cols = 4 pixels (partial overlap)

        # Table: structure on left side of box
        t[11:16, 12:15] = True  # 5 rows × 3 cols = 15 pixels
        # g has no table (all False)

        boxes = {"sofa": (1, 2, 9, 11), "table": (11, 12, 19, 21)}
        got = instance_recall(t, g, boxes, radius=0)

        # sofa recall: 4 overlapping pixels / 9 truth pixels in sofa box
        self.assertAlmostEqual(got["sofa"], 4/9, places=5)
        # table recall: 0 overlapping pixels / 15 truth pixels in table box
        self.assertEqual(got["table"], 0.0)


class EdgeMaskTest(unittest.TestCase):
    def test_edge_mask_detects_hard_edges(self):
        """Synthetic image: white rectangle on black background.
        Edges should be detected at the boundary; flat regions should not.

        Rectangle is at rows 10-30, cols 10-30. The edges at row 10 and row 29
        (top and bottom) should be detected. Interior at row 20 should be flat (few edges).
        """
        arr = np.zeros((40, 40, 3), dtype=np.uint8)
        arr[10:30, 10:30] = [255, 255, 255]  # white rectangle
        img = Image.fromarray(arr)

        mask = edge_mask(img, threshold=32)

        # Boundary rows should have edge pixels detected
        boundary_top = mask[10:12, 10:30]  # Rows at top edge
        boundary_bot = mask[28:30, 10:30]  # Rows at bottom edge
        # At least one boundary row should have significant edge pixels
        self.assertGreater(
            max(boundary_top.sum(), boundary_bot.sum()), 5,
            "Boundary rows should detect edge pixels"
        )

        # Interior row should be flat (few edges)
        interior = mask[20:21, 10:30]
        self.assertLess(interior.sum(), 3,
                        "Interior of flat region should have few edge pixels")

    def test_edge_mask_threshold_effect(self):
        """Higher threshold -> fewer edge pixels (strict monotonicity).

        Create an image with a gradient to produce a range of edge values.
        Low threshold detects weaker edges, high threshold rejects them.
        """
        arr = np.zeros((40, 40, 3), dtype=np.uint8)
        # Create a gradient from black to white that will produce anti-aliased edges
        # with values spanning 0-255 range
        for i in range(40):
            intensity = int(i * 255 / 39)
            arr[i, :] = [intensity, intensity, intensity]
        img = Image.fromarray(arr)

        # Apply FIND_EDGES to the gradient to get intermediate edge values
        low_threshold = edge_mask(img, threshold=50)
        high_threshold = edge_mask(img, threshold=150)

        # Low threshold must find edges
        self.assertGreater(low_threshold.sum(), 0,
                           "Low threshold (50) must detect at least one edge pixel")
        # High threshold must strictly have fewer edges than low threshold
        self.assertLess(high_threshold.sum(), low_threshold.sum(),
                        f"High threshold (150) must reject more edges than low threshold (50): "
                        f"low={low_threshold.sum()}, high={high_threshold.sum()}")

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
        """Create synthetic instance PNG with two colored rectangles.

        Use rectangles with different row and column extents to catch axis-swap bugs.
        Sofa: rows 5-15 (10 rows) × cols 5-20 (15 cols)
        Table: rows 20-30 (10 rows) × cols 20-35 (15 cols)

        If (y0,x0,y1,x1) is transposed to (x0,y0,x1,y1), sofa would be (5,5,20,15),
        which does not match the expected (5,5,15,20), and the test fails.
        """
        img_array = np.zeros((40, 40, 3), dtype=np.uint8)
        # Sofa: rows 5-15, cols 5-20 (non-square: 10 rows × 15 cols)
        img_array[5:15, 5:20] = [255, 0, 0]
        # Table: rows 20-30, cols 20-35 (non-square: 10 rows × 15 cols, but positioned differently)
        img_array[20:30, 20:35] = [0, 0, 255]

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
        # Sofa: (y0, x0, y1, x1) = (5, 5, 15, 20)
        self.assertIn("sofa", boxes)
        y0, x0, y1, x1 = boxes["sofa"]
        self.assertEqual((y0, x0, y1, x1), (5, 5, 15, 20),
                         "Sofa box must be (y0=5, x0=5, y1=15, x1=20)")
        # Table: (y0, x0, y1, x1) = (20, 20, 30, 35)
        self.assertIn("table", boxes)
        y0, x0, y1, x1 = boxes["table"]
        self.assertEqual((y0, x0, y1, x1), (20, 20, 30, 35),
                         "Table box must be (y0=20, x0=20, y1=30, x1=35)")

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
