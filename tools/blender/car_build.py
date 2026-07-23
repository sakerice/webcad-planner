import bpy, bmesh, math

def matg(name):
    return bpy.data.materials[name]

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

BODY = matp('CarBody', (0.26, 0.33, 0.42), rough=0.30, metal=0.7)
try:
    bsdf = BODY.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Coat Weight'].default_value = 0.5
    bsdf.inputs['Coat Roughness'].default_value = 0.12
except Exception:
    pass
GLASS = matg('CarGlass'); TRIM = matg('CarTrim')
TIRE = matg('CarTire'); RIM = matg('CarRim')
HEAD = matg('CarHeadlight'); TAIL = matg('CarTaillight'); PLATE = matg('CarPlate')
DRL = matp('CarDRL', (0.85, 0.88, 0.9), rough=0.2, metal=0.1)

W = 1.85
HW = W / 2

# ---------- body loft (subsurf control cage) ----------
STATIONS = [
    ( 2.250, 0.78, 0.34, 0.52, 0.030),
    ( 2.2495, 0.795, 0.30, 0.545, 0.032),
    ( 2.235, 0.845, 0.20, 0.60, 0.036),
    ( 2.150, 0.92, 0.15, 0.65, 0.045),
    ( 1.750, 0.98, 0.13, 0.71, 0.055),
    ( 1.100, 1.005, 0.13, 0.775, 0.060),
    ( 0.300, 1.005, 0.13, 0.805, 0.058),
    (-0.700, 1.005, 0.13, 0.845, 0.058),
    (-1.500, 0.995, 0.13, 0.875, 0.050),
    (-2.050, 0.94, 0.16, 0.875, 0.042),
    (-2.235, 0.865, 0.22, 0.81, 0.035),
    (-2.2495, 0.815, 0.30, 0.735, 0.031),
    (-2.250, 0.80, 0.34, 0.71, 0.030),
]
def ring_points(hw_s, zb, zt, crown):
    hw = HW * hw_s
    pts = [
        (0.0, zb), (hw*0.82, zb),
        (hw*0.97, zb + (zt-zb)*0.20),
        (hw*1.00, zb + (zt-zb)*0.52),
        (hw*0.99, zt - 0.015),
        (hw*0.91, zt + crown*0.55),
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
sub = body.modifiers.new('Sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=sub.name)

# arches
AXLE_F, AXLE_R, WHEEL_R, ARCH_R, TIRE_W = 1.42, -1.38, 0.31, 0.355, 0.225
AXLE_Z = 0.31
for i, ay in enumerate((AXLE_F, AXLE_R)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=ARCH_R, depth=W+0.5,
        location=(0, ay, AXLE_Z), rotation=(0, math.radians(90), 0))
    cutter = bpy.context.object
    boo = body.modifiers.new('A%d' % i, 'BOOLEAN')
    boo.operation = 'DIFFERENCE'; boo.object = cutter
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=boo.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))

# ---------- greenhouse: glass band + painted roof in one subsurf loft ----------
GH = [
    ( 0.95, 0.87, 0.79),
    ( 0.90, 0.865, 0.82),
    ( 0.32, 0.845, 1.33),
    ( 0.05, 0.835, 1.395),
    (-0.55, 0.835, 1.395),
    (-0.95, 0.825, 1.32),
    (-1.45, 0.795, 0.87),
    (-1.52, 0.79, 0.80),
]
def gh_ring(hw_s, z):
    hw = HW * hw_s
    zl = 0.765
    pts = [(0.0, zl), (hw*0.99, zl), (hw, zl + (z-zl)*0.35), (hw*0.94, z - 0.005), (hw*0.55, z + 0.012), (0.0, z + 0.015)]
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
sub = gh.modifiers.new('Sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
bpy.context.view_layer.objects.active = gh
bpy.ops.object.modifier_apply(modifier=sub.name)
# 上面(ほぼ水平かつ高い位置)だけボディ色=塗装ルーフ
for poly in gh.data.polygons:
    if poly.center.z > 1.30 and poly.normal.z > 0.86:
        poly.material_index = 1
bpy.ops.object.select_all(action='DESELECT')
gh.select_set(True); bpy.context.view_layer.objects.active = gh
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))

def add_box(name, mat, x, y, z, sx, sy, sz, rx=0, ry=0, rz=0, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z), rotation=(rx, ry, rz))
    ob = bpy.context.object; ob.name = name
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new('B', 'BEVEL'); bv.width = bevel; bv.segments = 2
    return ob

