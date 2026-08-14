"""カテゴリ・ティア判定 (`categories.py`) の単体テスト。

このファイルの各アサーションは「どんな **間違った実装** ならこれを通過して
しまうか」を先に考えて書いてある。過去にこのプロジェクトで4回、フィクスチャ
が対称すぎたせいで誤った実装でも同じ数値が出て、テストが何も検証していな
かったことがある。だから

  - 部分集合であることを見るテストには、「全部返す実装」を落とす下限も置く。
  - 0 を期待するテストには、「locality を無視する実装」なら 0 にならない
    ことを同じフィクスチャで示す対照を置く。
  - 定数を返すだけの実装が通らないよう、同じ関数を別入力で2回叩く。
"""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import categories as cat
from metrics import dilate


def _seg_png(path, arr_rgb):
    Image.fromarray(arr_rgb.astype(np.uint8)).save(path)


def _rgb(hexcolour):
    h = hexcolour.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class CategoryMaskTest(unittest.TestCase):
    def _write(self, tmp, painted):
        arr = np.zeros((20, 30, 3), dtype=np.uint8)
        for hexcolour, (y0, y1, x0, x1) in painted.items():
            arr[y0:y1, x0:x1] = _rgb(hexcolour)
        path = Path(tmp) / "seg.png"
        _seg_png(path, arr)
        return path

    def test_each_legend_colour_lands_in_its_own_category_and_tier(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, {
                "#ff4b4b": (0, 5, 0, 30),      # walls      LOCKED
                "#19c7ff": (5, 8, 0, 30),      # windows    LOCKED
                "#ffc928": (8, 10, 0, 30),     # doors      LOCKED
                "#54c878": (10, 13, 0, 30),    # rooms      LOCKED
                "#d45cff": (13, 16, 0, 30),    # furniture  SOFT
                "#4f8cff": (16, 18, 0, 30),    # fixtures   SOFT
                "#a87948": (18, 20, 0, 30),    # neighbour  CONTEXT
            })
            masks = cat.category_masks(path)

        self.assertEqual(cat.TIER_OF["walls"], cat.LOCKED)
        self.assertEqual(cat.TIER_OF["windows"], cat.LOCKED)
        self.assertEqual(cat.TIER_OF["doors"], cat.LOCKED)
        self.assertEqual(cat.TIER_OF["rooms"], cat.LOCKED)
        self.assertEqual(cat.TIER_OF["roof"], cat.LOCKED)
        self.assertEqual(cat.TIER_OF["furniture"], cat.SOFT)
        self.assertEqual(cat.TIER_OF["fixtures"], cat.SOFT)
        self.assertEqual(cat.TIER_OF["neighbour"], cat.CONTEXT)

        # Each stripe must land in its OWN mask at its OWN rows -- an
        # implementation that swapped two legend colours, or that assigned by
        # nearest colour rather than exact match, would put the rows somewhere
        # else and fail here.
        self.assertEqual(sorted(np.nonzero(masks["walls"].any(axis=1))[0].tolist()),
                         list(range(0, 5)))
        self.assertEqual(sorted(np.nonzero(masks["furniture"].any(axis=1))[0].tolist()),
                         list(range(13, 16)))
        self.assertEqual(sorted(np.nonzero(masks["rooms"].any(axis=1))[0].tolist()),
                         list(range(10, 13)))
        self.assertNotIn(cat.UNATTRIBUTED, masks)

    def test_a_colour_outside_the_legend_is_kept_as_unattributed_not_dropped(self):
        # Plan-specific site-surface colours and antialiasing blends on
        # category borders are real: 0.10-0.20% of every T91 frame. Silently
        # discarding them would make the category areas add up to less than
        # the frame without anyone noticing.
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, {
                "#ff4b4b": (0, 10, 0, 30),
                "#123456": (10, 20, 0, 30),   # not in the legend
            })
            masks = cat.category_masks(path)
        self.assertIn(cat.UNATTRIBUTED, masks)
        self.assertEqual(int(masks[cat.UNATTRIBUTED].sum()), 10 * 30)
        self.assertEqual(cat.TIER_OF[cat.UNATTRIBUTED], cat.CONTEXT)

    def test_downscaling_uses_nearest_and_a_smoothing_resample_would_destroy_it(self):
        """The segmentation guide is flat ID colour, not a photograph.

        The second half is the part that has teeth: it shows the SAME fixture
        under a smoothing resample keeps zero exact-colour pixels, so a
        NEAREST-vs-LANCZOS mix-up could not pass the first half.
        """
        arr = np.zeros((80, 80, 3), dtype=np.uint8)
        arr[:, :] = _rgb("#ff4b4b")
        arr[40:48, :] = _rgb("#54c878")      # an 8px stripe of floor slab
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "seg.png"
            _seg_png(path, arr)
            masks = cat.category_masks(path, target_size=(8, 8))
            self.assertGreater(int(masks["rooms"].sum()), 0)

            blurred = np.asarray(Image.open(path).convert("RGB")
                                 .resize((8, 8), Image.LANCZOS))
            exact = np.all(blurred == np.array(_rgb("#54c878"), dtype=blurred.dtype),
                           axis=-1)
            self.assertEqual(int(exact.sum()), 0)


