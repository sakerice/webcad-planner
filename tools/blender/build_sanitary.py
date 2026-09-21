"""水まわりの設備(浴槽・便器・洗面化粧台)を生成して `assets/models/original/` へ書き出す。

■ なぜ作り直すのか
  カタログには浴槽12点・便器7点・洗面化粧台15点があるが、**寸法が日本の
  住宅のものではない**。`node tools/catalogue_gap.mjs` で測った値:

      便器        実寸に合うもの 0/7 点（最大 371x572、標準は 380x680）
      洗面化粧台  1/15 点（最大 904x435、標準は 750x500）
      浴槽        2/12 点（最大 1099x1099。1坪UBの 1600x750 は1点も無い）

  12点の「浴槽」のうち4点は幅600未満で、そもそも湯船ではない。汎用の家具
  パック由来で、日本の住宅設備として作られていないためである。
  **どれが合うかを選ばせる前に、選択肢を正す。** 詳細は docs/catalogue-gap.md。

■ 寸法(manifest.json の w/d/h と一対一)
  original-bathtub : 1600 x  750 x  600 mm  1坪ユニットバス(1616)の湯船
  original-toilet  :  390 x  700 x  800 mm  タンク付き洋風便器(コンパクト)
  original-vanity  :  750 x  505 x 1850 mm  洗面化粧台 + 三面鏡(間口750)

  根拠は住宅設備メーカーの標準寸法。判定の範囲は
  `tools/catalogue-vocab.mjs` の REAL_SIZE にあり、検査が見ている。

■ 座標・原点の約束(既存モデルと共通)
  - 単位はメートル。Blender は Z-up で組み、`export_yup=True` で glTF(+Y up)へ。
  - 原点は接地面の中心。Z=0 から上へ立てる。
  - **正面は Blender の -Y。** glTF に変換すると +Z になり、アプリの約束
    (前面 +Z / 上 +Y)と合う。サムネのカメラも -Y 側から見ている。
    ここを +Y で組むと、3Dで便器だけ壁を向く。
  - バウンディングボックスは w/d/h と一致させる(`normalize_to()`)。

■ 色の変えられるところ
  マテリアルの `finishChannel` が assets/js/model-quality.js の
  `applyFinishes()` に対応する。**陶器は白のままにする。** 浴槽と便器の
  色を変えられるようにしても、現実の選択肢に無い色が出るだけで嘘になる。
  変えられるのは洗面化粧台の扉(`door`)だけ。

■ 実行方法
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/build_sanitary.py

  フラグ:
      --no-export   GLBを書かず、三角形数と寸法だけ出す
      --no-icons    top/thumb のPNGを描き直さない(Cyclesを回さないので速い)
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exterior_build import (  # noqa: E402  同じ約束を二度書かない
    matp, clear_scene, new_object, tri_count, add_box, add_tube,
    normalize_to, render_top, render_thumb)


def export(obj, path):
    """GLBへ書き出す。**extras を載せる**ところだけ exterior_build と違う。

    色を変えられる部位は、マテリアルの `finishChannel` で示す。これは glTF の
    materials[].extras に入り、three.js が material.userData へ移す
    (assets/js/model-quality.js の applyFinishes が読む)。`export_extras=True`
    を落とすと extras ごと消え、扉の色が変えられなくなる。
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_apply=True, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False, export_extras=True,
        export_texture_dir='')
    return os.path.getsize(path)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(_ROOT, 'assets', 'models', 'original')
# **編集できる .blend を必ず残す。** 出荷する GLB だけでは作り直せない。
# tools/tests/original-models.test.cjs が、1点ごとに在ることを見ている。
WORK_DIR = os.path.join(_ROOT, 'tools', 'blender', 'work', 'original')

# 実寸(mm)。**ここが唯一の出どころ。** manifest の w/d/h と揃える。
SIZES = {
    'original-bathtub': (1600, 750, 600),
    'original-toilet': (390, 700, 800),
    'original-vanity': (750, 505, 1850),
}


