"""隣家パーツキットのプレビューレンダー。

`house_kit_build.py` で作ったパーツを 910mm グリッド上に並べ替えて
「パーツ一覧」と「1棟に組んだ状態」を書き出す。
アプリ側の組み立て(`index.html` の buildNeighborHouseKit)と同じ
910モジュールでの並べ方をBlender上で再現しているので、
パーツ単体の納まりをここで確認してから GLB を差し替える。

  python3 tools/blender/bmcp.py code tools/blender/render/house_kit_render.py
  出力先: $WEBCAD_RENDER_OUT または /tmp/webcad-render/
"""

import bpy
import math
import os

OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/')
os.makedirs(OUT_DIR, exist_ok=True)

P = 0.910
SEG_H = 2.700

# 1棟に組むときの正面の並び(左から)。house_kit_build.py のパーツ名と対応
FRONT_ROW = ['nh_seg_win_l2', 'nh_seg_win_l2', 'nh_seg_plain2', 'nh_seg_entry']
UPPER_ROW = ['nh_seg_door_l', 'nh_seg_win_s', 'nh_seg_plain', 'nh_seg_win_l']
SHEET = ['nh_seg_plain', 'nh_seg_win_s', 'nh_seg_win_t', 'nh_seg_win_l',
         'nh_seg_door_l', 'nh_seg_entry', 'nh_seg_garage', 'nh_balcony',
         'nh_plinth', 'nh_band', 'nh_corner', 'nh_downpipe',
         'nh_ac', 'nh_meter', 'nh_vent']


def clear_preview():
    for ob in list(bpy.data.objects):
        if ob.name.startswith('nhprev_'):
            bpy.data.objects.remove(ob, do_unlink=True)


def dup(name, loc, rot_z=0.0):
    src = bpy.data.objects.get(name)
    if not src:
        print('MISSING', name)
        return None
    ob = src.copy()
    ob.data = src.data          # メッシュは共有(パーツを増やしても軽い)
    ob.name = 'nhprev_' + name + '_%d' % len(bpy.data.objects)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    ob.hide_render = False
    bpy.context.scene.collection.objects.link(ob)
    return ob


def hide_others():
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        ob.hide_render = ob.name.startswith(('car_', 'bd_', 'bdprev_')) or (
            ob.name.startswith('nh_') and not ob.name.startswith('nhprev_'))


def row_width(names):
    return sum(3 if n.endswith('garage') else (2 if n.endswith(('_l', '_l2', 'entry')) else 1)
               for n in names) * P


def lay_row(names, z, y):
    """パーツ幅ぶんずつ左から詰めて並べる(アプリのベイ割りと同じ考え方)。"""
    total = row_width(names)
    x = -total / 2
    for n in names:
        span = 3 if n.endswith('garage') else (2 if n.endswith(('_l', '_l2', 'entry')) else 1)
        dup(n, (x + span * P / 2, y, z))
        x += span * P


def render(cam, name, loc, rot):
    cam.location = loc
    cam.rotation_euler = rot
    bpy.context.scene.render.filepath = OUT_DIR + name + '.png'
    bpy.ops.render.render(write_still=True)


def main():
    clear_preview()
    cam = bpy.data.objects.get('Cam')
    if not cam:
        print('NO_CAMERA')
        return

    # ── 1) 1棟に組んだ正面 ──
    w = row_width(FRONT_ROW)
    lay_row(FRONT_ROW, 0.0, 0.0)
    lay_row(UPPER_ROW, SEG_H, 0.0)
    for x in (-w / 2 + P / 2, w / 2 - P / 2):
        dup('nh_plinth', (x, 0, 0))
    dup('nh_balcony', (-w / 2 + P, 0, SEG_H))
    hide_others()
    render(cam, 'house_kit_front', (0, -16.0, 3.6), (math.radians(82), 0, 0))
    render(cam, 'house_kit_34', (11.0, -12.0, 8.0), (math.radians(66), 0, math.radians(42)))

    # ── 2) パーツ一覧(1列に並べる) ──
    clear_preview()
    x = 0.0
    for n in SHEET:
        ob = dup(n, (x, 0, 0))
        if ob:
            x += max(1.2, ob.dimensions.x + 0.6)
    hide_others()
    render(cam, 'house_kit_parts', (x / 2 - 0.5, -x * 0.62, 2.2),
           (math.radians(86), 0, 0))
    print('HOUSE_KIT_RENDER_OK')


main()