class SilhouetteTest(unittest.TestCase):
    def test_silhouette_is_the_masks_own_inner_rim_only(self):
        mask = np.zeros((20, 20), dtype=bool)
        mask[5:15, 5:15] = True
        sil = cat.silhouette(mask)

        # never leaves the mask (this is what keeps a neighbour's untouched
        # edge from standing in for the object's own)
        self.assertEqual(int((sil & ~mask).sum()), 0)
        # and is strictly smaller than the mask -- an implementation that just
        # returned `mask` would pass the line above and fail this one
        self.assertLess(int(sil.sum()), int(mask.sum()))
        # exactly the 10x10 block's rim: 10*10 - 8*8 = 36
        self.assertEqual(int(sil.sum()), 36)

    def test_the_frame_border_is_not_a_silhouette(self):
        # A region touching the image edge is cut off by the viewport, not by
        # another category. dilate() does not wrap, so those pixels must not
        # be counted as an outline.
        mask = np.zeros((10, 10), dtype=bool)
        mask[:, :4] = True
        sil = cat.silhouette(mask)
        self.assertEqual(int(sil[:, 0].sum()), 0)
        self.assertEqual(int(sil[:, 3].sum()), 10)


class StructureEdgesTest(unittest.TestCase):
    """LOCKED/SOFT の分母は「ベースレンダのエッジ ∩ カテゴリの輪郭」。

    2つの性質が同時に要る。部分集合であること（写っていないものを要求しない）
    と、内部の陰影を落とすこと（リライトで落ちない）。片方だけを見るテストは
    「全部返す」実装や「空を返す」実装を通してしまう。
    """

    def _fixture(self):
        mask = np.zeros((40, 40), dtype=bool)
        mask[10:30, 10:30] = True
        base_edges = np.zeros((40, 40), dtype=bool)
        base_edges |= dilate(cat.silhouette(mask), 1)   # the region outline
        base_edges[15:25:3, 12:28] = True               # interior shading stripes
        return mask, base_edges

    def test_it_is_always_a_subset_of_the_base_render_edges(self):
        mask, base_edges = self._fixture()
        structure = cat.structure_edges(base_edges, mask)
        self.assertEqual(int((structure & ~base_edges).sum()), 0)

    def test_it_drops_interior_shading_and_keeps_the_outline(self):
        mask, base_edges = self._fixture()
        structure = cat.structure_edges(base_edges, mask)
        interior = np.zeros_like(base_edges)
        interior[15:25:3, 12:28] = True
        # the outline survives ...
        self.assertGreater(int((structure & dilate(cat.silhouette(mask), 1)).sum()), 0)
        # ... and strictly fewer pixels than "every base edge inside the mask"
        # (an implementation returning base_edges & mask would fail here)
        self.assertLess(int(structure.sum()),
                        int((base_edges & dilate(mask, 1)).sum()))
        # the interior stripes' middles are gone
        self.assertEqual(int(structure[18, 14:26].sum()), 0)