# ── 角丸の輪郭とロフト ──────────────────────────────────────────
#
# 水まわりは角が丸い。直方体で作ると、3Dで見たときに「箱」にしか見えない。
# 角丸の輪を高さ違いで並べて、輪と輪を面でつなぐ(ロフト)と、縁のある浴槽も
# 便器の鉢も同じやり方で作れる。
def rounded_rect(cx, cy, w, d, r, z, n=6):
    """角丸長方形の頂点列。角ごとに n 分割する。"""
    hw, hd = w / 2 - r, d / 2 - r
    pts = []
    for sx, sy, start in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(n + 1):
            a = math.radians(start + k * 90 / n)
            pts.append(Vector((cx + sx * hw + r * math.cos(a),
                               cy + sy * hd + r * math.sin(a), z)))
    # 角の継ぎ目で同じ点が重なるので間引く
    out = []
    for p in pts:
        if not out or (p - out[-1]).length > 1e-6:
            out.append(p)
    return out


def loft(bm, mat_index, lower, upper):
    """2つの輪を面でつなぐ。輪の頂点数は同じであること。"""
    a = [bm.verts.new(p) for p in lower]
    b = [bm.verts.new(p) for p in upper]
    for i in range(len(a)):
        j = (i + 1) % len(a)
        bm.faces.new((a[i], a[j], b[j], b[i])).material_index = mat_index
    return a, b


def cap(bm, mat_index, ring, flip=False):
    """輪を1枚の面でふさぐ。"""
    vs = [bm.verts.new(p) for p in ring]
    bm.faces.new(vs[::-1] if flip else vs).material_index = mat_index
    return vs


# ── 浴槽(1坪ユニットバスの湯船) ────────────────────────────────
def build_bathtub():
    """外周のエプロン、上端の縁、内側の湯船、緩い底。

    **縁(rim)を作ることが肝心。** 箱の上面をそのまま開けると、厚みゼロの
    紙のように見える。実物は 50〜60mm の平らな縁があり、そこに腰掛けたり
    シャンプーを置いたりする。
    """
    w, d, h = 1.60, 0.75, 0.60
    ceramic = matp('Bathtub ceramic', '#f4f4f1', rough=0.16)
    apron = matp('Bathtub apron', '#eceae5', rough=0.35)
    metal = matp('Bathtub fitting', '#b9bcc0', rough=0.25, metal=0.9)
    bm = bmesh.new()

    # **角のRを大きく取る。** はじめ R=70mm で作ったら、サムネがただの白い箱
    # だった。実物の1坪UBの湯船は隅が大きく丸く、浴槽らしさはほぼこのRで
    # 決まる。ここをケチると、面数を足しても箱のままになる。
    z_rim, z_floor = h, 0.13
    n = 9                                    # 角の分割(Rが大きいので増やす)
    outer_low = rounded_rect(0, 0, w - 0.07, d - 0.06, 0.13, 0.02, n)
    outer_rim = rounded_rect(0, 0, w, d, 0.17, z_rim, n)
    rim_in = rounded_rect(0, 0, w - 0.19, d - 0.15, 0.13, z_rim, n)
    basin_mid = rounded_rect(0, 0, w - 0.24, d - 0.19, 0.14, z_rim - 0.13, n)
    basin_low = rounded_rect(0, 0, w - 0.32, d - 0.26, 0.15, z_floor, n)

    cap(bm, 1, rounded_rect(0, 0, w - 0.07, d - 0.06, 0.13, 0.02, n), flip=True)
    loft(bm, 1, outer_low, outer_rim)        # エプロン(下すぼまり)
    loft(bm, 0, outer_rim, rim_in)           # 縁(95mm)。座れる幅を残す
    loft(bm, 0, rim_in, basin_mid)           # 縁から内壁への立ち下がり
    loft(bm, 0, basin_mid, basin_low)        # 内壁(footwell へ絞る)
    cap(bm, 0, basin_low, flip=True)
    obj = new_object('original-bathtub', bm, [ceramic, apron, metal])
    # 排水金具。**小さいが、無いと洗面器に見える。**
    bmd = bmesh.new()
    add_tube(bmd, 0, [Vector((w * 0.33, d * 0.22, z_floor - 0.002)),
                      Vector((w * 0.33, d * 0.22, z_floor + 0.014))],
             [0.042, 0.042], 20)
    drain = new_object('Bathtub drain', bmd, [metal])
    join(obj, [drain])
    normalize_to(obj, w, d, h)
    return obj


