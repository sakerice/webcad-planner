import bpy, bmesh, math
from mathutils import Vector

def matp(name, color, rough=0.5, metal=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m

for ob in list(bpy.data.objects):
    if ob.name.startswith('car_'):
        bpy.data.objects.remove(ob, do_unlink=True)

BODY = matp('CarBody', (0.90, 0.90, 0.91), rough=0.30, metal=0.15)
try:
    b = BODY.node_tree.nodes['Principled BSDF']
    b.inputs['Coat Weight'].default_value = 0.6
    b.inputs['Coat Roughness'].default_value = 0.10
except Exception:
    pass
GLASS = matp('CarGlass', (0.05, 0.06, 0.07), rough=0.10, metal=0.25)
TRIM  = matp('CarTrim', (0.06, 0.06, 0.07), rough=0.55)
TIRE  = matp('CarTire', (0.03, 0.03, 0.035), rough=0.95)
RIM   = matp('CarRim', (0.30, 0.31, 0.33), rough=0.38, metal=0.55)
RIMLIP= matp('CarRimLip', (0.78, 0.79, 0.81), rough=0.25, metal=0.5)
HEAD  = matp('CarHeadlight', (0.085, 0.095, 0.115), rough=0.5, metal=0.05)
DRLW  = matp('CarDrl', (0.95, 0.97, 1.0), rough=0.2)
try:
    db = DRLW.node_tree.nodes['Principled BSDF']
    db.inputs['Emission Color'].default_value = (0.95, 0.97, 1.0, 1.0)
    db.inputs['Emission Strength'].default_value = 4.5
except Exception:
    pass
try:
    hb = HEAD.node_tree.nodes['Principled BSDF']
    hb.inputs['Emission Strength'].default_value = 0.0
except Exception:
    pass
TAIL  = matp('CarTaillight', (0.05, 0.002, 0.004), rough=0.6)
PLATE = matp('CarPlate', (0.92, 0.92, 0.9), rough=0.5)
CHROME= matp('CarChrome', (0.55, 0.56, 0.58), rough=0.15, metal=1.0)

# ---- カローラセダン実寸: 4495 x 1745 x 1435, WB2640 ----
L, W, H = 4.495, 1.745, 1.435
HL, HW = L/2, W/2
AXLE_F, AXLE_R = HL-0.925, -HL+0.88
WHEEL_R, ARCH_R, TIRE_W = 0.318, 0.34, 0.205
AXLE_Z = 0.318
Z_DROP = 0.0   # ローダウン量(ボディ側を下げる)

# ボディロフト(ベルトラインまで)。カローラの卵型ノーズ+低いボンネット+短いデッキ
STATIONS = [
    ( 2.2475, 0.68, 0.17, 0.50, 0.014),
    ( 2.2473, 0.685, 0.168, 0.502, 0.015),
    ( 2.2460, 0.72, 0.15, 0.515, 0.020),
    ( 2.2150, 0.80, 0.14, 0.55, 0.028),
    ( 2.0800, 0.88, 0.135, 0.59, 0.038),
    ( 1.8200, 0.94, 0.13, 0.628, 0.046),
    ( 1.3500, 0.99, 0.13, 0.66, 0.052),
    ( 0.7000, 1.005, 0.13, 0.775, 0.050),
    (-0.2000, 1.005, 0.13, 0.825, 0.048),
    (-1.0000, 1.00, 0.13, 0.865, 0.044),
    (-1.6000, 0.975, 0.14, 0.90, 0.038),
    (-2.0500, 0.92, 0.19, 0.905, 0.030),
    (-2.2465, 0.875, 0.16, 0.875, 0.026),
    (-2.2473, 0.862, 0.152, 0.857, 0.024),
    (-2.2475, 0.858, 0.15, 0.855, 0.024),
]
def ring_points(hw_s, zb, zt, crown):
    hw = HW * hw_s
    pts = [
        (0.0, zb), (hw*0.82, zb),
        (hw*0.97, zb + (zt-zb)*0.18),
        (hw*1.00, zb + (zt-zb)*0.52),
        (hw*0.995, zt - 0.012),
        (hw*0.93, zt + crown*0.55),
        (hw*0.45, zt + crown), (0.0, zt + crown),
    ]
    return pts + [(-x, z) for (x, z) in reversed(pts[1:-1])]
mesh = bpy.data.meshes.new('car_body')
bm = bmesh.new()
rings = []
for (y, s, zb, zt, crown) in STATIONS:
    rings.append([bm.verts.new((x, y, z)) for (x, z) in ring_points(s, zb, zt, crown)])
n = len(rings[0])
for i in range(len(rings) - 1):
    r0, r1 = rings[i], rings[i+1]
    for j in range(n):
        bm.faces.new((r0[j], r0[(j+1) % n], r1[(j+1) % n], r1[j]))
bm.faces.new(tuple(reversed(rings[0])))
bm.faces.new(tuple(rings[-1]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(mesh); bm.free()
body = bpy.data.objects.new('car_body', mesh)
bpy.context.scene.collection.objects.link(body)
body.data.materials.append(BODY)
sub = body.modifiers.new('Sub', 'SUBSURF'); sub.levels = 2
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=sub.name)
for i, ay in enumerate((AXLE_F, AXLE_R)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=ARCH_R, depth=W+0.5,
        location=(0, ay, AXLE_Z + Z_DROP), rotation=(0, math.radians(90), 0))
    cutter = bpy.context.object
    boo = body.modifiers.new('A%d' % i, 'BOOLEAN')
    boo.operation = 'DIFFERENCE'; boo.object = cutter
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=boo.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))

