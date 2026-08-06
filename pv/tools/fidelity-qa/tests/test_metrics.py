import sys
import unittest
from pathlib import Path
from io import BytesIO

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import (
    colour_character,
    dilate,
    edge_mask,
    edge_precision,
    edge_recall,
    frame_colour_grade,
    instance_boxes,
    instance_finish_drift,
    instance_recall,
    instance_region_means,
    instance_regions,
    line_edge_mask,
)


def edge_guide_png(size=40, stroke_cols=(10, 25), stroke_rows=(8,)):
    """An edge guide PNG exactly as index.html emits it: white paper, 1px
    strokes at rgb(20,24,30)."""
    arr = np.full((size, size, 3), 255, dtype=np.uint8)
    for c in stroke_cols:
        arr[:, c] = [20, 24, 30]
    for r in stroke_rows:
        arr[r, :] = [20, 24, 30]
    return Image.fromarray(arr)


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

    def test_empty_truth_is_unverifiable_not_a_perfect_score(self):
        """Finding 1 regression: a region with zero truth edges must report
        as unverifiable (None), never as a perfect 1.0. The object may still
        exist in the design -- it simply casts no detectable edge in this
        particular render (same-tone surfaces meeting, a flat wall face, deep
        shade). Measured on the real T91 render: 3 of 111 instance-boxes
        (`wall#2` on frames 72/84/95) have zero truth edges and, under the old
        `1.0 if total==0` behaviour, scored a perfect recall no matter what
        the generator drew there -- a silent false PASS. A reverted
        implementation returning 1.0 here would pass the old assertion but
        must fail this one."""
        self.assertIsNone(edge_recall(blank(), blank(), 1))
        # Even when the generated side has content, an empty truth reference
        # still cannot be scored -- the score must not depend on what the
        # generated side happens to contain.
        nonempty_generated = blank(); nonempty_generated[3:12, 7] = True
        self.assertIsNone(edge_recall(blank(), nonempty_generated, 1))

    def test_empty_generated_scores_one_precision(self):
        t = blank(); t[3:12, 7] = True
        self.assertEqual(edge_precision(t, blank(), 1), 1.0)

    def test_empty_truth_scores_one_precision(self):
        self.assertEqual(edge_precision(blank(), blank(), 1), 1.0)