# ── 便器(タンク付き洋風) ────────────────────────────────────────
def build_toilet():
    """足元・鉢・便座・フタ・タンク。正面は -Y(鉢が手前)。

    **鉢は楕円の輪をロフトして作る。** 球を潰すと縁の厚みが出ず、便座が
    浮いて見える。
    """
    w, d, h = 0.39, 0.70, 0.80
    ceramic = matp('Toilet ceramic', '#f7f7f5', rough=0.14)
    seat = matp('Toilet seat', '#f2f1ee', rough=0.30)
    metal = matp('Toilet fitting', '#b9bcc0', rough=0.25, metal=0.9)

    # **奥行きは絶対座標で置く。** 割合で組むと、鉢とタンクの合計が狙いの
    # 奥行きに届かず、アプリ側で w/d/h へ引き伸ばされて間延びする。
    front, back = -0.35, 0.35          # 全体 700mm
    bowl_y, bowl_d = -0.11, 0.48       # 鉢 480mm(-0.35〜+0.13)
    tank_y, tank_d = 0.24, 0.22        # タンク 220mm(+0.13〜+0.35)
    rim_z = 0.40                       # 鉢の縁の高さ

    bm = bmesh.new()
    # 足元(床から鉢へ向かって広がる)
    loft(bm, 0, rounded_rect(0, bowl_y + 0.04, 0.20, 0.27, 0.09, 0.0),
         rounded_rect(0, bowl_y, w * 0.86, bowl_d * 0.88, 0.15, rim_z - 0.10))
    cap(bm, 0, rounded_rect(0, bowl_y + 0.04, 0.20, 0.27, 0.09, 0.0), flip=True)
    # 鉢の外側 → 縁
    loft(bm, 0, rounded_rect(0, bowl_y, w * 0.86, bowl_d * 0.88, 0.15, rim_z - 0.10),
         rounded_rect(0, bowl_y, w, bowl_d, 0.17, rim_z))
    # 縁の平ら → 内側 → 溜まり
    loft(bm, 0, rounded_rect(0, bowl_y, w, bowl_d, 0.17, rim_z),
         rounded_rect(0, bowl_y, w - 0.05, bowl_d - 0.05, 0.15, rim_z))
    loft(bm, 0, rounded_rect(0, bowl_y, w - 0.05, bowl_d - 0.05, 0.15, rim_z),
         rounded_rect(0, bowl_y, 0.17, 0.21, 0.08, rim_z - 0.16))
    cap(bm, 0, rounded_rect(0, bowl_y, 0.17, 0.21, 0.08, rim_z - 0.16), flip=True)
    body = new_object('original-toilet', bm, [ceramic, seat, metal])

    parts = []
    # タンク(背面)。前面がRの付いた箱。
    bt = bmesh.new()
    loft(bt, 0, rounded_rect(0, tank_y, 0.36, tank_d, 0.03, rim_z - 0.02),
         rounded_rect(0, tank_y, 0.36, tank_d, 0.03, h - 0.02))
    loft(bt, 0, rounded_rect(0, tank_y, 0.36, tank_d, 0.03, h - 0.02),
         rounded_rect(0, tank_y, 0.34, tank_d - 0.02, 0.03, h))
    cap(bt, 0, rounded_rect(0, tank_y, 0.34, tank_d - 0.02, 0.03, h))
    parts.append(new_object('Toilet tank', bt, [ceramic]))
    # 便座とフタ。薄い板2枚。フタは開けない(閉じた姿が既定)。
    bs = bmesh.new()
    loft(bs, 0, rounded_rect(0, bowl_y, w - 0.01, bowl_d - 0.01, 0.17, rim_z + 0.002),
         rounded_rect(0, bowl_y, w - 0.01, bowl_d - 0.01, 0.17, rim_z + 0.042))
    cap(bs, 0, rounded_rect(0, bowl_y, w - 0.01, bowl_d - 0.01, 0.17, rim_z + 0.042))
    parts.append(new_object('Toilet seat', bs, [seat]))
    # レバー
    bl = bmesh.new()
    add_tube(bl, 0, [Vector((0.125, tank_y - tank_d / 2 - 0.004, h - 0.10)),
                     Vector((0.170, tank_y - tank_d / 2 - 0.004, h - 0.10))],
             [0.010, 0.010], 12)
    parts.append(new_object('Toilet lever', bl, [metal]))

    join(body, parts)
    normalize_to(body, w, d, h)
    return body


