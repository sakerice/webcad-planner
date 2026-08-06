import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_scene_readiness import (
    check_scene_readiness,
    FURNITURE_MASS_THRESHOLD,
    EARLY_WINDOW_FRACTION,
)

BACKGROUND = (255, 255, 255)
WALL_COLOR = (198, 242, 93)
ROOM_COLOR = (242, 93, 208)
FURNITURE_COLORS = [
    (242, 217, 93),  # id 18 fmp-CabinetD01
    (182, 93, 242),  # id 19 fmp-CabinetD02
    (163, 93, 242),  # id 40 fmp-CabinetD03
]
SIZE = (20, 20)          # 400px total -> 1px == 0.25%, comfortably finer than our 5% threshold
TOTAL_PX = SIZE[0] * SIZE[1]


def hexcolor(rgb):
    return '#%02x%02x%02x' % rgb


def make_legend(furniture_colors, non_furniture_colors=(WALL_COLOR, ROOM_COLOR)):
    instances = []
    next_id = 1
    for c in non_furniture_colors:
        instances.append({'id': next_id, 'color': hexcolor(c), 'type': 'wall', 'source': 'walls'})
        next_id += 1
    for i, c in enumerate(furniture_colors):
        instances.append({
            'id': next_id, 'color': hexcolor(c), 'type': f'fmp-Item{i:02d}', 'source': 'items'})
        next_id += 1
    return {'version': 2, 'instances': instances}