def _full_box_region(box):
    """A region whose mask covers the entire bbox (no restriction) -- used by
    tests that want to exercise bbox cropping/axis-order without exercising
    the mask-restriction behaviour itself."""
    y0, x0, y1, x1 = box
    return box, np.ones((y1 - y0, x1 - x0), dtype=bool)


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

        The regions here use a mask that covers the whole bbox (no
        restriction) -- this test is about bbox cropping and axis order, not
        about mask restriction, which gets its own dedicated test below.

        The array is sized 22x22, not 20x20: the table box's x1=21 must fit
        inside the array or numpy silently clips the slice, which would make
        the (fixed-shape) all-True mask below mismatch the (silently
        narrower) truth/generated crop.
        """
        t = blank(22, 22)
        g = blank(22, 22)

        # Sofa: asymmetrically positioned structure in top-left of box
        t[1:4, 2:5] = True    # 3 rows × 3 cols = 9 pixels
        g[2:4, 3:5] = True    # 2 rows × 2 cols = 4 pixels (partial overlap)

        # Table: structure on left side of box
        t[11:16, 12:15] = True  # 5 rows × 3 cols = 15 pixels
        # g has no table (all False)

        regions = {
            "sofa": _full_box_region((1, 2, 9, 11)),
            "table": _full_box_region((11, 12, 19, 21)),
        }
        got = instance_recall(t, g, regions, radius=0)

        # sofa recall: 4 overlapping pixels / 9 truth pixels in sofa box
        self.assertAlmostEqual(got["sofa"], 4/9, places=5)
        # table recall: 0 overlapping pixels / 15 truth pixels in table box
        self.assertEqual(got["table"], 0.0)

    def test_mask_restricts_scoring_to_the_objects_own_pixels_not_the_whole_box(self):
        """Finding 2 regression: instance_recall must score only the pixels
        that belong to the object itself, not everything inside its bounding
        rectangle.

        A 'window' sits in a box that also contains a busy neighbour (a wall
        seam) elsewhere in the same rectangle -- exactly the real-render
        shape of the bug: `window#70` at frame 0000 reached a bbox-based
        recall of 0.968 after being fully erased, because its own edges were
        only ~3% of the edges inside its bounding box; the rest belonged to
        the wall around it.

        Box (1, 2, 9, 11): 8 rows x 9 cols.
          Window's own footprint (the mask): rows 1-3, cols 2-4 (9 px) --
          truth has edges here, generated does NOT (the window was erased).
          A neighbour's edges, OUTSIDE the mask but INSIDE the box: rows 5-7,
          cols 6-9 (12 px) -- truth and generated agree here (untouched).

        A bbox-only implementation scores hit=12 (the surviving neighbour
        edges only, since the window's own edges are erased in generated),
        total=21 (9 window + 12 neighbour) -> recall 12/21 ~= 0.571, i.e. an
        erased window would still look mostly intact. Restricting to the
        window's own mask must score hit=0, total=9 -> recall 0.0: this
        implementation must give the second number, not the first. If
        instance_recall regressed back to using the whole bbox, this
        assertion would see ~0.571 instead of 0.0 and fail.
        """
        t = blank(20, 20)
        g = blank(20, 20)

        # Window's own edges in truth, erased in generated.
        t[1:4, 2:5] = True
        # g leaves this region False -- the window vanished.

        # A neighbouring wall seam: inside the box but outside the window's
        # own mask. Present and correctly reproduced in both truth and
        # generated -- the bug is that this alone used to be enough to make
        # the erased window look recalled.
        t[5:8, 6:10] = True
        g[5:8, 6:10] = True

        box = (1, 2, 9, 11)
        mask = np.zeros((8, 9), dtype=bool)
        mask[0:3, 0:3] = True   # covers only the window's own footprint

        regions = {"window": (box, mask)}
        got = instance_recall(t, g, regions, radius=0)

        self.assertEqual(got["window"], 0.0, got)

    def test_a_bbox_only_implementation_would_have_passed_the_above_at_0_571(self):
        """Companion proof that the fixture above is not vacuous: directly
        confirms what the OLD bbox-only computation would have scored for
        the identical truth/generated arrays, so the 0.0 assertion above is
        known to discriminate against a real (not hypothetical) prior
        behaviour rather than an number nobody would ever have produced."""
        t = blank(20, 20)
        g = blank(20, 20)
        t[1:4, 2:5] = True
        t[5:8, 6:10] = True
        g[5:8, 6:10] = True

        box = (1, 2, 9, 11)
        bbox_only_region = _full_box_region(box)
        got = instance_recall(t, g, {"window": bbox_only_region}, radius=0)
        self.assertAlmostEqual(got["window"], 12 / 21, places=5)

    def test_a_neighbours_untouched_edge_cannot_stand_in_for_the_erased_object(self):
        """Second-order dilution regression, found while re-measuring after
        the mask fix above: masking only the TRUTH side is not enough for an
        object whose own edge is a SHARED boundary with a stationary
        neighbour -- which is what a wall or room's own silhouette usually
        is. `edge_mask` marks BOTH sides of every intensity transition, so
        the object's own boundary pixel sits immediately next to the
        neighbour's boundary pixel on the other side of the very same seam.
        If only truth is restricted to the object's mask while generated is
        left unmasked, erasing the object's own edge pixels still leaves the
        neighbour's untouched pixel one step away, and any radius >= 1
        dilation lets that untouched neighbour edge "stand in" for the
        vanished object.

        Measured on the real T91 render: erasing `wall#6` entirely (its own
        edges only, mask-restricted on the truth side only) scored recall
        0.0 at radius=0 but rebounded to 0.968 at radius=1 and 1.000 at
        radius=2 -- the exact loophole this test pins in miniature.

        Object's own footprint (the mask): rows 1-3, cols 2-4 -- erased in
        generated. Neighbour's own edge, one column outside the mask (col 5,
        the far side of the very same physical seam): present and untouched
        in both truth and generated. At radius=1, a truth-only mask lets
        that neighbour pixel dilate one step leftward into the mask's own
        column 4 and register as a "hit" for the erased object.
        """
        t = blank(20, 20)
        g = blank(20, 20)

        t[1:4, 2:5] = True     # the object's own edge (its footprint == the mask)
        # g leaves rows1-3, cols2-4 False -- the object's own edge is erased.

        t[1:4, 5] = True       # the neighbour's edge, one column past the mask
        g[1:4, 5] = True       # untouched -- this object was never erased

        box = (1, 2, 9, 11)
        mask = np.zeros((8, 9), dtype=bool)
        mask[0:3, 0:3] = True  # the object's own footprint only (cols 2-4 -> offset 0-2)

        regions = {"wall": (box, mask)}
        got = instance_recall(t, g, regions, radius=1)
        self.assertEqual(got["wall"], 0.0, got)

    def test_masking_only_truth_would_have_let_the_neighbour_rescue_the_score(self):
        """Companion proof: confirms what a truth-only mask (generated left
        as the full bbox, unmasked) would have scored for the identical
        fixture -- 3 of the object's own 9 truth-edge pixels (column 4,
        rows 1-3) falsely register as recalled because the neighbour's
        untouched edge one column over dilates into them at radius=1."""
        t = blank(20, 20)
        g = blank(20, 20)
        t[1:4, 2:5] = True
        t[1:4, 5] = True
        g[1:4, 5] = True

        box = (1, 2, 9, 11)
        y0, x0, y1, x1 = box
        mask = np.zeros((y1 - y0, x1 - x0), dtype=bool)
        mask[0:3, 0:3] = True

        truth_masked_only = t[y0:y1, x0:x1] & mask
        generated_unmasked = g[y0:y1, x0:x1]  # the old (insufficient) design
        self.assertAlmostEqual(edge_recall(truth_masked_only, generated_unmasked, 1),
                               3 / 9, places=5)


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

        Two vertical steps of different contrast: a weak one (40 levels) and a
        strong one (150 levels). A low threshold must find both, a high
        threshold only the strong one -- and the weak step must be the part
        that disappears, not an arbitrary subset.
        """
        arr = np.zeros((40, 60, 3), dtype=np.uint8)
        arr[:, :20] = 20            # |  step of 40 at col 20
        arr[:, 20:40] = 60          # |  step of 150 at col 40
        arr[:, 40:] = 210
        img = Image.fromarray(arr)

        low_threshold = edge_mask(img, threshold=30)
        high_threshold = edge_mask(img, threshold=80)

        self.assertGreater(low_threshold.sum(), 0,
                           "Low threshold (30) must detect at least one edge pixel")
        self.assertLess(high_threshold.sum(), low_threshold.sum(),
                        f"High threshold (80) must reject more edges than low threshold (30): "
                        f"low={low_threshold.sum()}, high={high_threshold.sum()}")
        # The weak step is the one that must vanish, and the strong one must survive.
        self.assertTrue(low_threshold[:, 19].all() and low_threshold[:, 20].all())
        self.assertFalse(high_threshold[:, 19].any() or high_threshold[:, 20].any())
        self.assertTrue(high_threshold[:, 39].all() and high_threshold[:, 40].all())

    def test_edge_mask_marks_both_sides_of_a_transition(self):
        """The operator must mark the pixels on BOTH sides of an intensity
        step. PIL's FIND_EDGES does not: on a 1px dark line it leaves the line
        itself False and fires only on the two flanking columns, which is what
        made a pixel-perfect reproduction score 0.0 at radius 0."""
        arr = np.full((20, 20, 3), 255, dtype=np.uint8)
        arr[:, 10] = [20, 24, 30]        # the stroke index.html actually draws
        mask = edge_mask(Image.fromarray(arr), threshold=32)
        np.testing.assert_array_equal(np.nonzero(mask[5])[0], np.array([9, 10, 11]))

    def test_edge_mask_does_not_invent_edges_on_a_uniform_image(self):
        """FIND_EDGES fires along the outermost 1px border of any image,
        including a perfectly uniform one. Those are pure artefacts and they
        counted towards both metrics."""
        arr = np.full((20, 20, 3), 180, dtype=np.uint8)
        self.assertEqual(edge_mask(Image.fromarray(arr), threshold=32).sum(), 0)

    def test_edge_mask_accepts_pil_image(self):
        """Verify that edge_mask can accept a PIL.Image directly."""
        arr = np.full((20, 20, 3), 100, dtype=np.uint8)
        img = Image.fromarray(arr)
        mask = edge_mask(img, threshold=32)
        # Should not raise; should return a boolean array
        self.assertEqual(mask.dtype, bool)
        self.assertEqual(mask.shape, (20, 20))


