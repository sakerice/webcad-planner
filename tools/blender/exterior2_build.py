"""外構モデル(ウッドデッキ・機能門柱)を作り直して `assets/models/custom/` へ書き出す。

■ ウッドデッキ (wood_deck.glb を上書き)
  旧モデルの問題は3つ。
  1. 彩度が高すぎた。床テクスチャと同じ症状で、C* が実物(12〜20)を大きく超えると
     木ではなくオレンジ色のプラスチックに見える
  2. 板と板の間に目地が無かった。人工木デッキは 3〜5mm の隙間を空けて張るので、
     その暗い線が入らないと「板を張った面」に見えない
  3. 角が立ったままだった。デッキ材は必ず面取り(1〜2mm)されている

  デッキ材の実寸は 145 × 25mm(人工木の標準)。910モジュールの奥行900に対し
  145+4(目地) で6枚並ぶ。

■ 機能門柱 (gate_post.glb 新規)
  旧モデルは custom-block の黒い板1枚で、表札もポストもインターホンも無く、
  「未完成のフィン」に見えていた。実際の機能門柱は1本の柱に
  表札・インターホン・ポスト・照明が組み込まれた製品なので、その4つを入れる。
  取付高さは実務の標準に合わせた。
    照明 1470 / 表札 1330 / インターホン 1150 / ポスト投函口 900

■ 座標
  X=幅 Y=奥行 Z=高さ。原点は接地面の中心。glTF へは export_yup=True。

■ 実行
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/blender/exterior2_build.py
"""

import math
import os

import bpy
import bmesh
from mathutils import Vector, Matrix

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                       'assets', 'models', 'custom')


