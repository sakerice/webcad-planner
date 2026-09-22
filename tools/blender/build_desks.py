"""机(学習机・ワークデスク)を生成して `assets/models/original/` へ書き出す。

■ なぜ作るのか
  カタログに机は**1点しかない**。しかもその1点は 1050 x 420 で、奥行420は
  学習机として浅すぎる(標準は600)。実寸に合う机は 0/1 点だった。

  3LDK では子供部屋2室に机が要る。1点しか無いと同じ机が2つ並び、しかも
  その1点が寸法違いなので、`docs/quality-bar.md` の「子供部屋に学習セット」
  が成立しない。

■ 寸法(manifest.json の w/d/h と一対一)
  original-desk      : 1000 x 600 x 720 mm  学習机(片袖3段)
  original-desk-work : 1400 x 700 x 730 mm  ワークデスク(片袖2段+配線逃げ)

  **上棚は付けない。** 上棚付きは高さが1200前後になり、分類の高さ検査
  (`tools/catalogue-vocab.mjs` の HEIGHT_RULES: desk は 640〜820)に載らない。
  上棚を作るなら別の分類を足す話になるので、まず天板だけの形で入れる。

■ 座標・原点の約束
  - 正面は Blender の -Y(glTF +Z)。引き出しの前板と取手が -Y を向く。
  - 原点は接地面の中心。

■ 色
  `wood` チャンネルで木部の色を変えられる。天板・側板・引き出し前板が
  同じチャンネルに乗る。金物(取手・脚)は変えない。

■ 実行方法
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/build_desks.py
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

# (幅, 奥行, 高さ, 引き出しの段数)
SIZES = {
    'original-desk': (1000, 600, 720, 3),
    'original-desk-work': (1400, 700, 730, 2),
}


def build_desk(w_mm, d_mm, h_mm, drawers):
    """天板・側板・引き出し・幕板。

    **引き出しの前板を1枚ずつ分ける。** 袖を1つの箱にすると、3Dで見たときに
    机ではなく「天板の載った箱」になる。前板の目地と取手が入るだけで、
    面数を増やさずに机に見える。

    **幕板(modesty panel)を入れる。** 脚だけだと後ろが抜けて、椅子を入れた
    ときに脚が透けて見える。実物は背面に板がある。
    """
    w, d, h = w_mm / 1000, d_mm / 1000, h_mm / 1000
    wood = matp('Desk wood', '#c9a97e', rough=0.55)
    wood['finishChannel'] = 'wood'
    metal = matp('Desk fitting', '#9fa3a7', rough=0.35, metal=0.85)
    parts = []

    top_t = 0.025                      # 天板の厚み
    ped_w = 0.36                       # 袖(引き出し)の幅
    side_t = 0.020

    # 天板
    bt = bmesh.new()
    add_box(bt, 0, Vector((-w / 2, -d / 2, h - top_t)), Vector((w / 2, d / 2, h)))
    parts.append(new_object('original-desk', bt, [wood, metal]))

    # 右の袖(引き出し)
    ped_x0 = w / 2 - ped_w
    bp = bmesh.new()
    add_box(bp, 0, Vector((ped_x0, -d / 2 + 0.02, 0.06)),
            Vector((w / 2, d / 2, h - top_t)))
    parts.append(new_object('Desk pedestal', bp, [wood]))
    # 引き出しの前板と取手
    span = (h - top_t - 0.10) / drawers
    for k in range(drawers):
        z0 = 0.09 + k * span
        bf = bmesh.new()
        add_box(bf, 0, Vector((ped_x0 + 0.006, -d / 2 + 0.004, z0 + 0.008)),
                Vector((w / 2 - 0.006, -d / 2 + 0.020, z0 + span - 0.008)))
        parts.append(new_object('Desk drawer front', bf, [wood]))
        bh = bmesh.new()
        # **取手の外側を天板の前端に揃える。** 前へ出すと奥行きがその分だけ
        # 増え、normalize_to が縦横比を保ったまま縮めるので幅が狙いに
        # 届かなくなる(実測 1000狙いで 977.4mm)。
        add_tube(bh, 0, [Vector((ped_x0 + 0.08, -d / 2 + 0.008, z0 + span / 2)),
                         Vector((w / 2 - 0.08, -d / 2 + 0.008, z0 + span / 2))],
                 [0.008, 0.008], 10)
        parts.append(new_object('Desk drawer handle', bh, [metal]))

    # 左の側板(脚)
    bs = bmesh.new()
    add_box(bs, 0, Vector((-w / 2, -d / 2 + 0.02, 0.02)),
            Vector((-w / 2 + side_t, d / 2, h - top_t)))
    parts.append(new_object('Desk side panel', bs, [wood]))
    # 幕板(背面)
    bm = bmesh.new()
    add_box(bm, 0, Vector((-w / 2 + side_t, d / 2 - 0.018, h * 0.45),),
            Vector((ped_x0, d / 2, h - top_t)))
    parts.append(new_object('Desk modesty panel', bm, [wood]))
    # 足元の巾木(左側板の下)。床との取り合いを作る。
    bl = bmesh.new()
    add_box(bl, 0, Vector((-w / 2 + 0.004, -d / 2 + 0.05, 0.0)),
            Vector((-w / 2 + side_t + 0.006, d / 2 - 0.05, 0.02)))
    parts.append(new_object('Desk foot', bl, [metal]))

    base = parts[0]
    join(base, parts[1:])
    normalize_to(base, w, d, h)
    return base


def main(do_export=True, do_icons=True):
    made = []
    for stem, size in SIZES.items():
        clear_scene()
        obj = build_desk(*size)
        obj.name = stem
        vs = obj.data.vertices
        got = tuple(max(v.co[k] for v in vs) - min(v.co[k] for v in vs) for k in range(3))
        line = '  %-22s tris=%-5d %4.0f x %4.0f x %4.0f mm' % (
            stem, tri_count(obj), got[0] * 1000, got[1] * 1000, got[2] * 1000)
        for value, target, axis in zip(got, size[:3], 'wdh'):
            assert abs(value * 1000 - target) < 1.0, \
                '%s の %s が %.1f mm。狙いは %d mm' % (stem, axis, value * 1000, target)
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