def make_frame(path, patches, size=SIZE, background=BACKGROUND):
    """size の画像に background を敷き、patches = [(color, pixel_count), ...] を
    順番に塗った上書きのないフレームを書く。pixel_count を呼び出し側で明示的に
    選ばせることで、結果の家具面積比を厳密にコントロールできる。"""
    im = Image.new('RGB', size, background)
    px = im.load()
    w, h = size
    x = y = 0
    for color, count in patches:
        for _ in range(count):
            assert y < h, 'test fixture ran out of room -- increase SIZE'
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

    def write_frames(self, names_and_patches):
        inst_dir = self.root / 'instance'
        inst_dir.mkdir(exist_ok=True)
        for name, patches in names_and_patches:
            make_frame(inst_dir / name, patches)

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

    def test_furniture_declared_but_instance_dir_missing_fails(self):
        self.write_legend(make_legend(FURNITURE_COLORS))
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('no instance/ frames', msg)

    # --- 本来の検出対象: 撮影開始時点で家具の読み込みが終わっていたか -------

    def test_furniture_present_from_the_first_frame_passes(self):
        # フレームの ~20% を家具1色で塗る (400px * 20% = 80px、閾値5%=20pxの4倍)。
        furniture_patch = [(FURNITURE_COLORS[0], 80)]
        non_furniture_patch = [(WALL_COLOR, 40), (ROOM_COLOR, 40)]
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([
            (f'{i:04d}.png', non_furniture_patch + (furniture_patch if i == 0 else []))
            for i in range(3)
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertIn('OK', msg)

    def test_furniture_missing_from_every_frame_fails(self):
        # 実際に起きた事故の形そのもの: legend は家具を宣言しているが、
        # instance フレームのどこにも家具に帰属できる面積が無い。
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([
            (f'{i:04d}.png', [(WALL_COLOR, 40), (ROOM_COLOR, 40)])  # 家具なし、壁と部屋だけ
            for i in range(3)
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('0.0%', msg)

    def test_furniture_only_appearing_late_in_the_run_still_fails(self):
        # 実際に壊れたレンダの実測シグネチャそのもの: エッジ密度が撮影の
        # ほとんどを未装飾の部屋相当のまま推移し、家具の非同期ロードが
        # 終わったごく終盤になってようやく家具相当の水準へ跳ね上がる。
        # 「一度でも写ったか」だけを見る和集合チェックだとこれを PASS させて
        # しまう -- ここでは先頭付近 (early window) に家具面積が無いことで
        # 正しく FAIL することを確認する。
        self.write_legend(make_legend(FURNITURE_COLORS))
        non_furniture_patch = [(WALL_COLOR, 40), (ROOM_COLOR, 40)]
        furniture_patch = [(FURNITURE_COLORS[0], 200)]  # 50% -- 家具が写れば圧倒的に明白な面積
        names_and_patches = []
        for i in range(9):
            patches = non_furniture_patch + (furniture_patch if i >= 7 else [])
            names_and_patches.append((f'{i:04d}.png', patches))
        self.write_frames(names_and_patches)
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('had not finished loading', msg)

    def test_furniture_present_early_but_absent_from_some_later_frames_still_passes(self):
        # カメラのパン・オクルージョン解消で特定の家具だけが特定フレームで
        # 見切れる/隠れるという正当な変化に、この判定は誤反応してはいけない。
        # 判定対象は「家具全体に帰属する面積の集計値」であって個々の家具の
        # 色一致ではないので、早いフレームに十分な面積さえあれば良い。
        self.write_legend(make_legend(FURNITURE_COLORS))
        non_furniture_patch = [(WALL_COLOR, 40), (ROOM_COLOR, 40)]
        self.write_frames([
            ('0000.png', non_furniture_patch + [(FURNITURE_COLORS[0], 80), (FURNITURE_COLORS[1], 80)]),
            ('0001.png', non_furniture_patch + [(FURNITURE_COLORS[2], 80)]),  # 別の家具だけ写る
            ('0002.png', non_furniture_patch),  # このフレームでは家具が一切見切れている
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)

    def test_furniture_appearing_at_the_edge_of_the_early_window(self):
        # early window の境界そのものを狙い撃ちする回帰テスト: 家具が
        # early window 内の最後のフレーム (index early_count-1) に現れれば
        # PASS、その1つ後 (early window の外, index early_count) にずれる
        # と FAIL になる -- off-by-one で early window の判定が壊れたら
        # このテストが検出する。
        # n=9 を選ぶのは意図的: 9*20%=1.8 は整数に丸まらないので、
        # math.ceil と int()(切り捨て) が 2 と 1 に分かれる。n=10 のような
        # 割り切れる値だと両者が偶然一致してこの回帰テストが何も検出しなく
        # なる(このプロジェクトで何度も起きた「対称なフィクスチャのせいで
        # テストが何も見分けていない」の同じ罠)。
        n = 9
        early_count = max(1, math.ceil(n * EARLY_WINDOW_FRACTION))
        self.assertEqual(early_count, 2)  # このテストの前提(n=9, 20%)
        px = math.ceil(TOTAL_PX * FURNITURE_MASS_THRESHOLD)
        self.write_legend(make_legend(FURNITURE_COLORS))

        def frames_with_furniture_at(index):
            return [
                (f'{i:04d}.png',
                 [(WALL_COLOR, 40)] + ([(FURNITURE_COLORS[0], px)] if i == index else []))
                for i in range(n)
            ]

        self.write_frames(frames_with_furniture_at(early_count - 1))
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)

        shutil.rmtree(self.root / 'instance')
        self.write_frames(frames_with_furniture_at(early_count))
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)

    # --- 閾値の境界 -----------------------------------------------------

    def test_mass_just_below_threshold_in_every_frame_fails(self):
        px_at_threshold = math.ceil(TOTAL_PX * FURNITURE_MASS_THRESHOLD)
        below = px_at_threshold - 1
        self.assertGreaterEqual(below, 0)
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([
            ('0000.png', [(WALL_COLOR, 40), (FURNITURE_COLORS[0], below)]),
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)

    def test_mass_at_or_above_threshold_passes(self):
        px_at_threshold = math.ceil(TOTAL_PX * FURNITURE_MASS_THRESHOLD)
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([
            ('0000.png', [(WALL_COLOR, 40), (FURNITURE_COLORS[0], px_at_threshold)]),
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)

    # --- アンチエイリアスの縁程度のノイズで誤 PASS しないこと ----------------

    def test_a_few_stray_undeclared_pixels_do_not_cross_the_threshold(self):
        # アンチエイリアスの縁を模した、宣言色に一致しない少量のノイズ
        # (閾値の1/4程度) だけでは家具が揃ったとは判定しない。
        noise_px = max(1, math.ceil(TOTAL_PX * FURNITURE_MASS_THRESHOLD / 4))
        stray_color = (10, 20, 30)  # legend のどの色とも一致しない
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([
            ('0000.png', [(WALL_COLOR, 40), (ROOM_COLOR, 40), (stray_color, noise_px)]),
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)

    # --- 消去法の定義そのものを守る回帰テスト ------------------------------

    def test_background_alone_is_never_counted_as_furniture(self):
        # 背景 (白) しか無い = 家具どころか壁すら写っていないフレーム。
        # 背景を「家具に帰属する面積」の除外対象からうっかり外すと、
        # 空フレームが巨大な家具面積として誤カウントされて PASS してしまう。
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([('0000.png', [])])  # 全面背景のまま
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('0.0%', msg)

    def test_furniture_rendered_in_its_own_declared_color_still_counts(self):
        # 現状の instance ガイドは GLB 家具を単色黒で描く癖があるが、これは
        # 家具の宣言色そのものが写った場合にこの判定が壊れて良い理由には
        # ならない。非家具の宣言色集合からだけ除外する消去法なら、家具が
        # 自分の宣言色で正しく描かれても (将来直った場合や偶然の一致でも)
        # 変わらず家具面積として数えられる。
        px_at_threshold = math.ceil(TOTAL_PX * FURNITURE_MASS_THRESHOLD)
        self.write_legend(make_legend(FURNITURE_COLORS))
        self.write_frames([
            ('0000.png', [(WALL_COLOR, 40), (FURNITURE_COLORS[0], px_at_threshold)]),
        ])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)

    # --- 実データに対する検証 ---------------------------------------------

    def test_passes_on_the_real_current_t91_render(self):
        # pv/renders/T91-ldk-push は読み込み待ちが効いた「正しい」レンダ
        # (エッジ密度: frame0=18975 から家具入り。136969msかけて撮影)。
        # この render に対して FALSE POSITIVE を出さないことが本修正の
        # 直接の目的。
        real_dir = Path(__file__).resolve().parents[3] / 'renders' / 'T91-ldk-push'
        if not real_dir.exists():
            self.skipTest('pv/renders/T91-ldk-push not present in this checkout')
        ok, msg = check_scene_readiness(real_dir)
        self.assertTrue(ok, msg)

    def test_flags_a_faithful_synthetic_reproduction_of_the_real_broken_t91_render(self):
        # 実際に壊れた T91-ldk-push (~10秒で終わった旧レンダ) はもうディスク
        # 上に無い (このタスクの前提)。実測されたその不具合のシグネチャ
        # (エッジ密度が撮影のほとんどを未装飾の部屋相当のまま推移し、家具の
        # 非同期ロードが終わったごく終盤になって家具相当の水準へ跳ね上がる)
        # を、現存する正しいレンダの legend (=家具32件・非家具41件、実物の
        # 命名・色をそのまま使う) を土台に合成して再現する。
        real_dir = Path(__file__).resolve().parents[3] / 'renders' / 'T91-ldk-push'
        if not real_dir.exists():
            self.skipTest('pv/renders/T91-ldk-push not present in this checkout')
        legend = json.loads((real_dir / 'instance-legend.json').read_text())

        import re as _re
        glb_re = _re.compile(r'^(fmp-|im0261-)')

        def rgb(entry):
            h = entry['color'].lstrip('#')
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

        non_furniture = [e for e in legend['instances'] if not glb_re.match(e.get('type') or '')]
        furniture = [e for e in legend['instances'] if glb_re.match(e.get('type') or '')]
        self.assertEqual(len(furniture), 32)

        self.write_legend(legend)
        inst_dir = self.root / 'instance'
        inst_dir.mkdir()
        w, h = 256, 144
        names = [f'{i:04d}.png' for i in (0, 12, 24, 36, 48, 60, 72, 84, 95)]
        furnished_from = 7  # 実測どおり、撮影のごく終盤 (最後の2/9) までは未装飾

        for i, name in enumerate(names):
            im = Image.new('RGB', (w, h), BACKGROUND)
            px = im.load()
            x = y = 0

            def paint(color, count):
                nonlocal x, y
                for _ in range(count):
                    px[x, y] = color
                    x += 1
                    if x >= w:
                        x = 0
                        y += 1

            for e in non_furniture:
                paint(rgb(e), 40)
            if i >= furnished_from:
                remaining = w * h - (x + y * w)
                big = max(200, remaining // 3)
                for e in furniture[:3]:
                    paint(rgb(e), big)
            im.save(inst_dir / name)

        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('had not finished loading', msg)


if __name__ == '__main__':
    unittest.main()


class ExteriorShotTest(unittest.TestCase):
    """外観ショットでは家具は外皮の内側にあり、ガラス越しにしか写らない。

    面積5%は内観で較正した閾値なので、そのまま当てると正しいレンダを落とす。
    実測 (T94-exterior): 家具がロード済みでも早期 0.56% / 全体 0.70% で、
    判定器はこれを FAIL にし、正しい撮影を弾いていた。
    """

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / 'instance-legend.json').write_text(
            json.dumps(make_legend(FURNITURE_COLORS[:1])))
        self.inst = self.root / 'instance'
        self.inst.mkdir()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_shot(self, view):
        (self.root / 'shot.json').write_text(json.dumps({'id': 'T-test', 'view': view}))

    def write_run(self, furniture_px_per_frame):
        for i, n in enumerate(furniture_px_per_frame):
            make_frame(self.inst / f'{i:04d}.png',
                       [(WALL_COLOR, 40), (FURNITURE_COLORS[0], n)])

    # 400px 中 2px = 0.5%, 3px = 0.75% -- 実測の T94 と同じ桁で、5% を大きく下回る。
    def test_exterior_with_furniture_present_from_the_start_passes(self):
        self.write_shot('3d-ext')
        self.write_run([2, 2, 3, 3, 3])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertIn('exterior shot', msg)

    def test_exterior_with_furniture_arriving_late_still_fails(self):
        # ここを見逃したら外観分岐は何も守っていない: 早期ほぼ0 -> 終盤で立ち上がる、
        # というのがまさに「撮影開始に間に合わなかった」の署名。
        self.write_shot('3d-ext')
        self.write_run([0, 0, 0, 0, 12])
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn('had not finished loading', msg)

    def test_exterior_with_nothing_visible_is_reported_as_unverifiable(self):
        self.write_shot('3d-ext')
        self.write_run([0, 0, 0, 0, 0])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertIn('UNVERIFIABLE', msg)

    def test_same_pixel_counts_would_fail_an_interior_shot(self):
        # 外観分岐が「面積が小さい run を無条件に通す」ものになっていないことの確認。
        # 同じフレーム列でも view が 3d-int なら従来どおり落ちる。
        self.write_shot('3d-int')
        self.write_run([2, 2, 3, 3, 3])
        ok, msg = check_scene_readiness(self.root)
        self.assertFalse(ok, msg)
        self.assertIn(f'threshold {FURNITURE_MASS_THRESHOLD:.0%}', msg)

    def test_exterior_above_the_area_threshold_takes_the_strong_verdict(self):
        # 3d-ext で撮った内観相当の画角 (T93-ldk-eye がまさにこれ) が、
        # view だけで弱い判定に落ちないこと。
        self.write_shot('3d-ext')
        self.write_run([120, 120, 130, 130, 130])
        ok, msg = check_scene_readiness(self.root)
        self.assertTrue(ok, msg)
        self.assertNotIn('exterior shot', msg)