def hex_lin(h):
    """sRGB の16進 → Blender が期待するリニア値。

    Principled BSDF の Base Color は **リニア**。sRGB の数値をそのまま入れると
    1段明るく・彩度が抜けて出る(狙った茶色が薄いベージュになる)。
    """
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        s = int(h[i:i + 2], 16) / 255.0
        out.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def mat(name, color, rough=0.6, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit and 'Emission Strength' in b.inputs:
        b.inputs['Emission Color'].default_value = (color[0], color[1], color[2], 1.0)
        b.inputs['Emission Strength'].default_value = emit
    return m


def add_box(bm, center, size, chamfer=0.0):
    """面取り付きの直方体を bm に足す。角が立ったままだと樹脂の塊に見える。"""
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
    if chamfer > 0:
        bmesh.ops.bevel(tmp, geom=tmp.verts[:] + tmp.edges[:], offset=chamfer,
                        segments=1, affect='EDGES', profile=0.5, clamp_overlap=True)
    bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector(center))
    me = bpy.data.meshes.new('tmp')
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def finish_object(name, bm, materials, mat_of_face=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in materials:
        ob.data.materials.append(m)
    if mat_of_face:
        for p in ob.data.polygons:
            p.material_index = mat_of_face(p.center)
    return ob


def normalize_to(ob, w, d, h):
    bb = [Vector(c) for c in ob.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    size = mx - mn
    sx = w / size.x if size.x else 1.0
    sy = d / size.y if size.y else 1.0
    sz = h / size.z if size.z else 1.0
    for v in ob.data.vertices:
        v.co.x = (v.co.x - mn.x) * sx - w / 2
        v.co.y = (v.co.y - mn.y) * sy - d / 2
        v.co.z = (v.co.z - mn.z) * sz


def export(ob, path):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print('[ext2] %s tris=%d' % (os.path.basename(path), tris))


# ─────────────────────────────────────────────────────────────
def build_deck():
    W, D, H = 2.600, 0.900, 0.450
    BOARD_W, BOARD_T, GAP = 0.145, 0.025, 0.006
    n = int((D + GAP) // (BOARD_W + GAP))          # 900mm に 6枚
    span = n * BOARD_W + (n - 1) * GAP
    y0 = -span / 2 + BOARD_W / 2

    bm = bmesh.new()
    top = H
    # 床板。木口の面取りを入れ、1枚ずつ独立させて目地の影を作る
    for i in range(n):
        y = y0 + i * (BOARD_W + GAP)
        add_box(bm, (0.0, y, top - BOARD_T / 2), (W, BOARD_W, BOARD_T), chamfer=0.0018)
    # 根太(床板の直下・長手方向に2本)
    for y in (-D / 2 + 0.16, D / 2 - 0.16):
        add_box(bm, (0.0, y, top - BOARD_T - 0.045), (W - 0.06, 0.045, 0.090))
    # 幕板(見える3面)。これが無いと床下が素通しで安っぽい
    add_box(bm, (0.0, -D / 2 + 0.010, top - 0.082), (W, 0.020, 0.125), chamfer=0.0015)
    for sx in (-1, 1):
        add_box(bm, (sx * (W / 2 - 0.010), 0.0, top - 0.082), (0.020, D, 0.125), chamfer=0.0015)
    # 束(6本)+ 束石
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            x = sx * (W / 2 - 0.22)
            y = sy * (D / 2 - 0.17)
            add_box(bm, (x, y, (top - 0.19) / 2 + 0.05), (0.065, 0.065, top - 0.19))
            add_box(bm, (x, y, 0.025), (0.130, 0.130, 0.050))

    # 実物のウリン/人工木の色。彩度を上げるとプラスチックに見える
    WOOD = mat('DeckWood', hex_lin('#8A7256'), rough=0.72)
    WOOD_D = mat('DeckWoodDark', hex_lin('#6B5642'), rough=0.78)
    STONE = mat('DeckPier', hex_lin('#9C9A94'), rough=0.90)

    def which(c):
        if c.z < 0.06:
            return 2                      # 束石
        if c.z < 0.30:
            return 1                      # 束・根太は一段暗く
        return 0

    ob = finish_object('WoodDeck', bm, [WOOD, WOOD_D, STONE], which)
    normalize_to(ob, W, D, H)
    return ob


# ─────────────────────────────────────────────────────────────
def build_gate_post():
    W, D, H = 0.400, 0.200, 1.500
    bm = bmesh.new()
    # 柱本体。上端をわずかに絞って「板」に見せない
    add_box(bm, (0.0, 0.0, H / 2), (W, D, H), chamfer=0.006)
    # 笠木
    add_box(bm, (0.0, 0.0, H + 0.012), (W + 0.024, D + 0.024, 0.024), chamfer=0.003)
    # 表札(ステンレス板を少し浮かせて付ける)
    add_box(bm, (0.0, D / 2 + 0.006, 1.330), (0.230, 0.014, 0.075), chamfer=0.002)
    # インターホン
    add_box(bm, (0.0, D / 2 + 0.010, 1.150), (0.095, 0.022, 0.135), chamfer=0.003)
    add_box(bm, (0.0, D / 2 + 0.023, 1.185), (0.055, 0.004, 0.045))       # スピーカ面
    # ポスト: 前面の投函口(庇付き)と、背面の取出し扉
    add_box(bm, (0.0, D / 2 + 0.004, 0.900), (0.270, 0.012, 0.038), chamfer=0.002)
    add_box(bm, (0.0, D / 2 + 0.014, 0.935), (0.290, 0.032, 0.014), chamfer=0.002)
    add_box(bm, (0.0, -D / 2 - 0.006, 0.820), (0.300, 0.014, 0.320), chamfer=0.003)
    add_box(bm, (0.0, -D / 2 - 0.016, 0.820), (0.070, 0.010, 0.018))     # 取っ手
    # 照明(上部の横スリット)
    add_box(bm, (0.0, D / 2 + 0.004, 1.470), (0.180, 0.012, 0.030), chamfer=0.002)

    BODY = mat('GateBody', hex_lin('#3A3D40'), rough=0.52, metal=0.35)
    PLATE = mat('GatePlate', hex_lin('#D8D9DC'), rough=0.28, metal=0.65)
    PANEL = mat('GatePanel', hex_lin('#6E7378'), rough=0.48)
    LIGHT = mat('GateLight', hex_lin('#FFF3DC'), rough=0.20, emit=3.0)

    def which(c):
        if abs(c.z - 1.470) < 0.020 and c.y > 0.09:
            return 3                      # 照明
        if abs(c.z - 1.330) < 0.045 and c.y > 0.09:
            return 1                      # 表札
        if 1.07 < c.z < 1.23 and c.y > 0.09:
            return 2                      # インターホン
        return 0

    ob = finish_object('GatePost', bm, [BODY, PLATE, PANEL, LIGHT], which)
    normalize_to(ob, W, D, H)
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    deck = build_deck()
    export(deck, os.path.join(OUT_DIR, 'wood_deck.glb'))
    bpy.data.objects.remove(deck, do_unlink=True)

    post = build_gate_post()
    export(post, os.path.join(OUT_DIR, 'gate_post.glb'))


if __name__ == '__main__':
    main()