class CategoryRecallTest(unittest.TestCase):
    def test_no_truth_structure_is_unverifiable_not_a_perfect_score(self):
        empty = np.zeros((10, 10), dtype=bool)
        anything = np.ones((10, 10), dtype=bool)
        self.assertIsNone(cat.category_recall(empty, anything))
        self.assertIsNone(cat.category_recall(empty, empty))

    def test_recall_measures_what_survived(self):
        structure = np.zeros((10, 10), dtype=bool)
        structure[0, :8] = True
        near = np.zeros((10, 10), dtype=bool)
        near[0, :4] = True
        self.assertAlmostEqual(cat.category_recall(structure, near), 0.5)
        near[0, 4:6] = True
        self.assertAlmostEqual(cat.category_recall(structure, near), 0.75)


class ReplacementSpreadTest(unittest.TestCase):
    """`lost` の定義上、跡地の帯を照合半径と同じにすると contradiction は
    恒等的に 0 になる。実装中に実際にその値を出した（実データ3系列＋合成
    対照2系列、全45フレームで 0.000）。"""

    def test_the_spread_is_strictly_wider_than_the_matching_radius(self):
        for radius in range(0, 6):
            self.assertGreater(cat.replacement_spread(radius), radius, radius)

    def test_using_the_matching_radius_would_make_contradiction_identically_zero(self):
        structure, lost, unexplained, radius = _displaced_outline()
        real = cat.category_contradiction(structure, lost, unexplained, radius)

        # the wrong implementation, spelled out here rather than described:
        wrong = int((unexplained & dilate(lost, radius)).sum()) / int(structure.sum())

        self.assertEqual(wrong, 0.0)
        self.assertGreater(real, 0.0)


def _displaced_outline(radius=2):
    """真実の輪郭が消え、6px ずれた位置に別の輪郭が描かれた状態を作る。

    「壁がすり替わった」の最小形。lost（消えた輪郭）と unexplained（真実に
    対応の無い生成側の構造）が **近いが重ならない** ことが要点で、これが
    contradiction が拾おうとしている状況そのものである。
    """
    shape = (60, 60)
    mask = np.zeros(shape, dtype=bool)
    mask[10:50, 10:30] = True
    base_edges = dilate(cat.silhouette(mask), 1)
    structure = cat.structure_edges(base_edges, mask)

    generated = np.zeros(shape, dtype=bool)
    generated[:, 6:] = base_edges[:, :-6]           # the same outline, 6px right

    near_generated = dilate(generated, radius)
    near_truth = dilate(base_edges, radius)
    lost = cat.lost_structure(structure, near_generated)
    unexplained = generated & ~near_truth
    return structure, lost, unexplained, radius


class ContradictionTest(unittest.TestCase):
    def test_a_displaced_outline_registers_as_replacement(self):
        structure, lost, unexplained, radius = _displaced_outline()
        self.assertGreater(int(lost.sum()), 0)
        self.assertGreater(cat.category_contradiction(structure, lost, unexplained, radius),
                           0.2)

    def test_structure_lost_with_nothing_drawn_in_its_place_is_not_a_contradiction(self):
        """壁が消えただけ（跡地に何も無い）は contradiction ではない。
        そちらは recall が拾う。両者を1つの数字に混ぜないための対照。"""
        shape = (60, 60)
        mask = np.zeros(shape, dtype=bool)
        mask[10:50, 10:30] = True
        base_edges = dilate(cat.silhouette(mask), 1)
        structure = cat.structure_edges(base_edges, mask)
        generated = np.zeros(shape, dtype=bool)       # the generator drew nothing
        lost = cat.lost_structure(structure, dilate(generated, 2))
        unexplained = generated & ~dilate(base_edges, 2)
        self.assertEqual(int(lost.sum()), int(structure.sum()))
        self.assertEqual(cat.category_contradiction(structure, lost, unexplained, 2), 0.0)

    def test_an_addition_far_from_the_lost_outline_does_not_count_as_replacement(self):
        """自由空間に足された物は、同じフレームで別の場所の輪郭が失われて
        いても contradiction に寄与しない。

        これが「新しいエッジを一律に減点する」旧 precision との決定的な差で
        あり、マグカップや人物を罰しないための性質そのもの。locality を捨てた
        実装（`unexplained.sum()/structure.sum()` のような）は同じフィクスチャ
        で 0 にならないので、その対照を並べて示す。
        """
        shape = (60, 60)
        mask = np.zeros(shape, dtype=bool)
        mask[10:50, 5:25] = True
        base_edges = dilate(cat.silhouette(mask), 1)
        structure = cat.structure_edges(base_edges, mask)

        generated = base_edges.copy()
        generated[10:30, :] = False            # top half of the outline lost
        generated[20:30, 45:55] = True         # a mug, 20+ px away from the loss

        radius = 2
        lost = cat.lost_structure(structure, dilate(generated, radius))
        unexplained = generated & ~dilate(base_edges, radius)
        self.assertGreater(int(lost.sum()), 0)
        self.assertGreater(int(unexplained.sum()), 0)

        self.assertEqual(cat.category_contradiction(structure, lost, unexplained, radius),
                         0.0)
        # the locality-blind implementation would have charged for the mug:
        blind = int(unexplained.sum()) / int(structure.sum())
        self.assertGreater(blind, 0.0)

    def test_no_structure_is_unverifiable(self):
        empty = np.zeros((10, 10), dtype=bool)
        self.assertIsNone(cat.category_contradiction(empty, empty, empty, 2))


