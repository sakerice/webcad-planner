"""架空のコンパクトクロスオーバーを三面図から起こして GLB へ書き出す。

■ なぜ作り直すのか / どう作るのが正しいか
  前のモデルは「ボディのロフト」と「キャノピー(ガラス)のロフト」を別々に作って
  重ねていた。実物の車体はベルトラインからルーフまで1枚の面で連続しているので、
  2枚を重ねると必ず境目に段差が出る。実際、旧モデルはガラスの真ん中に白い板が
  貫入して見えていた。

  **車を手続き生成で質良く作る手順は、実際のカーデザインと同じ順序を踏むこと。**

    1. 三面図を数値で決める
       - 側面図: トップライン(ノーズ→ボンネット→フロントガラス→ルーフ→
                 テールゲート→リヤバンパー)と、ベルトライン(ショルダー)
       - 平面図: 半幅の変化(ノーズで絞り、キャビンで最大、テールで絞る)
       - 断面図: ロッカー→ショルダー→タンブルホーム→ルーフの断面形
    2. 各ステーション(長手方向の断面位置)で、上の3つを引いて閉じたリングを作る
    3. リングを順に橋渡しして **1枚の連続面** にする
    4. キャラクターライン(ショルダー)には支持ループを寄せる。
       サブディビジョンは支持ループが無いと角を丸め切ってしまう
    5. ガラスは別メッシュにせず、**同じ面のマテリアルを差し替える**。
       こうすれば段差が原理的に生まれない。ピラーは差し替えない帯として残す

  この順序を守ると、断面の数値をいじるだけで形が破綻せずに変わる。
  逆にパーツを継ぎ足す作り方だと、継ぎ目の処理に手数の大半を取られる。

■ 諸元(実在車種ではない。日本のコンパクトクロスオーバーの標準的な寸法)
  全長 4400 / 全幅 1800 / 全高 1630(ルーフレール込 1660)
  ホイールベース 2660 / 前OH 900 / 後OH 840
  タイヤ 225/60R18 (直径727mm) / 最低地上高 190

■ 座標
  X=幅(±) Y=長さ(前が+) Z=高さ。原点は接地面の中心。
  glTF へは export_yup=True で書き出す。

■ 実行
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/blender/car2_build.py
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                   'assets', 'models', 'context', 'car_crossover.glb')

L, W, H = 4.40, 1.80, 1.63
HL, HW = L / 2, W / 2
AXLE_F, AXLE_R = 1.30, -1.36
TIRE_R, TIRE_W = 0.3636, 0.225
ARCH_R = TIRE_R + 0.038
GROUND = 0.19                    # 最低地上高(ロッカー下端)


# ── 三面図 ────────────────────────────────────────────────────
# 側面図: トップライン。y(長さ) → z(高さ)
TOP_LINE = [
    (-2.200, 0.870), (-2.100, 0.980), (-1.980, 1.110), (-1.850, 1.265),
    (-1.660, 1.395), (-1.440, 1.535), (-1.220, 1.594), (-0.850, 1.615),
    (0.000, 1.605), (0.150, 1.585), (0.300, 1.530), (0.550, 1.360),
    (0.900, 1.100), (0.980, 1.030), (1.200, 1.010), (1.600, 0.985),
    (1.950, 0.965), (2.100, 0.900), (2.200, 0.780),
]
# 側面図: ベルトライン(ショルダー)。y → z。後ろへ向かって上げると
# 現代的な佇まいになる(逆に前下がりだと古い車に見える)
BELT_LINE = [
    (-2.200, 0.780), (-2.050, 0.920), (-1.800, 1.045), (-1.500, 1.060),
    (-1.100, 1.030), (-0.400, 1.010), (0.300, 1.000), (0.950, 0.985),
    (1.400, 0.945), (1.850, 0.900), (2.050, 0.860), (2.200, 0.740),
]
# 平面図: ショルダーでの半幅。y → x
PLAN_HW = [
    (-2.200, 0.740), (-2.100, 0.790), (-1.900, 0.848), (-1.500, 0.888),
    (-1.000, 0.898), (0.000, 0.900), (0.900, 0.897), (1.350, 0.884),
    (1.900, 0.856), (2.060, 0.812), (2.200, 0.760),
]
# 平面図: ルーフ(ノーズではボンネット、テールではデッキ)での半幅。y → x
PLAN_HW_ROOF = [
    (-2.200, 0.540), (-2.050, 0.620), (-1.800, 0.660), (-1.500, 0.700),
    (-1.200, 0.720), (0.200, 0.720), (0.600, 0.735), (0.950, 0.770),
    (1.200, 0.790), (1.800, 0.780), (2.050, 0.700), (2.200, 0.560),
]
# 側面図: ロッカー(サイドシル)下端。前後で持ち上げて進入角/離脱角を作る
ROCKER_Z = [
    (-2.200, 0.360), (-2.050, 0.280), (-1.750, 0.205), (-1.000, 0.190),
    (1.000, 0.190), (1.750, 0.205), (2.050, 0.255), (2.200, 0.330),
]

# キャビン(ガラスが張れる範囲)と、ガラスにしないピラーの帯
CABIN_Y = (-2.060, 0.980)
PILLARS = [(0.860, 0.995), (-0.120, 0.030), (-1.440, -1.290)]

# ステーション。ピラーの位置に必ず線が来るよう不等間隔で置く
STATION_Y = [
    2.200, 2.196, 2.150, 2.060, 1.930, 1.780, 1.600, 1.400, 1.200,
    1.060, 0.995, 0.930, 0.860, 0.760, 0.620, 0.460, 0.300, 0.150,
    0.030, -0.050, -0.120, -0.300, -0.500, -0.720, -0.950, -1.150,
    -1.330, -1.420, -1.500, -1.620, -1.760, -1.900, -2.030, -2.140,
    -2.196, -2.200,
]


def lerp_table(table, y):
    """キー付きの折れ線を線形補間する。表の外は端の値で止める。"""
    if y <= table[0][0]:
        return table[0][1]
    if y >= table[-1][0]:
        return table[-1][1]
    for i in range(len(table) - 1):
        y0, v0 = table[i]
        y1, v1 = table[i + 1]
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0) if y1 > y0 else 0.0
            return v0 + (v1 - v0) * t
    return table[-1][1]


def ring_points(y):
    """1ステーションの断面(半分)。下端中心 → 外 → ショルダー → ルーフ中心。

    ショルダーの前後に支持ループを寄せてキャラクターラインを立てる。
    これが無いとサブディビジョンで肩が丸まり、石鹸のような塊になる。
    """
    hw = lerp_table(PLAN_HW, y)
    hwr = lerp_table(PLAN_HW_ROOF, y)
    z0 = lerp_table(ROCKER_Z, y)
    zsh = lerp_table(BELT_LINE, y)
    zt = lerp_table(TOP_LINE, y)
    if zt - zsh < 0.05:                 # ノーズ・テールは肩と天端がほぼ同じ
        zsh = zt - 0.05
    pts = [
        (0.0, z0 - 0.015),
        (hw * 0.52, z0 - 0.010),
        (hw * 0.86, z0 + 0.008),
        (hw * 0.965, z0 + 0.075),        # ロッカー外面
        (hw * 0.995, z0 + (zsh - z0) * 0.40),
        (hw * 1.000, zsh - 0.090),
        (hw * 0.999, zsh - 0.030),       # 支持ループ(下)
        (hw * 0.988, zsh - 0.004),       # ショルダー(稜線)
        (hw * 0.955, zsh + 0.020),       # 支持ループ(上)。ここで一気に絞る
        (hwr * 1.045, zsh + 0.055),      # ガラス下端
        (hwr * 1.020, zsh + (zt - zsh) * 0.38),
        (hwr * 1.000, zsh + (zt - zsh) * 0.72),
        (hwr * 0.985, zt - 0.055),       # ルーフ肩
        (hwr * 0.930, zt - 0.018),
        (hwr * 0.640, zt - 0.003),
        (0.0, zt),
    ]
    return pts


def build_body():
    me = bpy.data.meshes.new('car_body')
    bm = bmesh.new()
    rings = []
    for y in STATION_Y:
        half = ring_points(y)
        # 右半分 + 左半分(中心の2点は共有)
        full = [(x, y, z) for (x, z) in half]
        full += [(-x, y, z) for (x, z) in reversed(half[1:-1])]
        rings.append([bm.verts.new(p) for p in full])
    n = len(rings[0])
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(n):
            bm.faces.new((r0[j], r0[(j + 1) % n], r1[(j + 1) % n], r1[j]))
    bm.faces.new(tuple(reversed(rings[0])))     # ノーズの蓋
    bm.faces.new(tuple(rings[-1]))              # テールの蓋
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('car_body', me)
    bpy.context.collection.objects.link(ob)
    return ob


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


def mat(name, color, rough=0.5, metal=0.0, alpha=1.0, coat=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    for key, val in (('Coat Weight', coat), ('Coat Roughness', 0.08)):
        if key in b.inputs and val:
            b.inputs[key].default_value = val
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if emit:
        if 'Emission Color' in b.inputs:
            b.inputs['Emission Color'].default_value = (color[0], color[1], color[2], 1.0)
        if 'Emission Strength' in b.inputs:
            b.inputs['Emission Strength'].default_value = emit
    return m


def assign_materials(ob):
    """面の位置からマテリアルを振る。

    ガラス・ランプ・グリルを別メッシュで足すと、必ず面から浮くか刺さる。
    **同じ1枚の面のマテリアルを差し替える**なら、原理的に浮きようがない。
    浮いて見えるパーツを後から位置合わせするより、こちらの方が確実に速い。
    """
    BODY = mat('CarBody', hex_lin('#E4E6EA'), rough=0.28, metal=0.10, coat=0.7)
    GLASS = mat('CarGlass', hex_lin('#2A3038'), rough=0.08, metal=0.30)
    CLAD = mat('CarLower', hex_lin('#3B3F44'), rough=0.75)
    HEAD = mat('CarHeadlight', hex_lin('#DCE6F2'), rough=0.10, metal=0.30, emit=0.6)
    TAIL = mat('CarTaillight', hex_lin('#B01F27'), rough=0.25, emit=0.5)
    GRILLE = mat('CarGrille', hex_lin('#2B2E33'), rough=0.45)
    ob.data.materials.clear()   # ブーリアン由来の空スロットを消してから積む
    for m in (BODY, GLASS, CLAD, HEAD, TAIL, GRILLE):
        ob.data.materials.append(m)
    counts = {}
    for p in ob.data.polygons:
        c = p.center  # ローカル座標(X=幅 Y=長さ Z=高さ)
        x, y, z = abs(c.x), c.y, c.z
        zt = lerp_table(TOP_LINE, y)
        zb = lerp_table(BELT_LINE, y)
        idx = 0
        if y > 1.900 and 0.500 < z < 0.790 and x < 0.560:
            idx = 5                                  # フロントグリル
        elif y > 1.880 and 0.840 < z < 0.985 and 0.30 < x < 0.80:
            idx = 3                                  # ヘッドランプ
        elif y < -1.930 and 1.010 < z < 1.170 and 0.26 < x < 0.80:
            idx = 4                                  # テールランプ
        elif z < lerp_table(ROCKER_Z, y) + 0.150:
            idx = 2                                  # 下まわりの樹脂クラッディング
        elif CABIN_Y[0] <= y <= CABIN_Y[1] and zb + 0.030 < z < zt - 0.045:
            if not any(a <= y <= b for (a, b) in PILLARS):
                idx = 1                              # ガラス
        p.material_index = idx
        counts[idx] = counts.get(idx, 0) + 1
    _report_counts(counts)


def _report_counts(counts):
    names = ['body', 'glass', 'clad', 'head', 'tail', 'grille']
    print('[car2] faces ' + ' '.join('%s=%d' % (n, counts.get(i, 0))
                                     for i, n in enumerate(names)))


def revolve(profile, segments, axis_y, half_width_sign, name, material):
    """(半径, 幅方向オフセット) の断面をY軸まわりに回してタイヤ/リムを作る。"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((half_width_sign * off, axis_y + r * sa, TIRE_R + r * ca))
                      for (r, off) in profile])
    m = len(profile)
    for k in range(segments):
        r0, r1 = rings[k], rings[(k + 1) % segments]
        for j in range(m - 1):
            bm.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def build_wheel(y, sign, tire_m, rim_m, hub_m):
    """タイヤ(断面を回す) + リム(ディスク+5本スポーク)。"""
    inner = HW - 0.075                 # トレッド外側
    outer = inner
    w = TIRE_W
    # 断面: (半径, 幅オフセット)。外側から内側へ、ショルダーを丸める
    R = TIRE_R
    prof = [
        (R - 0.105, outer - w * 0.02),
        (R - 0.020, outer - w * 0.02),
        (R - 0.004, outer - w * 0.10),
        (R, outer - w * 0.30),
        (R, outer - w * 0.70),
        (R - 0.004, outer - w * 0.90),
        (R - 0.020, outer - w * 0.98),
        (R - 0.105, outer - w * 0.98),
    ]
    tire = revolve(prof, 30, y, sign, 'car_tire_%d_%d' % (int(y * 100), sign), tire_m)

    objs = [tire]
    # リムのリップ(外周)
    rim_r = R - 0.100
    lip = [
        (rim_r, outer - w * 0.03),
        (rim_r - 0.012, outer - w * 0.03),
        (rim_r - 0.012, outer - w * 0.55),
        (rim_r, outer - w * 0.55),
    ]
    objs.append(revolve(lip, 30, y, sign, 'car_rimlip_%d_%d' % (int(y * 100), sign), rim_m))
    # ディスク面(奥まった皿) + ハブ
    disc = [
        (rim_r - 0.010, outer - w * 0.22),
        (rim_r * 0.30, outer - w * 0.30),
        (0.001, outer - w * 0.32),
    ]
    objs.append(revolve(disc, 30, y, sign, 'car_rimdisc_%d_%d' % (int(y * 100), sign), rim_m))
    # スポーク(5本)。皿の上に薄い板を放射状に置く
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.radians(18)
        me = bpy.data.meshes.new('car_spoke')
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((0.030, rim_r * 0.86, 0.055)), verts=bm.verts)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector((0, 0, 0)),
                         matrix=_rot_x(a))
        bmesh.ops.translate(bm, verts=bm.verts,
                            vec=Vector((sign * (outer - w * 0.25), y, TIRE_R)))
        # スポークはリム中心から外へ伸ばす(回転後の向きに合わせて押し出す)
        bm.to_mesh(me)
        bm.free()
        sp = bpy.data.objects.new('car_spoke', me)
        bpy.context.collection.objects.link(sp)
        sp.data.materials.append(hub_m)
        objs.append(sp)
    return objs