class LineEdgeMaskTest(unittest.TestCase):
    def test_dark_stroke_is_the_mask_not_its_flanks(self):
        img = edge_guide_png()
        mask = line_edge_mask(img)
        np.testing.assert_array_equal(np.nonzero(mask[5])[0], np.array([10, 25]))
        self.assertTrue(mask[8].all())

    def test_pixel_perfect_reproduction_scores_one_at_radius_zero(self):
        """I6. The truth side is an edge-guide line drawing; the generated
        side is an image the generator produced. When the generated image
        reproduces the guide pixel for pixel, recall must be 1.0 with NO
        neighbourhood tolerance at all.

        Before the fix the truth side re-derived edges from the line drawing
        with FIND_EDGES, landing on the two columns flanking each stroke while
        the stroke column itself read False. Truth (stroke) and generated
        (flanks) were then disjoint and this scored 0.0, recovering only at
        radius >= 1 -- i.e. the radius was silently papering over a defect in
        the mask, not tolerating real sub-pixel drift.
        """
        img = edge_guide_png(stroke_rows=())
        truth = line_edge_mask(img)
        generated = edge_mask(img)
        # Guard against the symmetric-fixture trap: scoring 1.0 must not come
        # from both sides being processed by the same operator into the same
        # mask. They are different kinds of image and are read differently.
        self.assertFalse(np.array_equal(truth, generated),
                         "truth and generated must not reduce to an identical mask")
        self.assertEqual(edge_recall(truth, generated, 0), 1.0)

    def test_a_stroke_that_moved_is_still_caught_at_radius_zero(self):
        """The mirror of the above: scoring 1.0 must come from the structure
        matching, not from the mask being permissive. A guide whose strokes
        the generator shifted by 4px must NOT score 1.0."""
        truth = line_edge_mask(edge_guide_png(stroke_cols=(10, 25), stroke_rows=()))
        generated = edge_mask(edge_guide_png(stroke_cols=(14, 29), stroke_rows=()))
        self.assertLess(edge_recall(truth, generated, 0), 0.6)


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

    def test_instance_boxes_names_by_type_when_label_missing(self):
        """The legend index.html actually writes (aiInstanceSummary) has no
        "label" field at all -- the member kind is in "type". Falling back
        straight to the bare id would make every failure read "instance '7'",
        which does not name which piece of furniture vanished."""
        img_array = np.zeros((20, 20, 3), dtype=np.uint8)
        img_array[5:15, 5:15] = [255, 0, 0]

        img = Image.fromarray(img_array)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {"instances": [{"id": 7, "color": "#FF0000", "type": "fmp-Sofa02"}]}
        boxes = instance_boxes(buf, legend)
        self.assertIn("fmp-Sofa02#7", boxes)


