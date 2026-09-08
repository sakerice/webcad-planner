"""内装モデル(シーリングファン)を生成して `assets/models/custom/` へ書き出す。

■ なぜ要るのか
  吹き抜けのある家でシーリングファンが無いと、上に溜まった空気を回す手立てが
  無い。カタログ(fmp / im0261 計685点)を `fan|propeller` で検索しても0件なので、
  手続き生成する。

■ 座標・原点の約束(exterior_build.py と共通)
  - 単位はメートル。Blender は Z-up で組み、`export_yup=True` で glTF(+Y up)へ。
  - **原点は接地面の中心**。アプリは floorTopY + elev にモデルの底面を置くので、
    天井付けの器具は「ロッドの上端が原点から h の位置に来る」ように作る。
    つまり Z=0 から上へ h まで伸びる形にして、elev で吊り上げる。
  - バウンディングボックスは manifest の w/d/h(mm) と一致させること。

■ 出力寸法
  ceiling_fan.glb : 1200 x 1200 x 350 mm (羽根5枚 φ1200 / 器具高さ350)

■ 実行方法
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/interior_build.py
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                       'assets', 'models', 'custom')
BLADES = 5
BLADE_LEN = 0.52          # ハブ外周から羽根先まで
BLADE_W = 0.14
BLADE_T = 0.012
BLADE_PITCH = math.radians(12)   # 迎え角。0だと板が水平で風が起きない見た目になる
HUB_R = 0.085
HUB_H = 0.09
ROD_R = 0.022
ROD_H = 0.20
CANOPY_R = 0.075
CANOPY_H = 0.06
TOTAL_H = 0.35


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_mesh(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob, bmesh.new()


def finish(ob, bm):
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.calc_normals_split() if hasattr(ob.data, 'calc_normals_split') else None
    return ob


def make_material(name, rgba, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = roughness
    if 'Metallic' in bsdf.inputs:
        bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def build_fan():
    ob, bm = new_mesh('CeilingFan')

    # 天井キャノピー(上端)。原点から TOTAL_H の位置に天井面が来る
    z_ceiling = TOTAL_H
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=20,
                          radius1=CANOPY_R, radius2=CANOPY_R * 0.72,
                          depth=CANOPY_H,
                          matrix=_translate(0, 0, z_ceiling - CANOPY_H / 2))
    # 吊りロッド
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=12,
                          radius1=ROD_R, radius2=ROD_R, depth=ROD_H,
                          matrix=_translate(0, 0, z_ceiling - CANOPY_H - ROD_H / 2))
    # モーターハブ
    z_hub = z_ceiling - CANOPY_H - ROD_H - HUB_H / 2
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24,
                          radius1=HUB_R, radius2=HUB_R * 0.86, depth=HUB_H,
                          matrix=_translate(0, 0, z_hub))

    # 羽根。ハブの高さの中央から水平に出し、長手軸まわりに迎え角をつける
    for i in range(BLADES):
        a = 2 * math.pi * i / BLADES
        blade = bmesh.new()
        bmesh.ops.create_cube(blade, size=1.0)
        bmesh.ops.scale(blade, vec=Vector((BLADE_LEN, BLADE_W, BLADE_T)),
                        verts=blade.verts)
        # 先端を少し細く(羽根らしいテーパー)
        for v in blade.verts:
            if v.co.x > 0:
                v.co.y *= 0.72
        bmesh.ops.rotate(blade, verts=blade.verts,
                         cent=Vector((0, 0, 0)),
                         matrix=_rot_x(BLADE_PITCH))
        bmesh.ops.translate(blade, verts=blade.verts,
                            vec=Vector((HUB_R + BLADE_LEN / 2, 0, 0)))
        bmesh.ops.rotate(blade, verts=blade.verts,
                         cent=Vector((0, 0, 0)), matrix=_rot_z(a))
        bmesh.ops.translate(blade, verts=blade.verts, vec=Vector((0, 0, z_hub)))
        me = bpy.data.meshes.new('blade%d' % i)
        blade.to_mesh(me)
        blade.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    finish(ob, bm)
    mat = make_material('FanWalnut', (0.32, 0.24, 0.17, 1.0), 0.55)
    ob.data.materials.append(mat)
    return ob


def _translate(x, y, z):
    from mathutils import Matrix
    return Matrix.Translation((x, y, z))


def _rot_x(a):
    from mathutils import Matrix
    return Matrix.Rotation(a, 3, 'X')


def _rot_z(a):
    from mathutils import Matrix
    return Matrix.Rotation(a, 3, 'Z')


def normalize_to(ob, w, d, h):
    """バウンディングボックスを w×d×h[m] に合わせ、底面中心を原点に置く。"""
    bpy.context.view_layer.objects.active = ob
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


def main():
    clear_scene()
    ob = build_fan()
    normalize_to(ob, 1.2, 1.2, TOTAL_H)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print('[interior_build] CeilingFan tris=%d' % tris)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, 'ceiling_fan.glb')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_yup=True,
                              export_apply=True)
    print('[interior_build] wrote %s' % path)


if __name__ == '__main__':
    main()