# ── 洗面化粧台(間口750 + 三面鏡) ────────────────────────────────
def build_vanity():
    """下台(扉2枚・蹴込み)、カウンター一体の洗面ボウル、水栓、三面鏡。

    **蹴込み(toe kick)を作る。** 床にべったり付いた箱は作り付けに見えない。
    実物は足先が入るよう 80mm ほど奥へ引っ込んでいる。
    """
    w, d, h = 0.75, 0.505, 1.85
    counter = matp('Vanity counter', '#f2f1ee', rough=0.20)
    door = matp('Vanity door', '#e7e2d9', rough=0.55)
    mirror = matp('Vanity mirror', '#dfe4e6', rough=0.05, metal=0.95)
    metal = matp('Vanity fitting', '#b9bcc0', rough=0.25, metal=0.9)
    door['finishChannel'] = 'door'      # 色を変えられるのはここだけ

    cab_h, top_z = 0.78, 0.80
    # **前面は取手の先で y=-d/2 に揃える。** 扉や取手が外へ出ると、その分だけ
    # バウンディングボックスが深くなり、アプリ側で奥行きが痩せて見える。
    face = -d / 2                      # 取手の先端
    door_front = face + 0.016          # 扉の前面
    door_back = door_front + 0.017     # 扉の背面 = 下台の前面
    parts = []

    # 蹴込みと下台
    bk = bmesh.new()
    add_box(bk, 0, Vector((-w / 2 + 0.02, door_back + 0.08, 0)),
            Vector((w / 2 - 0.02, d / 2, 0.08)))
    parts.append(new_object('Vanity toe kick', bk, [door]))
    bc = bmesh.new()
    add_box(bc, 0, Vector((-w / 2, door_back, 0.08)), Vector((w / 2, d / 2, cab_h)))
    parts.append(new_object('Vanity cabinet', bc, [door]))
    # 扉2枚。**目地を作る。** 1枚の面だと収納に見えない。
    for sx in (-1, 1):
        bd = bmesh.new()
        x0 = sx * 0.006
        x1 = sx * (w / 2 - 0.012)
        add_box(bd, 0, Vector((min(x0, x1), door_front, 0.10)),
                Vector((max(x0, x1), door_back, cab_h - 0.02)))
        parts.append(new_object('Vanity door', bd, [door]))
        bh = bmesh.new()
        add_tube(bh, 0, [Vector((sx * 0.055, face + 0.008, 0.20)),
                         Vector((sx * 0.055, face + 0.008, 0.52))], [0.008, 0.008], 12)
        parts.append(new_object('Vanity handle', bh, [metal]))

    # カウンター + ボウル(一体成形)
    bm = bmesh.new()
    top = rounded_rect(0, 0, w, d, 0.012, top_z)
    loft(bm, 0, rounded_rect(0, 0, w, d, 0.012, cab_h), top)
    bowl_c, bowl_w, bowl_d = -0.02, 0.44, 0.31
    loft(bm, 0, top, rounded_rect(0, bowl_c, bowl_w, bowl_d, 0.09, top_z))
    loft(bm, 0, rounded_rect(0, bowl_c, bowl_w, bowl_d, 0.09, top_z),
         rounded_rect(0, bowl_c, bowl_w - 0.14, bowl_d - 0.12, 0.07, top_z - 0.14))
    cap(bm, 0, rounded_rect(0, bowl_c, bowl_w - 0.14, bowl_d - 0.12, 0.07, top_z - 0.14),
        flip=True)
    parts.append(new_object('Vanity counter', bm, [counter]))

    # 水栓(立ち上がり + 吐水口)
    bf = bmesh.new()
    add_tube(bf, 0, [Vector((0, d / 2 - 0.07, top_z)),
                     Vector((0, d / 2 - 0.07, top_z + 0.20))], [0.018, 0.016], 16)
    add_tube(bf, 0, [Vector((0, d / 2 - 0.07, top_z + 0.20)),
                     Vector((0, bowl_c + 0.02, top_z + 0.20))], [0.015, 0.014], 16)
    add_tube(bf, 0, [Vector((0, bowl_c + 0.02, top_z + 0.20)),
                     Vector((0, bowl_c + 0.02, top_z + 0.17))], [0.013, 0.013], 12)
    parts.append(new_object('Vanity faucet', bf, [metal]))

    # 三面鏡。中央+左右の3枚に割る(1枚板だと洗面台に見えない)
    mir_z, mir_h, mir_d = 0.95, h - 0.95, 0.15
    bb = bmesh.new()
    add_box(bb, 0, Vector((-w / 2, d / 2 - mir_d, mir_z)),
            Vector((w / 2, d / 2, mir_z + mir_h)))
    parts.append(new_object('Vanity mirror case', bb, [counter]))
    edges = (-w / 2, -w / 6, w / 6, w / 2)
    for i in range(3):
        bp = bmesh.new()
        add_box(bp, 0, Vector((edges[i] + 0.008, d / 2 - mir_d - 0.012, mir_z + 0.03)),
                Vector((edges[i + 1] - 0.008, d / 2 - mir_d - 0.006, mir_z + mir_h - 0.03)))
        parts.append(new_object('Vanity mirror panel', bp, [mirror]))

    base = parts[0]
    join(base, parts[1:])
    base.name = 'original-vanity'
    normalize_to(base, w, d, h)
    return base