class InstanceRegionsTest(unittest.TestCase):
    """instance_regions() is what instance_recall() actually consumes: bbox
    AND the object's own pixel mask, cropped to the bbox. The mask must be
    exactly the object's own footprint, not the whole box -- an L-shaped
    (non-rectangular) object is used here specifically because a rectangle
    fixture cannot tell "mask == bbox interior" apart from "mask == object's
    real shape"; both would look identical for a filled rectangle."""

    def test_mask_matches_the_objects_own_shape_not_the_bbox_interior(self):
        img_array = np.zeros((20, 20, 3), dtype=np.uint8)
        # An L-shaped instance: bbox is rows 5-15, cols 5-15 (10x10), but the
        # object only occupies the top row-band and the left col-band of
        # that box -- an actual rectangle fixture would make "mask covers
        # the whole bbox" indistinguishable from "mask covers the object".
        img_array[5:8, 5:15] = [255, 0, 0]     # top band of the L
        img_array[5:15, 5:8] = [255, 0, 0]     # left band of the L

        img = Image.fromarray(img_array)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {"instances": [{"id": 1, "color": "#FF0000", "label": "bracket"}]}
        regions = instance_regions(buf, legend)

        self.assertIn("bracket", regions)
        (y0, x0, y1, x1), mask = regions["bracket"]
        self.assertEqual((y0, x0, y1, x1), (5, 5, 15, 15))
        self.assertEqual(mask.shape, (10, 10))

        # The mask must be True on the L and False in the box's empty corner
        # (bottom-right of the bbox, rows 8-15 / cols 8-15 in original
        # coordinates -- rows 3-10 / cols 3-10 within the crop).
        self.assertTrue(mask[0:3, :].all())     # top band
        self.assertTrue(mask[:, 0:3].all())     # left band
        self.assertFalse(mask[5:, 5:].any())    # empty corner of the L's bbox

        # And the mask must have strictly fewer True pixels than the full
        # bbox -- otherwise this fixture would not discriminate a regression
        # back to "mask == bbox interior" at all.
        self.assertLess(int(mask.sum()), mask.size)