class AddedStructureTest(unittest.TestCase):
    def test_additions_are_grouped_by_the_truth_category_underneath(self):
        shape = (30, 30)
        masks = {
            "rooms": np.zeros(shape, dtype=bool),
            "furniture": np.zeros(shape, dtype=bool),
        }
        masks["rooms"][:15, :] = True
        masks["furniture"][15:, :] = True

        unexplained = np.zeros(shape, dtype=bool)
        unexplained[2:4, 2:6] = True       # 8 px over the floor slab
        unexplained[20:24, 20:26] = True   # 24 px over furniture

        got = cat.added_structure(unexplained, masks)
        self.assertEqual(got["rooms"]["pixels"], 8)
        self.assertEqual(got["furniture"]["pixels"], 24)
        self.assertAlmostEqual(got["furniture"]["share_of_added"], 24 / 32)
        self.assertEqual(got["rooms"]["zone"], "top-left")
        self.assertEqual(got["furniture"]["zone"], "bottom-right")

    def test_a_frame_with_nothing_added_reports_nothing(self):
        shape = (10, 10)
        masks = {"rooms": np.ones(shape, dtype=bool)}
        self.assertEqual(cat.added_structure(np.zeros(shape, dtype=bool), masks), {})


class ZoneTest(unittest.TestCase):
    def test_zone_names_the_third_of_the_frame_carrying_the_mass(self):
        shape = (30, 30)
        m = np.zeros(shape, dtype=bool)
        m[0:5, 25:30] = True
        self.assertEqual(cat.zone_of(m)[0], "top-right")
        m2 = np.zeros(shape, dtype=bool)
        m2[12:18, 12:18] = True
        self.assertEqual(cat.zone_of(m2)[0], "centre")

    def test_an_empty_mask_has_no_zone(self):
        self.assertEqual(cat.zone_of(np.zeros((9, 9), dtype=bool)), (None, 0.0))


class InstanceRimTest(unittest.TestCase):
    def test_the_rim_never_leaves_the_objects_own_pixels(self):
        """これを外へ広げると、`metrics.instance_recall` が塞いだ抜け穴
        （物体を消しても隣の物体の無傷な縁が radius 以内にあるので満点）が
        そのまま戻る。内側であることは飾りではない。"""
        mask = np.zeros((20, 20), dtype=bool)
        mask[4:16, 4:16] = True
        rim = cat.instance_rim(mask)
        self.assertEqual(int((rim & ~mask).sum()), 0)
        self.assertLess(int(rim.sum()), int(mask.sum()))
        self.assertGreater(int(rim.sum()), 0)

    def test_a_thin_object_is_entirely_rim(self):
        mask = np.zeros((20, 20), dtype=bool)
        mask[10, 4:16] = True
        self.assertEqual(int(cat.instance_rim(mask).sum()), int(mask.sum()))