# ---- キャノピー: ダークガラスのロフト + ルーフ塗装(面割当) + 白ピラー ----
# (y, 幅スケール, 上端z)。ファストバック気味のカローラのルーフライン
GH = [
    ( 1.15, 0.875, 0.80),
    ( 1.10, 0.870, 0.83),
    ( 0.38, 0.845, 1.29),
    (-0.10, 0.835, 1.385),
    (-0.75, 0.835, 1.385),
    (-1.12, 0.795, 1.29),
    (-1.50, 0.76, 0.94),
    (-1.60, 0.75, 0.84)
]
def gh_ring(hw_s, z):
    hw = HW * hw_s
    zl = 0.775
    pts = [(0.0, zl), (hw*0.975, zl), (hw*0.985, zl + (z-zl)*0.30), (hw*0.90, z - 0.004), (hw*0.5, z + 0.008), (0.0, z + 0.011)]
    return pts + [(-x, zz) for (x, zz) in reversed(pts[1:-1])]
mesh2 = bpy.data.meshes.new('car_glasshouse')
bm = bmesh.new()
rings = []
for (y, s, z) in GH:
    rings.append([bm.verts.new((x, y, zz)) for (x, zz) in gh_ring(s, z)])
n = len(rings[0])
for i in range(len(rings) - 1):
    r0, r1 = rings[i], rings[i+1]
    for j in range(n):
        bm.faces.new((r0[j], r0[(j+1) % n], r1[(j+1) % n], r1[j]))