class InstanceBoxesResizeTest(unittest.TestCase):
    """report.py now scores recall/precision at the generated frame's own
    resolution rather than the truth's (the truth base render is downscaled
    to match). The instance guide has to follow onto that same grid, and it
    must be resized with NEAREST -- a smoothing filter blends the flat
    per-object ID colour into values that appear nowhere in the legend.

    The fixture below is chosen so this actually discriminates: an 8px-tall
    coloured stripe downscaled 10x keeps exact-colour pixels under NEAREST
    but is fully destroyed (zero exact-colour pixels) under LANCZOS,
    BILINEAR or BOX alike, measured directly in
    test_a_smoothing_resample_would_have_destroyed_the_colour below. A
    fixture where every filter happens to survive the resize would not pin
    the NEAREST choice at all.
    """

    SIZE = 300
    TARGET_SIZE = (30, 30)   # exact 10x downscale
    STRIPE = ((100, 108), (100, 260))   # (row_range, col_range): 8px tall

    def _stripe_array(self):
        arr = np.zeros((self.SIZE, self.SIZE, 3), dtype=np.uint8)
        (r0, r1), (c0, c1) = self.STRIPE
        arr[r0:r1, c0:c1] = (255, 0, 0)
        return arr

    def test_downscaling_instance_guide_with_nearest_preserves_id_colours(self):
        img = Image.fromarray(self._stripe_array())
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        legend = {"instances": [{"id": 1, "color": "#ff0000", "label": "rail"}]}
        boxes = instance_boxes(buf, legend, target_size=self.TARGET_SIZE)

        self.assertIn("rail", boxes)
        y0, x0, y1, x1 = boxes["rail"]
        self.assertGreater(y1, y0)
        self.assertGreater(x1, x0)
        self.assertLessEqual(y1, self.TARGET_SIZE[1])
        self.assertLessEqual(x1, self.TARGET_SIZE[0])

    def test_a_smoothing_resample_would_have_destroyed_the_colour(self):
        """Companion proof that the fixture above is not vacuous: directly
        confirms LANCZOS, BILINEAR and BOX all find zero exact-colour pixels
        at this stripe height and downscale factor, so a hypothetical
        regression from NEAREST to any of them would make instance_boxes
        miss the object entirely rather than merely shrink its box."""
        img = Image.fromarray(self._stripe_array())
        for resample in (Image.LANCZOS, Image.BILINEAR, Image.BOX):
            out = img.resize(self.TARGET_SIZE, resample)
            arr = np.asarray(out)
            exact = np.all(arr == np.array([255, 0, 0]), axis=-1)
            self.assertEqual(exact.sum(), 0, resample)


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# 仕上げ(色味)ドリフト
# ---------------------------------------------------------------------------
#
# フィクスチャの作り方の注意: 3つの部材は **色相も明度も互いに違う** ように
# する。すべて同じ色にすると、マスクを無視して画面全体の平均を取る実装でも
# 同じ数値が出てしまい、テストが何も検証しない。同じ理由で、階調のグラデー
# ションを乗せて「部材の中も一様ではない」状態にしてある。