class InstanceSilhouetteRecallTest(unittest.TestCase):
    def _regions(self):
        """隣り合う2つの物体。物体Aを丸ごと消しても、境界を挟んだ物体Bの
        無傷な縁が身代わりになってはならない。"""
        shape = (40, 40)
        a = np.zeros(shape, dtype=bool)
        a[10:20, 10:20] = True
        b = np.zeros(shape, dtype=bool)
        b[20:30, 10:20] = True      # directly below A, sharing the seam at y=20
        return shape, a, b

    def test_erasing_an_object_craters_only_its_own_score(self):
        shape, a, b = self._regions()
        truth = dilate(cat.silhouette(a), 1) | dilate(cat.silhouette(b), 1)
        generated = dilate(cat.silhouette(b), 1)      # A is gone, B intact

        regions = {
            "A": ((10, 10, 20, 20), a[10:20, 10:20]),
            "B": ((20, 10, 30, 20), b[20:30, 10:20]),
        }
        # A fills its own bbox exactly. instance_rim must still find a rim
        # (it pads the crop) -- otherwise a head-on rectangular wall would
        # silently become "unverifiable" instead of being checked.
        self.assertGreater(int(cat.instance_rim(a[10:20, 10:20]).sum()), 0)
        got = cat.instance_silhouette_recall(truth, generated, regions, radius=2)
        self.assertGreater(got["B"], 0.7, got)

        # A is erased, so its score must collapse. It does NOT reach 0: the
        # shared seam at y=20 is a boundary, and `edge_mask` marks BOTH sides
        # of a boundary by design, so B's surviving outline occupies a couple
        # of pixel rows that belong to A. That residue is measured here
        # (0.375) rather than described, because it is the honest ceiling of
        # what masking can remove.
        self.assertLess(got["A"], 0.5, got)

        # Same fixture, same call, A NOT erased: the score must come back up.
        # Without this second call an implementation that returned a constant
        # (or that always scored the first region low) would pass the two
        # assertions above.
        intact = cat.instance_silhouette_recall(truth, truth, regions, radius=2)
        self.assertGreater(intact["A"], 0.99, intact)
        self.assertGreater(intact["B"], 0.99, intact)

    def test_an_object_with_no_detectable_rim_edge_is_unverifiable_not_perfect(self):
        shape, a, _b = self._regions()
        truth = np.zeros(shape, dtype=bool)           # nothing detectable at all
        generated = np.ones(shape, dtype=bool)
        regions = {"A": ((10, 10, 20, 20), a[10:20, 10:20])}
        got = cat.instance_silhouette_recall(truth, generated, regions, radius=2)
        self.assertIsNone(got["A"])


class DominantCategoryTest(unittest.TestCase):
    def test_an_instance_is_tiered_by_the_category_it_actually_covers(self):
        shape = (20, 20)
        masks = {
            "walls": np.zeros(shape, dtype=bool),
            "furniture": np.zeros(shape, dtype=bool),
        }
        masks["walls"][:, :10] = True
        masks["furniture"][:, 10:] = True

        mostly_wall = np.zeros(shape, dtype=bool)
        mostly_wall[5:10, 2:11] = True          # 8 columns of wall, 1 of furniture
        self.assertEqual(cat.dominant_category(mostly_wall, masks), "walls")

        mostly_furniture = np.zeros(shape, dtype=bool)
        mostly_furniture[5:10, 9:18] = True     # 1 column of wall, 8 of furniture
        self.assertEqual(cat.dominant_category(mostly_furniture, masks), "furniture")

    def test_an_instance_overlapping_nothing_has_no_category(self):
        shape = (10, 10)
        masks = {"walls": np.zeros(shape, dtype=bool)}
        m = np.ones(shape, dtype=bool)
        self.assertIsNone(cat.dominant_category(m, masks))