# ---------- wheels ----------
def build_wheel(name, x, y, s):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=WHEEL_R, depth=TIRE_W,
        location=(x, y, WHEEL_R), rotation=(0, math.radians(90), 0))
    t = bpy.context.object; t.name = name + '_tire'
    t.data.materials.append(TIRE)
    bv = t.modifiers.new('B', 'BEVEL'); bv.width = 0.055; bv.segments = 4
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=WHEEL_R*0.67, depth=0.026,
        location=(x + s*(TIRE_W/2 - 0.020), y, WHEEL_R), rotation=(0, math.radians(90), 0))
    r = bpy.context.object; r.name = name + '_rim'
    r.data.materials.append(RIM)
    for k in range(5):
        a = k * math.tau / 5
        for da in (-0.055, 0.055):
            add_box(name + '_sp%d%d' % (k, da>0), RIM,
                x + s*(TIRE_W/2 - 0.008),
                y + math.sin(a+da)*WHEEL_R*0.31, WHEEL_R + math.cos(a+da)*WHEEL_R*0.31,
                0.02, WHEEL_R*0.11, WHEEL_R*0.40, rx=-(a+da))
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=WHEEL_R*0.13, depth=0.045,
        location=(x + s*(TIRE_W/2 - 0.000), y, WHEEL_R), rotation=(0, math.radians(90), 0))
    h = bpy.context.object; h.name = name + '_hub'
    h.data.materials.append(TRIM)

for i, ay in enumerate((AXLE_F, AXLE_R)):
    for s in (-1, 1):
        x = s * (HW - TIRE_W/2 - 0.022)
        build_wheel('car_wh%d%d' % (i, max(s,0)), x, ay, s)
for ay in (AXLE_F, AXLE_R):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=ARCH_R-0.012, depth=W-0.62,
        location=(0, ay, AXLE_Z), rotation=(0, math.radians(90), 0))
    tub = bpy.context.object; tub.name = 'car_tub%.0f' % (ay*100)
    tub.data.materials.append(TRIM)

# ---------- fascia details ----------
# スリムヘッドライト+DRLストリップ(ノーズ角に沿わせて回転)
for s in (-1, 1):
    add_box('car_head%d' % max(s,0), HEAD, s*0.58, 2.195, 0.625, 0.42, 0.05, 0.055, rz=math.radians(-10*s), bevel=0.012)
    add_box('car_drl%d' % max(s,0), DRL, s*0.58, 2.202, 0.578, 0.38, 0.04, 0.016, rz=math.radians(-10*s))
# グリルストリップ(ライト間を結ぶ)+下部インテーク
add_box('car_grille', TRIM, 0, 2.232, 0.60, 0.40, 0.025, 0.05, bevel=0.008)
add_box('car_intake', TRIM, 0, 2.205, 0.235, 1.00, 0.03, 0.11, bevel=0.01)
# テール: フルワイドのライトバー+左右レッド
add_box('car_tailbar', TAIL, 0, -2.253, 0.66, 1.38, 0.035, 0.05, bevel=0.01)
for s in (-1, 1):
    add_box('car_tail%d' % max(s,0), TAIL, s*0.585, -2.248, 0.585, 0.30, 0.05, 0.07, rz=math.radians(6*s), bevel=0.012)
# プレート
add_box('car_plate_f', PLATE, 0, 2.235, 0.35, 0.33, 0.012, 0.165)
add_box('car_plate_r', PLATE, 0, -2.263, 0.42, 0.33, 0.012, 0.165)
# ミラー(涙滴形: 球をスケール)
for s in (-1, 1):
    add_box('car_mirarm%d' % max(s,0), TRIM, s*0.855, 0.62, 0.865, 0.13, 0.028, 0.026)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10, radius=0.055, location=(s*0.955, 0.60, 0.885))
    mo = bpy.context.object; mo.name = 'car_mirror%d' % max(s,0)
    mo.scale = (1.0, 0.62, 0.78)
    bpy.ops.object.transform_apply(scale=True)
    mo.data.materials.append(BODY)
    bpy.ops.object.shade_smooth()
# ドア継ぎ目+ハンドル
for s in (-1, 1):
    for yy in (0.72, -0.05, -0.95):
        add_box('car_seamv%d%.0f' % (max(s,0), yy*100), TRIM, s*(HW*0.982), yy, 0.53, 0.012, 0.010, 0.44)
    add_box('car_seamh%d' % max(s,0), TRIM, s*(HW*0.982), -0.15, 0.80, 0.012, 1.75, 0.010)
    for yy in (0.30, -0.55):
        add_box('car_hdl%d%.0f' % (max(s,0), yy*100), TRIM, s*(HW*0.985), yy, 0.715, 0.016, 0.15, 0.028, bevel=0.008)
# アンテナフィン
add_box('car_fin', TRIM, 0, -0.52, 1.415, 0.042, 0.125, 0.038, bevel=0.014)

print('CAR4_OK', len([o for o in bpy.data.objects if o.name.startswith('car_')]))
