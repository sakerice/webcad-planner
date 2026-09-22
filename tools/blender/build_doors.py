"""室内建具(開き戸の扉板)を生成して `assets/models/original/` へ書き出す。

■ なぜ作るのか
  開口(`door-swing` / `door-swing-s`)に割り当てられる扉のモデルは、
  `家具>ドア` の10点だけ。そのうち実際にメニューへ出るのは
  `Classroom-door-black` など**教室のドア5点**である(940 x 189 x 2700、
  上部にランマの付いた学校の引き戸然とした姿)。住宅の室内建具は1点も無い。

  3Dで家の中を歩くと、扉はどの部屋にも必ず在って必ず目に入る。ここが
  教室のドアだと、間取りの出来に関係なく家に見えない。

■ 寸法(manifest.json の w/d/h と一対一)
  original-door-flush : 755 x 70 x 1990 mm  フラッシュ戸(木目)
  original-door-slit  : 755 x 70 x 1990 mm  採光スリット入り(縦ガラス3本)

  開口の既定は幅780・高さ2000なので、扉板はその内側の 755 x 1990。
  奥行70は、板厚36にレバーハンドルの出っ張り(両面)を足した寸法。
  既存の教室ドアも同じ考え方で奥行189を宣言している。

  **アプリは扉板を開口へ box-fit する**(index.html の makeGltfBoxFitClone)。
  幅と高さは開口に合わせて伸縮するので、ここで決めるのは比率である。
  開口(780 x 2000)とほぼ同じ比率にしてあるので、歪まない。

■ 座標・原点の約束
  - 正面は Blender の -Y(glTF +Z)。ハンドルは両面に付く。
  - 原点は接地面の中心。扉は床から立ち上がる。

■ 色
  `wood` チャンネルで面材の色を変えられる。ハンドルとガラスは変えない。

■ 実行方法
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/build_doors.py
"""
import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exterior_build import (  # noqa: E402
    matp, clear_scene, new_object, tri_count, add_box, add_tube, normalize_to,
    render_top, render_thumb)
from shape_kit import join, export  # noqa: E402

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(_ROOT, 'assets', 'models', 'original')
WORK_DIR = os.path.join(_ROOT, 'tools', 'blender', 'work', 'original')

W, D, H = 0.755, 0.070, 1.990
LEAF_T = 0.036                     # 扉板の厚み
FACE = LEAF_T / 2                  # 板の面(原点から)