bm.faces.new(tuple(reversed(rings[0])))
bm.faces.new(tuple(rings[-1]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(mesh2); bm.free()
gh = bpy.data.objects.new('car_glasshouse', mesh2)
bpy.context.scene.collection.objects.link(gh)
gh.data.materials.append(GLASS)
gh.data.materials.append(BODY)
gh.data.materials.append(TRIM)
sub = gh.modifiers.new('Sub', 'SUBSURF'); sub.levels = 2
bpy.context.view_layer.objects.active = gh
bpy.ops.object.modifier_apply(modifier=sub.name)
# 面割当: ルーフ/A・Cピラー=ボディ白, Bピラー=黒, その他=ガラス
def ghw_raw(y):
    for i in range(len(GH)-1):
        (y0,s0,_),(y1,s1,_)=GH[i],GH[i+1]
        if y1<=y<=y0:
            t=(y-y0)/(y1-y0) if y1!=y0 else 0
            return HW*(s0+(s1-s0)*t)
    return HW*(GH[0][1] if y>GH[0][0] else GH[-1][1])
for poly in gh.data.polygons:
    c = poly.center; n = poly.normal
    w_here = max(0.001, ghw_raw(c.y))
    edge = abs(c.x) / w_here
    mi = 0
    if n.y > 0.30:                   # フロントスロープ(ルーフ判定より優先)
        mi = 2 if edge > 0.80 else 0 # Aピラー(黒) / ウィンドシールド
    elif n.y < -0.30:                # リアスロープ
        mi = 1 if edge > 0.74 else 0 # Cピラー / リアガラス
    elif c.z > 1.26 and n.z > 0.75 and -0.70 < c.y < 0.17 and n.y > -0.25:
        mi = 1                       # 塗装ルーフ
    elif abs(n.x) > 0.45:            # サイド
        if c.y < -1.02:
            mi = 1                   # クォーター(C)
        elif c.y > 0.90:
            mi = 0                   # ウィンドシールド回り込み(ガラス)
        elif -0.44 < c.y < -0.31:
            mi = 2                   # Bピラー(黒)
        else:
            mi = 0                   # ドアガラス
    poly.material_index = mi
bpy.ops.object.select_all(action='DESELECT')
gh.select_set(True); bpy.context.view_layer.objects.active = gh
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

def add_box(name, mat, x, y, z, sx, sy, sz, rx=0, ry=0, rz=0, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z), rotation=(rx, ry, rz))
    ob = bpy.context.object; ob.name = name
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new('B', 'BEVEL'); bv.width = bevel; bv.segments = 2
    return ob

# ---- ホイール ----
def build_wheel(name, x, y, s):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=WHEEL_R, depth=TIRE_W,
        location=(x, y, WHEEL_R), rotation=(0, math.radians(90), 0))
    t = bpy.context.object; t.name = name + '_tire'
    t.data.materials.append(TIRE)
    bv = t.modifiers.new('B', 'BEVEL'); bv.width = 0.05; bv.segments = 4
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    # ディスク面(暗色)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=WHEEL_R*0.58, depth=0.022,
        location=(x + s*(TIRE_W/2 - 0.028), y, WHEEL_R), rotation=(0, math.radians(90), 0))
    r = bpy.context.object; r.name = name + '_rim'
    r.data.materials.append(TRIM)
    # リム外周リング(明るいアルミ)
    bpy.ops.mesh.primitive_torus_add(major_segments=32, minor_segments=8,
        major_radius=WHEEL_R*0.62, minor_radius=0.020,
        location=(x + s*(TIRE_W/2 - 0.014), y, WHEEL_R), rotation=(0, math.radians(90), 0))
    ring = bpy.context.object; ring.name = name + '_ring'
    ring.data.materials.append(RIMLIP)
    bpy.ops.object.shade_smooth()
    # 5スポーク(明色ブレード、リングまで届かせる)
    for k in range(5):
        a = k * math.tau / 5
        add_box(name + '_sp%d' % k, RIM,
            x + s*(TIRE_W/2 - 0.008),
            y + math.sin(a)*WHEEL_R*0.33, WHEEL_R + math.cos(a)*WHEEL_R*0.33,
            0.020, WHEEL_R*0.17, WHEEL_R*0.68, rx=-a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=WHEEL_R*0.10, depth=0.030,
        location=(x + s*(TIRE_W/2 - 0.006), y, WHEEL_R), rotation=(0, math.radians(90), 0))
    h = bpy.context.object; h.name = name + '_hub'
    h.data.materials.append(RIM)
for i, ay in enumerate((AXLE_F, AXLE_R)):
    for s in (-1, 1):
        x = s * (HW - TIRE_W/2 - 0.03)
        build_wheel('car_wh%d%d' % (i, max(s,0)), x, ay, s)
for ay in (AXLE_F, AXLE_R):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=ARCH_R-0.012, depth=W-0.6,
        location=(0, ay, AXLE_Z), rotation=(0, math.radians(90), 0))
    tub = bpy.context.object; tub.name = 'car_tub%.0f' % (ay*100)
    tub.data.materials.append(TRIM)

# ---- カローラ流フロント: 薄型ライト+細い上部グリル+大型台形ロアグリル ----
# サブディビジョン後の実測極値(ロフトは公称より内側に縮む)
FE = max(v.co.y for v in body.data.vertices)
RE = min(v.co.y for v in body.data.vertices)
BF = FE  # ファサード前面(実測)
def trapezoid_prism(name, mat, wt, wb, z0, z1, y0, y1):
    """下広がり台形の角柱(y0..y1)"""
    me = bpy.data.meshes.new(name)
    b = bmesh.new()
    pts = [(-wb/2, z0), (wb/2, z0), (wt/2, z1), (-wt/2, z1)]
    v0 = [b.verts.new((x, y0, z)) for (x, z) in pts]
    v1 = [b.verts.new((x, y1, z)) for (x, z) in pts]
    b.faces.new(v0); b.faces.new(tuple(reversed(v1)))
    for i in range(4):
        b.faces.new((v0[i], v0[(i+1)%4], v1[(i+1)%4], v1[i]))
    bmesh.ops.recalc_face_normals(b, faces=b.faces[:])
    b.to_mesh(me); b.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat: ob.data.materials.append(mat)
    return ob