def join(target, others):
    """others を target へ統合する。マテリアルは維持される。"""
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    if others:
        bpy.ops.object.join()
    return target


def main(do_export=True, do_icons=True):
    made = []
    for stem, builder in (('original-bathtub', build_bathtub),
                          ('original-toilet', build_toilet),
                          ('original-vanity', build_vanity)):
        clear_scene()
        obj = builder()
        # **obj.dimensions は使わない。** normalize_to は頂点を直接動かすので、
        # 依存グラフが更新されるまで古い値(正規化前)を返す。実測で気づいた。
        vs = obj.data.vertices
        dx = max(v.co.x for v in vs) - min(v.co.x for v in vs)
        dy = max(v.co.y for v in vs) - min(v.co.y for v in vs)
        dz = max(v.co.z for v in vs) - min(v.co.z for v in vs)
        want = SIZES[stem]
        line = '  %-18s tris=%-5d %4.0f x %4.0f x %4.0f mm' % (
            stem, tri_count(obj), dx * 1000, dy * 1000, dz * 1000)
        for got, target, axis in zip((dx, dy, dz), want, 'wdh'):
            assert abs(got * 1000 - target) < 1.0, \
                '%s の %s が %.1f mm。狙いは %d mm' % (stem, axis, got * 1000, target)
        if do_export:
            os.makedirs(WORK_DIR, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK_DIR, stem + '.blend'))
            line += '  glb=%d bytes' % export(obj, os.path.join(OUT_DIR, stem + '.glb'))
        print(line, flush=True)
        if do_icons:
            render_top(obj, os.path.join(OUT_DIR, '..', 'previews-v2', stem + '-top.png'))
            render_thumb(obj, os.path.join(OUT_DIR, '..', 'previews-v2', stem + '-thumb.png'))
        made.append(obj)
    return made


if __name__ == '__main__':
    main(do_export='--no-export' not in sys.argv,
         do_icons='--no-icons' not in sys.argv)