FINISH_SIZE = 60
FINISH_OBJECTS = {
    # name: (slice, truth colour) — 色相も明るさも別物にする
    "stair#1": ((slice(5, 25), slice(5, 25)), (100, 117, 142)),   # 青灰
    "door#2": ((slice(30, 50), slice(5, 25)), (150, 150, 150)),   # 無彩色の灰
    "sofa#3": ((slice(5, 25), slice(30, 55)), (60, 130, 70)),     # 緑
}
FINISH_LEGEND = {"version": 2, "instances": [
    {"id": 1, "color": "#ff0000", "label": "stair#1"},
    {"id": 2, "color": "#00ff00", "label": "door#2"},
    {"id": 3, "color": "#0000ff", "label": "sofa#3"},
]}
FINISH_GUIDE_COLOURS = {"stair#1": (255, 0, 0), "door#2": (0, 255, 0), "sofa#3": (0, 0, 255)}


def finish_guide_png():
    arr = np.full((FINISH_SIZE, FINISH_SIZE, 3), 255, dtype=np.uint8)
    for name, (box, _colour) in FINISH_OBJECTS.items():
        arr[box] = FINISH_GUIDE_COLOURS[name]
    buf = BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    buf.seek(0)
    return buf


def finish_render(overrides=None):
    """部材ごとに色を持ち、面内にも階調がある「レンダ」。"""
    arr = np.full((FINISH_SIZE, FINISH_SIZE, 3), 40, dtype=np.int16)
    colours = {name: (overrides or {}).get(name, colour)
               for name, (_box, colour) in FINISH_OBJECTS.items()}
    shade = np.linspace(-12, 12, FINISH_SIZE).astype(np.int16)
    for name, (box, _colour) in FINISH_OBJECTS.items():
        arr[box] = colours[name]
    arr += np.broadcast_to(shade[None, :, None], arr.shape).astype(np.int16)
    return np.clip(arr, 0, 255).astype(np.uint8)


def finish_regions():
    return instance_regions(finish_guide_png(), FINISH_LEGEND)


class ColourCharacterTest(unittest.TestCase):
    def test_a_grey_of_any_brightness_has_the_same_colour_character(self):
        np.testing.assert_allclose(colour_character(np.array([10.0, 10.0, 10.0])),
                                   colour_character(np.array([200.0, 200.0, 200.0])))

    def test_pure_black_is_undefined_not_zero(self):
        """真っ黒に色味は無い。0 を返すと「完全一致」と見分けが付かなくなる。"""
        self.assertIsNone(colour_character(np.array([0.0, 0.0, 0.0])))