def build_door(slits):
    """扉板・レバーハンドル(両面)・丁番・(任意で)採光スリット。

    **ハンドルを両面に付ける。** 片面だけだと、開いた扉を裏から見たときに
    取っ手が消える。3Dを歩くと必ず裏側を見ることになる。

    **丁番を3枚入れる。** 板1枚だと壁にはめ込んだ板にしか見えない。
    実物は吊り元に丁番が見えていて、それが「建具」の合図になる。
    """
    wood = matp('Door face', '#c7a883', rough=0.5)
    wood['finishChannel'] = 'wood'
    metal = matp('Door hardware', '#9ea2a6', rough=0.3, metal=0.85)
    glass = matp('Door glass', '#cfd9dd', rough=0.08, metal=0.0)
    parts = []

    # 扉板。スリットを入れるときは、板を縦に割って間を空ける。
    if slits:
        # 中央に縦長のガラス3本。板は左・桟2本・右の4枚に分かれる。
        gap, gw = 0.030, 0.052              # 桟の幅 / ガラスの幅
        z0, z1 = 0.55, H - 0.30             # ガラスの上下
        left = -W / 2 + 0.115
        xs = []
        x = left
        for k in range(3):
            xs.append((x, x + gw))
            x += gw + gap
        right = x - gap
        # 板(ガラス帯の左右)
        for lo, hi in ((-W / 2, left), (right, W / 2)):
            bp = bmesh.new()
            add_box(bp, 0, Vector((lo, -FACE, 0)), Vector((hi, FACE, H)))
            parts.append(new_object('Door panel', bp, [wood]))
        # ガラス帯の上下(無目)
        for lo, hi in ((0.0, z0), (z1, H)):
            bp = bmesh.new()
            add_box(bp, 0, Vector((left, -FACE, lo)), Vector((right, FACE, hi)))
            parts.append(new_object('Door rail', bp, [wood]))
        # 桟(ガラスの間)
        for k in range(2):
            bp = bmesh.new()
            add_box(bp, 0, Vector((xs[k][1], -FACE, z0)),
                    Vector((xs[k + 1][0], FACE, z1)))
            parts.append(new_object('Door stile', bp, [wood]))
        # ガラス。板より薄くして、框に落とし込まれているように見せる。
        for lo, hi in xs:
            bg = bmesh.new()
            add_box(bg, 0, Vector((lo, -0.006, z0)), Vector((hi, 0.006, z1)))
            parts.append(new_object('Door glass', bg, [glass]))
    else:
        bp = bmesh.new()
        add_box(bp, 0, Vector((-W / 2, -FACE, 0)), Vector((W / 2, FACE, H)))
        parts.append(new_object('Door panel', bp, [wood]))

    # レバーハンドル(両面)。座 + レバー。
    handle_x = W / 2 - 0.075
    for sign in (-1, 1):
        br = bmesh.new()
        add_tube(br, 0, [Vector((handle_x, sign * FACE, 1.00)),
                         Vector((handle_x, sign * (FACE + 0.012), 1.00))],
                 [0.028, 0.026], 16)
        parts.append(new_object('Door rose', br, [metal]))
        bl = bmesh.new()
        # **レバーの外側を奥行きの端にぴたりと合わせる。** 管は軸から半径ぶん
        # 外へ出るので、軸を端に置くと箱からはみ出す。はみ出すと normalize_to が
        # 縦横比を保ったまま縮め、幅が狙いに届かない(実測 755狙いで 687.2mm)。
        lever_r = 0.010
        lever_y = D / 2 - lever_r
        add_tube(bl, 0, [Vector((handle_x, sign * (FACE + 0.012), 1.00)),
                         Vector((handle_x, sign * lever_y, 1.00))],
                 [0.011, 0.011], 12)
        add_tube(bl, 0, [Vector((handle_x, sign * lever_y, 1.00)),
                         Vector((handle_x - 0.095, sign * lever_y, 1.00))],
                 [lever_r, lever_r], 12)
        parts.append(new_object('Door lever', bl, [metal]))

    # 丁番3枚(吊り元 = 左)
    for z in (0.28, H / 2, H - 0.28):
        bh = bmesh.new()
        add_box(bh, 0, Vector((-W / 2 - 0.004, -0.014, z - 0.048)),
                Vector((-W / 2 + 0.018, 0.014, z + 0.048)))
        parts.append(new_object('Door hinge', bh, [metal]))

    base = parts[0]
    join(base, parts[1:])
    normalize_to(base, W, D, H)
    return base


SIZES = {
    'original-door-flush': False,
    'original-door-slit': True,
}


def main(do_export=True, do_icons=True):
    made = []
    for stem, slits in SIZES.items():
        clear_scene()
        obj = build_door(slits)
        obj.name = stem
        vs = obj.data.vertices
        got = tuple(max(v.co[k] for v in vs) - min(v.co[k] for v in vs) for k in range(3))
        line = '  %-22s tris=%-5d %4.0f x %4.0f x %4.0f mm' % (
            stem, tri_count(obj), got[0] * 1000, got[1] * 1000, got[2] * 1000)
        # **許容差は1.5mm。** 管(add_tube)は12角形なので、外側の面が公称
        # 半径よりわずかに内側に来る(実測 r=10mm で 9.66mm、cos(15度))。
        # レバーで奥行きを決めているぶん、両面で0.7mmほど足りない。
        # 幅と高さは板(箱)で決まるので、こちらはぴたりと出る。
        for value, target, axis in zip(got, (W, D, H), 'wdh'):
            assert abs(value - target) < 0.0015, \
                '%s の %s が %.1f mm。狙いは %.0f mm' % (stem, axis, value * 1000, target * 1000)
        if do_export:
            os.makedirs(WORK_DIR, exist_ok=True)
            import bpy
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK_DIR, stem + '.blend'))
            line += '  glb=%d bytes' % export(obj, os.path.join(OUT_DIR, stem + '.glb'))
        print(line, flush=True)
        if do_icons:
            previews = os.path.join(OUT_DIR, '..', 'previews-v2')
            render_top(obj, os.path.join(previews, stem + '-top.png'))
            render_thumb(obj, os.path.join(previews, stem + '-thumb.png'))
        made.append(obj)
    return made


if __name__ == '__main__':
    main(do_export='--no-export' not in sys.argv,
         do_icons='--no-icons' not in sys.argv)