# ---------------------------------------------------------------------------
# package.json が持ち込む階層表 (Task 9)
#
# アプリ側 (`assets/js/lock-tiers.js`) は設計そのものから階層を決める:
# 開口部と建具はハードロック、家具はソフトロック、周辺環境と注記は計測しない。
# こちらの組み込み分類はセグメンテーション画像の色から推測する **発見的手法**
# でしかない。両者が食い違ったら設計側が正しい。
#
# 語彙について: package.json は 'LOCKED' / 'SOFT' / 'FREE' と大文字で書く。
# このモジュールは前から 'locked' / 'soft' / 'context' を使っている。
# **語彙は1つに畳む**（`tier_for` は常にこのモジュールの定数を返す）。
# 2つのまま流すと `evaluate()` の `info["tier"] == cat.LOCKED` が 'LOCKED' に
# 対して静かに False になり、ロックされた部材が黙って無検査になる。
# ---------------------------------------------------------------------------
class PackageTierTableTest(unittest.TestCase):
    def test_tier_table_from_package_overrides_the_builtin_classification(self):
        # package.json が階層を宣言していれば、それが優先される。
        table = {"#aabbcc": "SOFT"}
        self.assertEqual(cat.TIER_OF["walls"], cat.LOCKED)   # 組み込みは LOCKED
        self.assertEqual(cat.tier_for("#aabbcc", "walls", table), cat.SOFT)

    def test_without_a_tier_table_the_builtin_classification_is_used(self):
        # 既存の PV 実行は package.json を持たない。壊さない。
        self.assertEqual(cat.tier_for("#aabbcc", "walls", None), cat.LOCKED)
        # 定数を返すだけの実装を落とすため、同じ関数を別の入力でもう一度叩く。
        self.assertEqual(cat.tier_for("#aabbcc", "furniture", None), cat.SOFT)
        self.assertEqual(cat.tier_for("#aabbcc", "neighbour", None), cat.CONTEXT)

    def test_an_instance_with_no_category_keeps_falling_back_to_context(self):
        # `dominant_category` はどのカテゴリとも重ならない部材に None を返す。
        # 今日それは CONTEXT (= 判定しない) に落ちる。表が無いときの挙動は
        # 1ミリも動かしてはならない。
        self.assertEqual(cat.tier_for(None, None, None), cat.CONTEXT)
        self.assertEqual(cat.tier_for("#aabbcc", "no-such-category", None), cat.CONTEXT)

    def test_a_colour_the_table_does_not_mention_keeps_its_builtin_tier(self):
        table = {"#aabbcc": "SOFT"}
        self.assertEqual(cat.tier_for("#ddeeff", "walls", table), cat.LOCKED)
        self.assertEqual(cat.tier_for(None, "walls", table), cat.LOCKED)

    def test_the_table_is_matched_without_caring_about_hex_case(self):
        # legend の色は小文字、package.json の色は書き手次第。大文字小文字で
        # 取りこぼすと、階層が黙って組み込み分類へ落ちる。
        self.assertEqual(cat.tier_for("#AABBCC", "walls", {"#aabbcc": "SOFT"}), cat.SOFT)
        self.assertEqual(cat.tier_for("#aabbcc", "walls", {"#AABBCC": "SOFT"}), cat.SOFT)

    def test_free_is_a_tier_the_builtin_classification_can_never_produce(self):
        # FREE は設計側の宣言でしか現れない。組み込み分類は CONTEXT どまり
        # (報告はするが判定しない) で、「一切測らない」とは意味が違う。
        self.assertNotIn(cat.FREE, set(cat.TIER_OF.values()))
        self.assertEqual(cat.tier_for("#aabbcc", "walls", {"#aabbcc": "FREE"}), cat.FREE)

    def test_an_unknown_tier_word_is_an_error_not_a_silent_fallback(self):
        # 綴り違いを組み込み分類へ黙って落とすと、設計が LOCKED と言った部材が
        # 無検査で通り得る。読めない表は読めないと言う。
        with self.assertRaises(ValueError):
            cat.tier_for("#aabbcc", "walls", {"#aabbcc": "HARD-LOCKED"})