def _rot_x(a):
    from mathutils import Matrix
    return Matrix.Rotation(a, 3, 'X')


def box(name, center, size, material, rot_x=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot_x:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector((0, 0, 0)), matrix=_rot_x(rot_x))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    body = build_body()
    # ホイールアーチを円柱で抜く
    for i, ay in enumerate((AXLE_F, AXLE_R)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ARCH_R, depth=W + 0.6,
                                            location=(0, ay, TIRE_R),
                                            rotation=(0, math.radians(90), 0))
        cutter = bpy.context.object
        boo = body.modifiers.new('A%d' % i, 'BOOLEAN')
        boo.operation = 'DIFFERENCE'
        boo.object = cutter
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=boo.name)
        bpy.data.objects.remove(cutter, do_unlink=True)

    sub = body.modifiers.new('Sub', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=sub.name)
    assign_materials(body)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(34))

    TIRE = mat('CarTire', hex_lin('#26272A'), rough=0.95)
    RIM = mat('CarRim', hex_lin('#C6C8CC'), rough=0.30, metal=0.75)
    HUB = mat('CarRimSpoke', hex_lin('#B8BABE'), rough=0.35, metal=0.70)
    TRIM = mat('CarTrim', hex_lin('#33363B'), rough=0.55)
    HEAD = mat('CarHeadlight', (0.80, 0.84, 0.92), rough=0.12, metal=0.25, emit=0.9)
    TAIL = mat('CarTaillight', (0.42, 0.030, 0.045), rough=0.30, emit=0.7)
    CHROME = mat('CarChrome', hex_lin('#D2D4D8'), rough=0.14, metal=1.0)

    parts = []
    for ay in (AXLE_F, AXLE_R):
        for sign in (1, -1):
            parts += build_wheel(ay, sign, TIRE, RIM, HUB)

    # ヘッドライト(左右)・テールランプ(左右)。面に沿わせるため薄く傾ける
    # ランプ・グリルは面のマテリアルで表す(assign_materials)。
    # ここで足すのは、面から出ていることに意味がある物だけ。
    for sx in (1, -1):
        parts.append(box('car_mirror_%d' % sx, (sx * 0.935, 0.830, 1.062),
                         (0.085, 0.175, 0.090), TRIM))
    parts.append(box('car_skid_f', (0.0, 2.020, 0.325), (0.80, 0.12, 0.048), CHROME))
    parts.append(box('car_skid_r', (0.0, -1.985, 0.352), (0.78, 0.12, 0.048), CHROME))
    # ルーフレール
    for sx in (1, -1):
        parts.append(box('car_rail_%d' % sx, (sx * 0.600, -0.55, 1.600),
                         (0.048, 1.55, 0.042), TRIM))

    bpy.ops.object.select_all(action='DESELECT')
    for o in [body] + parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    car = bpy.context.object
    car.name = 'car_crossover'

    per = {}
    for p in car.data.polygons:
        m0 = car.data.materials[p.material_index] if p.material_index < len(car.data.materials) else None
        nm = m0.name if m0 else '(empty)'
        per[nm] = per.get(nm, 0) + 1
    print('[car2] after join: %s' % sorted(per.items(), key=lambda kv: -kv[1]))
    tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
    bb = [Vector(c) for c in car.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    print('[car2] tris=%d bbox=%.3f x %.3f x %.3f (z %.3f..%.3f)'
          % (tris, mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, mn.z, mx.z))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    car.select_set(True)
    bpy.context.view_layer.objects.active = car
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True)
    print('[car2] wrote %s' % OUT)


if __name__ == '__main__':
    main()