# 下広がり台形グリル開口をボディに彫る
cutg = trapezoid_prism('car_gcut', None, 0.72, 1.12, 0.19, 0.385, 2.05, 2.40)
boo = body.modifiers.new('GC', 'BOOLEAN'); boo.operation = 'DIFFERENCE'; boo.object = cutg
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=boo.name)
bpy.data.objects.remove(cutg, do_unlink=True)
# 奥のグリルメッシュパネル(台形)
GMESH = matp('CarGrilleMesh', (0.045, 0.05, 0.055), rough=0.9)
trapezoid_prism('car_grille', GMESH, 0.70, 1.10, 0.195, 0.38, 2.13, 2.16)
# 水平メッシュバー(開口内、上に行くほど短く)
SLAT = matp('CarSlat', (0.16, 0.17, 0.19), rough=0.6, metal=0.25)
for i, zz in enumerate((0.225, 0.27, 0.315)):
    ww = 1.08 - (zz - 0.19) * (1.12 - 0.72) / (0.385 - 0.19)
    add_box('car_slat%d' % i, SLAT, 0, 2.168, zz, ww, 0.012, 0.016, bevel=0.004)
# ナンバープレート(グリル中央マウント)
add_box('car_platebk_f', TRIM, 0, 2.196, 0.295, 0.34, 0.010, 0.165)
add_box('car_plate_f', PLATE, 0, 2.203, 0.295, 0.30, 0.012, 0.14)
# 下端シルバーリップ
LIP = matp('CarLip', (0.68, 0.69, 0.71), rough=0.4, metal=0.5)
add_box('car_lip_f', LIP, 0, BF-0.004, 0.172, 1.18, 0.018, 0.032, bevel=0.008)
# ノーズバーのエンブレム
# ウェッジ型ヘッドライト(フェンダーへ回り込み、フード面と面一)
for s in (-1, 1):
    # コーナーを跨ぐ一体ラップアラウンド灯具
    add_box('car_head%d' % max(s,0), HEAD, s*0.60, 2.01, 0.448, 0.60, 0.18, 0.078,
            rx=math.radians(-6), rz=math.radians(-32*s), ry=math.radians(4*s), bevel=0.014)
    add_box('car_drl%d' % max(s,0), DRLW, s*0.605, 2.05, 0.421, 0.54, 0.085, 0.013,
            rx=math.radians(-6), rz=math.radians(-32*s), ry=math.radians(4*s))
    # ノーズバー上の水平スリムライト帯(顔の「目」)— 実測FE基準で前面から出す
    add_box('car_headband%d' % max(s,0), HEAD, s*0.43, FE-0.026, 0.445, 0.58, 0.16, 0.068,
            rz=math.radians(-7*s), ry=math.radians(3*s), bevel=0.012)
    # コーナー稜線を跨ぐ接続ピース
    add_box('car_headjoin%d' % max(s,0), HEAD, s*0.615, 2.10, 0.445, 0.24, 0.17, 0.066,
            rz=math.radians(-20*s), bevel=0.012)
    add_box('car_drlband%d' % max(s,0), DRLW, s*0.415, FE-0.014, 0.418, 0.50, 0.07, 0.012,
            rz=math.radians(-7*s), ry=math.radians(3*s))