class LockTierTableFromPackageTest(unittest.TestCase):
    def _package(self, **over):
        pkg = {"version": 1, "source": "3d",
               "lockTiers": {"#5D9DF2": "LOCKED", "#c6f25d": "SOFT",
                             "#f25de6": "FREE"}}
        pkg.update(over)
        return pkg

    def test_the_table_is_read_and_normalised_to_this_modules_vocabulary(self):
        table = cat.lock_tier_table(self._package())
        self.assertEqual(table, {"#5d9df2": cat.LOCKED, "#c6f25d": cat.SOFT,
                                 "#f25de6": cat.FREE})

    def test_no_package_at_all_means_no_table(self):
        # 既存の PV 実行。組み込み分類へそのまま落ちる。
        self.assertIsNone(cat.lock_tier_table(None))
        self.assertIsNone(cat.lock_tier_table({}))

    def test_a_plan_source_package_has_no_colour_keyed_table(self):
        # 平面図経路は色→階層の表を持たない (`lockTiers: null`)。色を持たない
        # `instances` は載っているが、ガイド画像の色と突き合わせられないので
        # 判定には使えない。
        plan = {"source": "plan", "lockTiers": None,
                "instances": [{"id": "W86", "type": "wall", "floor": 2,
                               "tier": "LOCKED"}]}
        self.assertIsNone(cat.lock_tier_table(plan))
        self.assertEqual(cat.package_source(plan), cat.PACKAGE_SOURCE_PLAN)

    def test_the_source_defaults_to_3d_when_the_package_predates_the_field(self):
        # Task 7 が書き出したパッケージには `source` が無い。すべて3D経路。
        self.assertEqual(cat.package_source({"lockTiers": {}}), cat.PACKAGE_SOURCE_3D)

    def test_a_malformed_tier_word_in_the_package_is_loud(self):
        with self.assertRaises(ValueError):
            cat.lock_tier_table(self._package(lockTiers={"#aabbcc": "sort-of-locked"}))


class UnmeasurableFinishColoursTest(unittest.TestCase):
    """`shadowLift.unliftableColors` は「モデルが本当に見られなかった部材」。"""

    def test_the_unliftable_colours_are_taken_from_the_shadow_lift_record(self):
        pkg = {"shadowLift": {"applied": True, "gamma": 0.7, "floorLuminance": 30,
                              "unliftableColors": ["#E65DF2", "#5df2c5"]}}
        self.assertEqual(cat.unmeasurable_finish_colours(pkg),
                         {"#e65df2", "#5df2c5"})

    def test_a_package_without_a_shadow_lift_record_names_nothing(self):
        self.assertEqual(cat.unmeasurable_finish_colours(None), set())
        self.assertEqual(cat.unmeasurable_finish_colours({}), set())
        self.assertEqual(cat.unmeasurable_finish_colours(
            {"shadowLift": {"applied": False, "unliftableColors": []}}), set())


class LegendColourJoinTest(unittest.TestCase):
    """色→階層の表と、判定器が使う部材名を結ぶのは legend の色である。"""

    def test_names_match_the_names_the_instance_regions_are_keyed_by(self):
        legend = {"version": 2, "instances": [
            {"id": 2, "color": "#C6F25D", "type": "wall", "floor": 1},
            {"id": 9, "color": "#ff0000", "label": "sofa#9", "type": "sofa"},
        ]}
        colours = cat.legend_colours(legend)
        # metrics._legend_name と同じ規則 (label -> "type#id" -> id)。
        # ここで規則を写し取ると、metrics 側が変わった日に階層だけが黙って
        # 別の部材へ付く。
        self.assertEqual(colours, {"wall#2": "#c6f25d", "sofa#9": "#ff0000"})

    def test_a_legend_entry_without_a_colour_is_skipped_not_crashed(self):
        legend = {"instances": [{"id": 1, "type": "wall"},
                                {"id": 2, "color": None, "type": "wall"},
                                {"id": 3, "color": "#abcdef", "type": "wall"}]}
        self.assertEqual(cat.legend_colours(legend), {"wall#3": "#abcdef"})

    def test_no_legend_means_no_colours(self):
        self.assertEqual(cat.legend_colours(None), {})


if __name__ == "__main__":
    unittest.main()
