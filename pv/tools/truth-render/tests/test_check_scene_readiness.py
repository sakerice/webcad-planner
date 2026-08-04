import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_scene_readiness import check_scene_readiness, MIN_PIXELS, COVERAGE_THRESHOLD

WALL_COLOR = (198, 242, 93)
FURNITURE_COLORS = [
    (242, 217, 93),  # id 18 fmp-CabinetD01
    (182, 93, 242),  # id 19 fmp-CabinetD02
    (163, 93, 242),  # id 40 fmp-CabinetD03
    (93, 242, 104),  # id 41 fmp-CabinetD04
    (242, 93, 151),  # id 42 fmp-CabinetD_Sink
]


def hexcolor(rgb):
    return '#%02x%02x%02x' % rgb


def make_legend(furniture_colors, wall_colors=(WALL_COLOR,)):
    instances = []
    next_id = 1
    for c in wall_colors:
        instances.append({'id': next_id, 'color': hexcolor(c), 'type': 'wall', 'source': 'walls'})
        next_id += 1
    for i, c in enumerate(furniture_colors):
        instances.append({
            'id': next_id, 'color': hexcolor(c), 'type': f'fmp-Item{i:02d}', 'source': 'items'})
        next_id += 1
    return {'version': 2, 'instances': instances}


def make_frame(path, present_colors, size=(32, 32), pixels_per_color=64):
    """size x size の画像に、present_colors の各色を pixels_per_color 個ずつ塗った
    フレームを書く。塗る面積を MIN_PIXELS 判定の閾値をまたいで制御できるように、
    pixels_per_color を呼び出し側で明示的に選ばせる。"""
    im = Image.new('RGB', size, (255, 255, 255))
    px = im.load()
    x = 0
    y = 0
    w, h = size
    for color in present_colors:
        for _ in range(pixels_per_color):
            px[x, y] = color
            x += 1
            if x >= w:
                x = 0
                y += 1
    im.save(path)


class CheckSceneReadinessTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_legend(self, legend):
        (self.root / 'instance-legend.json').write_text(json.dumps(legend))

    # --- 対象外なら常に通す --------------------------------------------

    def test_no_legend_file_passes_trivially(self):
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertIn('no instance-legend.json', msg)

    def test_legend_without_glb_furniture_types_passes_trivially(self):
        # 壁・部屋しか無い legend (例: 外観ショット) はチェック対象が無い。
        self.write_legend(make_legend(furniture_colors=[]))
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertIn('nothing to check', msg)

    # --- 実際に判定が必要なケース ----------------------------------------

    def test_furniture_declared_but_instance_dir_missing_fails(self):
        self.write_legend(make_legend(FURNITURE_COLORS))
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('no instance/ frames', msg)

    def test_all_furniture_visible_in_every_frame_passes(self):
        self.write_legend(make_legend(FURNITURE_COLORS))
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        for i in range(3):
            make_frame(inst_dir / f'{i:04d}.png', [WALL_COLOR] + FURNITURE_COLORS)
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertIn('5/5', msg)

    def test_furniture_split_across_frames_still_passes_via_union(self):
        # カメラのパンで、あるフレームでしか写らない家具があっても、
        # 撮影全体を通じて一度でも写っていれば正当な可視性変化として通る。
        self.write_legend(make_legend(FURNITURE_COLORS))
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        make_frame(inst_dir / '0000.png', [WALL_COLOR, FURNITURE_COLORS[0], FURNITURE_COLORS[1]])
        make_frame(inst_dir / '0001.png', [WALL_COLOR, FURNITURE_COLORS[2]])
        make_frame(inst_dir / '0002.png',
                   [WALL_COLOR, FURNITURE_COLORS[3], FURNITURE_COLORS[4]])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)

    def test_furniture_missing_from_every_frame_fails(self):
        # 実際に起きた事故の形そのもの: legend は家具を宣言しているが、
        # instance フレームのどこにも一切描かれていない。
        self.write_legend(make_legend(FURNITURE_COLORS))
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        for i in range(3):
            make_frame(inst_dir / f'{i:04d}.png', [WALL_COLOR])  # 家具なし、壁だけ
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('0/5', msg)
        self.assertIn('fmp-Item00', msg)

    def test_coverage_just_below_threshold_fails(self):
        n = 10
        colors = FURNITURE_COLORS + [(93, 200 - i, 60 + i) for i in range(n - len(FURNITURE_COLORS))]
        self.write_legend(make_legend(colors))
        visible_count = int(len(colors) * COVERAGE_THRESHOLD) - 1  # 閾値未満にする
        self.assertGreaterEqual(visible_count, 0)
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        make_frame(inst_dir / '0000.png', [WALL_COLOR] + colors[:visible_count])
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)

    def test_coverage_at_or_above_threshold_passes(self):
        n = 10
        colors = FURNITURE_COLORS + [(93, 200 - i, 60 + i) for i in range(n - len(FURNITURE_COLORS))]
        self.write_legend(make_legend(colors))
        import math
        visible_count = max(1, math.ceil(len(colors) * COVERAGE_THRESHOLD))
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        make_frame(inst_dir / '0000.png', [WALL_COLOR] + colors[:visible_count])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)

    # --- アンチエイリアスの縁で誤検出しないこと ----------------------------

    def test_a_few_stray_pixels_below_min_pixels_do_not_count_as_present(self):
        self.write_legend(make_legend(FURNITURE_COLORS))
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        # 家具色は MIN_PIXELS 未満しか塗らない(アンチエイリアスの縁を模す)。
        make_frame(inst_dir / '0000.png', [WALL_COLOR], pixels_per_color=64)
        im = Image.open(inst_dir / '0000.png')
        px = im.load()
        for i, c in enumerate(FURNITURE_COLORS):
            px[i, 0] = c  # 1ピクセルだけ、MIN_PIXELS(16)未満
        self.assertLess(1, MIN_PIXELS)
        im.save(inst_dir / '0000.png')
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('0/5', msg)

    # --- 実際に壊れたレンダそのものに対する検証 -----------------------------

    def test_flags_the_real_broken_t91_render(self):
        real_dir = Path(__file__).resolve().parents[3] / 'renders' / 'T91-ldk-push'
        if not real_dir.exists():
            self.skipTest('pv/renders/T91-ldk-push not present in this checkout')
        ok, msg = check_scene_readiness(real_dir)
        self.assertFalse(ok, msg)
        self.assertIn('1/32', msg)


if __name__ == '__main__':
    unittest.main()