# バンパー下端の黒スカート帯(フラッシュ)
add_box('car_skirt_f', TRIM, 0, BF-0.020, 0.205, 1.04, 0.014, 0.06, bevel=0.006)
# ---- リア: 横長テール(コーナー回り込み)+メッキガーニッシュ ----
BR = RE  # リアファサード(実測)
# ダックテールリップ(デッキ後端)
add_box('car_ducktail', BODY, 0, -2.21, 0.897, 1.02, 0.12, 0.030, rx=math.radians(-18), bevel=0.010)
# 全幅テールベース(暗色)+左右レンズ+クォーター回り込み
add_box('car_tailbase', TRIM, 0, BR-0.002, 0.74, 1.06, 0.018, 0.080, bevel=0.008)
for s in (-1, 1):
    add_box('car_tail%d' % max(s,0), TAIL, s*0.42, BR-0.008, 0.742, 0.44, 0.012, 0.056, bevel=0.006)
    # クォーターパネル側面への回り込みレンズ
    add_box('car_tailq%d' % max(s,0), TAIL, s*0.725, -2.135, 0.742, 0.045, 0.16, 0.050, rz=math.radians(14*s), bevel=0.008)
# ナンバープレート(トランク中央の彫り込み風: 暗色バッキング+プレート)
add_box('car_plate_r', PLATE, 0, BR-0.006, 0.53, 0.32, 0.012, 0.16)
# リアバンパー下端の暗色バランス
add_box('car_valance_r', TRIM, 0, BR+0.004, 0.205, 1.20, 0.014, 0.042, bevel=0.006)
# トヨタエンブレム(リア)
bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.045, depth=0.016, location=(0, BR-0.002, 0.70), rotation=(math.radians(95), 0, 0))
remb = bpy.context.object; remb.name = 'car_emblem_r'
remb.scale = (1.0, 0.7, 1.0)
bpy.ops.object.transform_apply(scale=True)
remb.data.materials.append(CHROME)
# ---- 共通ディテール ----
for s in (-1, 1):
    add_box('car_mirarm%d' % max(s,0), TRIM, s*0.905, 0.85, 0.825, 0.13, 0.036, 0.030)
    add_box('car_mirror%d' % max(s,0), BODY, s*0.955, 0.845, 0.855, 0.085, 0.15, 0.095, rz=math.radians(6*s), bevel=0.018)
    add_box('car_mirglass%d' % max(s,0), GLASS, s*0.955, 0.768, 0.855, 0.070, 0.012, 0.080, rz=math.radians(6*s))
# パネル分割: ボディに直接ブーリアンで溝を切る(浮遊線の根絶)
def groove(y, z, sy, sz):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, y, z))
    c = bpy.context.object
    c.scale = (W+0.4, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    boo = body.modifiers.new('G', 'BOOLEAN')
    boo.operation = 'DIFFERENCE'; boo.object = c
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=boo.name)
    bpy.data.objects.remove(c, do_unlink=True)
groove(0.78, 0.44, 0.007, 0.62)    # フロントドア前縁
groove(-0.03, 0.44, 0.007, 0.62)   # ドア間
groove(-0.92, 0.44, 0.007, 0.62)   # リアドア後縁
groove(1.17, 0.78, 0.007, 0.10)   # ボンネット後端
groove(-1.52, 0.905, 0.007, 0.09)  # トランク前端
# ドアハンドル: ボディ表面にレイキャストして面上に配置
dg = bpy.context.evaluated_depsgraph_get()
for s in (-1, 1):
    for yy in (0.40, -0.40):
        hit, loc, nrm, _ = body.evaluated_get(dg).ray_cast(Vector((s*1.4, yy, 0.70)), Vector((-s, 0, 0)))
        if hit:
            add_box('car_hdl%d%.0f' % (max(s,0), yy*100), TRIM,
                loc.x + s*0.006, yy, loc.z, 0.020, 0.15, 0.028, bevel=0.008)
for s in (-1, 1):
    RSHADE = matp('CarRockerShade', (0.055, 0.06, 0.07), rough=0.95)
    add_box('car_rocker%d' % max(s,0), RSHADE, s*0.744, 0.01, 0.195, 0.010, 1.78, 0.055)
add_box('car_fin', BODY, 0, -1.10, 1.375, 0.036, 0.15, 0.045, rx=math.radians(-12), bevel=0.016)
# ローダウン適用: ホイール(タイヤ/リム/リング/スポーク/ハブ)以外を下げる
for ob in bpy.data.objects:
    if not ob.name.startswith('car_'):
        continue
    if any(k in ob.name for k in ('_tire', '_rim', '_ring', '_sp', '_hub')):
        continue
    ob.location.z -= Z_DROP
print('CAR6_OK', len([o for o in bpy.data.objects if o.name.startswith('car_')]))