class FinishDriftTest(unittest.TestCase):
    def test_identical_frames_have_no_drift(self):
        regions = finish_regions()
        truth = finish_render()
        got = instance_finish_drift(truth, truth.copy(), regions)
        self.assertEqual(sorted(got), ["door#2", "sofa#3", "stair#1"])
        for name, value in got.items():
            self.assertAlmostEqual(value, 0.0, places=9, msg=name)

    def test_a_uniformly_brighter_frame_is_not_a_finish_change(self):
        """この層の要求そのもの: 生成側が正当に明るいだけで仕上げが変わった
        ことにしてはならない。平均 RGB を素で引き算する実装はここで落ちる
        (実測: 素の L1 は stair#1 で 47.9 になる)。"""
        regions = finish_regions()
        truth = finish_render()
        brighter = np.clip(truth.astype(np.float64) * 1.35, 0, 255).astype(np.uint8)
        for name, value in instance_finish_drift(truth, brighter, regions).items():
            self.assertLess(value, 0.5, msg=f"{name} drifted on brightness alone")

    def test_a_darker_frame_is_not_a_finish_change_either(self):
        regions = finish_regions()
        truth = finish_render()
        darker = (truth.astype(np.float64) * 0.5).astype(np.uint8)
        for name, value in instance_finish_drift(truth, darker, regions).items():
            self.assertLess(value, 0.5, msg=name)

    def test_one_object_changing_finish_is_named_and_the_others_are_not(self):
        """青灰色の階段がクリーム色の木に化けたケース。マスクを使わず bbox や
        画面全体で平均を取る実装は、隣の部材まで巻き添えにするか、逆に薄まって
        検出できなくなる。"""
        regions = finish_regions()
        truth = finish_render()
        generated = finish_render({"stair#1": (230, 217, 196)})
        got = instance_finish_drift(truth, generated, regions)
        self.assertGreater(got["stair#1"], 10.0)
        self.assertLess(got["door#2"], 0.5)
        self.assertLess(got["sofa#3"], 0.5)

    def test_a_black_louvre_turning_brown_is_caught(self):
        regions = finish_regions()
        truth = finish_render({"stair#1": (2, 3, 4)})
        generated = finish_render({"stair#1": (60, 40, 30)})
        self.assertGreater(instance_finish_drift(truth, generated, regions)["stair#1"], 20.0)

    def test_a_totally_black_region_is_unverifiable_not_perfect(self):
        """色味の定義できない領域を 0.0 (=完全一致) と報告すると、消し飛んだ
        部材が満点で通ってしまう。"""
        regions = finish_regions()
        black = np.zeros((FINISH_SIZE, FINISH_SIZE, 3), dtype=np.uint8)
        got = instance_finish_drift(black, finish_render(), regions)
        self.assertIsNone(got["stair#1"])
        self.assertIsNone(got["door#2"])

    def test_mismatched_grids_are_refused_rather_than_silently_compared(self):
        regions = finish_regions()
        smaller = finish_render()[:30, :30]
        with self.assertRaises(ValueError):
            instance_finish_drift(finish_render(), smaller, regions)

    def test_region_means_come_from_the_object_pixels_not_the_bounding_box(self):
        means = instance_region_means(finish_render(), finish_regions())
        # 階調ぶんは動くが、緑の部材の平均は緑のまま(隣の灰色は混ざらない)
        r, g, b = means["sofa#3"]
        self.assertGreater(g, r + 40)
        self.assertGreater(g, b + 40)

    def test_neutralising_the_grade_removes_a_frame_wide_colour_cast(self):
        """フレーム全体に暖色を掛けただけの生成。素の指標は全部材を等しく
        持ち上げるが、grade を打ち消すと消える — 「1つの原因が全部材ぶん
        報告されている」のを読み手が見分けるための診断値。"""
        regions = finish_regions()
        truth = finish_render()
        warm = np.clip(truth.astype(np.float64) * np.array([1.25, 1.0, 0.8]),
                       0, 255).astype(np.uint8)
        plain = instance_finish_drift(truth, warm, regions)
        ungraded = instance_finish_drift(truth, warm, regions, neutralise_grade=True)
        for name in regions:
            self.assertGreater(plain[name], 3.0, msg=name)
            self.assertLess(ungraded[name], plain[name] / 2.0, msg=name)

    def test_frame_colour_grade_reports_the_shared_shift(self):
        truth = finish_render()
        warm = np.clip(truth.astype(np.float64) * np.array([1.25, 1.0, 0.8]),
                       0, 255).astype(np.uint8)
        self.assertGreater(frame_colour_grade(truth, warm), 3.0)
        self.assertAlmostEqual(frame_colour_grade(truth, truth.copy()), 0.0, places=9)

    def test_the_scale_is_the_one_the_reference_table_uses(self):
        """報告に載る参照値 (lattice-screen#35 = 69.5 など) と同じ ×100 スケール。
        0..2 の生値で返す実装に変わると、運用側が閾値を 100 倍間違える。"""
        regions = finish_regions()
        truth = finish_render({"stair#1": (255, 0, 0)})
        generated = finish_render({"stair#1": (0, 0, 255)})
        # 純赤 -> 純青 は色味 L1 で 2.0、×100 で 200。周囲の階調ぶん少し下がる。
        self.assertGreater(instance_finish_drift(truth, generated, regions)["stair#1"], 150.0)
