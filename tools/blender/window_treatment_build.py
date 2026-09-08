"""窓まわりの内装(カーテン・ロールスクリーン)を生成して
`assets/models/custom/` へ書き出す。

■ なぜ要るのか
  カタログのカーテンは**襞(ひだ)の無い一枚板**で、目線の高さで見ると
  壁に貼り付いたシーツにしか見えない。窓の内装は視界に必ず入るので、
  ここが板だと部屋全体が安っぽくなる。
  ロールスクリーンはカタログに1点も無い。机や洗面台が窓の下にあると
  カーテンは天板に掛かって吊れないので、その窓には必ず要る。

■ 座標・原点の約束(interior_build.py と共通)
  - 単位はメートル。Blender は Z-up で組み、`export_yup=True` で glTF へ。
  - **原点は底面の中心**。アプリは floorTopY + elev にモデルの底面を置く。
  - **モデルの正面は +Y**(make_icons.py の平面図カメラがこれを前提にする)。
    窓まわりの物は壁に付くので、**壁は -Y 側**、部屋は +Y 側になる。
  - バウンディングボックスは manifest の w/d/h(mm) と一致させること。

■ カーテンの襞の作り方
  襞は「壁からどれだけ膨らむか」の波。両端は壁に接して閉じるので、
      y(u) = amp * (1 - cos(2π·K·u))     u = 0..1(幅方向)
  と置いて **K を整数**にする。整数でないと端が壁から浮いて、2枚並べた
  ときに継ぎ目が開く。振幅は裾でわずかに落とす(吊り下がった布は
  上でヒダが立ち、裾でやや落ち着く)。

■ 出力寸法
  curtain_short.glb      900 x 150 x 1350 mm  腰窓用(片開き1枚)
  curtain_long.glb       900 x 150 x 2040 mm  掃き出し窓用(片開き1枚)
  roller_screen_780.glb  780 x  50 x 1500 mm
  roller_screen_1235.glb 1235 x 50 x 1500 mm
  roller_screen_1690.glb 1690 x 50 x 1500 mm

  カーテンは1枚900mm。窓幅に対して
      780窓→1枚 / 1235窓→2枚 / 1690窓→2枚 / 2600窓→3枚
  で lint の「カーテン合計幅」の範囲(窓幅〜窓幅×2.1)に収まる。

■ 実行方法
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/window_treatment_build.py

  そのあと必ずアイコンを撮り直す:
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/make_icons.py -- \\
          assets/models/custom/curtain_short.glb ...
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                       'assets', 'models', 'custom')

# ── カーテン ────────────────────────────────────────────────
CURTAIN_W = 0.90
CURTAIN_D = 0.15
FOLDS = 7                  # 900mm に7山 → 山のピッチ 129mm(実物の目安 100〜150)
FOLD_AMP = 0.068           # 壁からの膨らみの半分。2*amp + 布厚 = 奥行
CLOTH_T = 0.009
RAIL_H = 0.035
RAIL_D = 0.034
U_SEG = 8                  # 1山あたりの分割
V_SEG = 12

# ── ロールスクリーン ────────────────────────────────────────
RS_D = 0.050
RS_H = 1.50
RS_ROLL_R = 0.021
RS_BAR_H = 0.028
RS_CLOTH_T = 0.004
RS_RIPPLE = 0.0035         # 巻いた布のごく浅い波。完全に平らだと紙に見える


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, rgba, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = roughness
    if 'Metallic' in bsdf.inputs:
        bsdf.inputs['Metallic'].default_value = metallic
    if 'Emission Strength' in bsdf.inputs:
        bsdf.inputs['Emission Strength'].default_value = 0.0
    return mat


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        ob.data.materials.append(m)
    return ob


def add_box(bm, cx, cy, cz, sx, sy, sz, mat_index=0):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector((sx, sy, sz)), verts=tmp.verts)
    bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector((cx, cy, cz)))
    for f in tmp.faces:
        f.material_index = mat_index
    _merge(bm, tmp)


def add_cylinder_x(bm, cx, cy, cz, radius, length, segments=20, mat_index=0):
    """X軸に沿った円柱(ロールスクリーンの巻き取りパイプ)。"""
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=radius, radius2=radius, depth=length,
                          matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector((cx, cy, cz)))
    for f in tmp.faces:
        f.material_index = mat_index
    _merge(bm, tmp)


def _merge(bm, tmp):
    me = bpy.data.meshes.new('_tmp')
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def _grid_surface(bm, nu, nv, point_fn, mat_index=0):
    """(u,v) から座標を返す関数でグリッド面を張る。"""
    verts = [[bm.verts.new(point_fn(i / nu, j / nv)) for j in range(nv + 1)]
             for i in range(nu + 1)]
    bm.verts.ensure_lookup_table()
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new((verts[i][j], verts[i + 1][j],
                              verts[i + 1][j + 1], verts[i][j + 1]))
            f.material_index = mat_index


def build_curtain(height, name):
    """片開きのカーテン1枚。壁は -Y 側、部屋は +Y 側。"""
    cloth = make_material('CurtainLinen', (0.83, 0.79, 0.72, 1.0), 0.90)
    rail = make_material('CurtainRail', (0.16, 0.16, 0.17, 1.0), 0.34, metallic=0.72)
    bm = bmesh.new()

    cloth_top = height - RAIL_H
    nu = FOLDS * U_SEG
    hem_soft = 0.88        # 裾のヒダはやや落ち着く

    def surf(u, v):
        # v: 0=裾, 1=フック。
        # 山のピッチをわずかに歪ませる。等間隔のままだと縦型ブラインドに見える。
        # u=0,1 で歪みが0になる形にしないと、両端が壁から浮く
        uw = u + 0.020 * math.sin(2 * math.pi * 3 * u)
        ph = 2 * math.pi * FOLDS * uw
        wave = 1.0 - math.cos(ph)                      # 0..2、端で0
        # 山ごとの振幅のばらつき(布は均一に畳まれない)
        amp = FOLD_AMP * (hem_soft + (1.0 - hem_soft) * v)
        amp *= 1.0 + 0.20 * math.sin(2 * math.pi * 2 * u + 0.7)
        y = amp * wave
        # フック際はヒダが立って谷が深くなる(つまみ襞)
        if v > 0.88:
            y *= 1.0 + (v - 0.88) / 0.12 * 0.22
        x = (u - 0.5) * CURTAIN_W
        # 裾は水平に切りそろえない。吊った布の裾はわずかに波打つ
        z_hem = 0.012 + 0.009 * (0.5 + 0.5 * math.sin(2 * math.pi * 2 * u + 1.1))
        z = z_hem + v * (cloth_top - z_hem)
        return Vector((x, y, z))

    _grid_surface(bm, nu, V_SEG, surf, mat_index=0)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=CLOTH_T)

    # カーテンレール。2枚並べても継ぎ目が出ないよう、幅いっぱいに通す
    add_box(bm, 0.0, RAIL_D / 2 + 0.004, height - RAIL_H / 2,
            CURTAIN_W, RAIL_D, RAIL_H * 0.62, mat_index=1)
    # ランナー(レールから布へ落ちる小さな金具)
    for i in range(FOLDS + 1):
        u = i / FOLDS
        add_box(bm, (u - 0.5) * CURTAIN_W * 0.985, RAIL_D / 2 + 0.004,
                height - RAIL_H * 0.78, 0.012, 0.010, RAIL_H * 0.5, mat_index=1)

    ob = new_object(name, bm, [cloth, rail])
    # ヒダは滑らかに、レールは角を残す。平面シェーディングのままだと
    # 布が折り紙のように見える
    smooth_shade(ob, math.radians(46))
    return ob


def build_roller_screen(width, name, total_h=RS_H):
    """ロールスクリーン。壁は -Y 側。上端にパイプ、下端にウエイトバー。"""
    cloth = make_material('ScreenCloth', (0.90, 0.88, 0.83, 1.0), 0.92)
    metal = make_material('ScreenMetal', (0.22, 0.22, 0.23, 1.0), 0.36, metallic=0.7)
    bm = bmesh.new()

    y_cloth = 0.016
    top_cloth = total_h - RS_ROLL_R * 2 - 0.006

    def surf(u, v):
        # ごく浅い横波。完全な平面だと紙に見える
        x = (u - 0.5) * (width - 0.012)
        y = y_cloth + RS_RIPPLE * math.sin(2 * math.pi * 6 * u) * (0.35 + 0.65 * (1 - v))
        z = RS_BAR_H + v * (top_cloth - RS_BAR_H)
        return Vector((x, y, z))

    _grid_surface(bm, 36, 6, surf, mat_index=0)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=RS_CLOTH_T)

    # 巻き取りパイプ(布が巻かれた状態なので、素の径より太らせる)
    add_cylinder_x(bm, 0.0, y_cloth + RS_ROLL_R - 0.004, total_h - RS_ROLL_R,
                   RS_ROLL_R, width - 0.030, segments=22, mat_index=0)
    # 左右のブラケット
    for sx in (-1, 1):
        add_box(bm, sx * (width / 2 - 0.008), y_cloth + RS_ROLL_R - 0.004,
                total_h - RS_ROLL_R, 0.016, RS_ROLL_R * 2.1, RS_ROLL_R * 2.1,
                mat_index=1)
    # ウエイトバー
    add_box(bm, 0.0, y_cloth + RS_CLOTH_T / 2, RS_BAR_H / 2,
            width - 0.016, 0.018, RS_BAR_H, mat_index=1)
    # 操作チェーン(右端)
    add_box(bm, width / 2 - 0.020, y_cloth + RS_ROLL_R * 1.6,
            total_h * 0.62, 0.005, 0.005, total_h * 0.72, mat_index=1)

    ob = new_object(name, bm, [cloth, metal])
    smooth_shade(ob, math.radians(38))
    return ob


def smooth_shade(ob, angle):
    """角度しきい値つきのスムーズシェード。GLBには法線として焼かれる。"""
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    mod = ob.modifiers.new('SmoothByAngle', 'EDGE_SPLIT')
    mod.split_angle = angle
    mod.use_edge_sharp = False
    bpy.ops.object.modifier_apply(modifier=mod.name)


def normalize_to(ob, w, d, h):
    """バウンディングボックスを w×d×h[m] に合わせ、底面中心を原点に置く。"""
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


def export(ob, filename):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.normpath(os.path.join(OUT_DIR, filename))
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_yup=True,
                              export_apply=True)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print('[window_treatment] %-24s tris=%5d -> %s'
          % (ob.name, tris, os.path.basename(path)))


# ロールスクリーンは丈を2種持つ。1種だと、窓台の高い窓(高窓・洗面・
# キッチン)で裾が窓台より400mm以上下がり、「腰窓に床丈を吊った」形になる
SPECS = [
    ('curtain', 'CurtainShort', (0.90, 1.35), 'curtain_short.glb'),
    ('curtain', 'CurtainLong', (0.90, 2.04), 'curtain_long.glb'),
    ('roller', 'RollerScreen780', (0.780, 1.50), 'roller_screen_780.glb'),
    ('roller', 'RollerScreen1235', (1.235, 1.50), 'roller_screen_1235.glb'),
    ('roller', 'RollerScreen1690', (1.690, 1.50), 'roller_screen_1690.glb'),
    ('roller', 'RollerScreen780S', (0.780, 1.10), 'roller_screen_780s.glb'),
    ('roller', 'RollerScreen1235S', (1.235, 1.10), 'roller_screen_1235s.glb'),
    ('roller', 'RollerScreen1690S', (1.690, 1.10), 'roller_screen_1690s.glb'),
]


def main():
    for kind, name, (pw, ph), filename in SPECS:
        clear_scene()
        if kind == 'curtain':
            ob = build_curtain(ph, name)
            normalize_to(ob, pw, CURTAIN_D, ph)
        else:
            ob = build_roller_screen(pw, name, ph)
            normalize_to(ob, pw, RS_D, ph)
        export(ob, filename)


if __name__ == '__main__':
    main()
