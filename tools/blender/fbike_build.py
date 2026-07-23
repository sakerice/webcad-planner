import bpy, math
from mathutils import Vector

def matp(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

for ob in list(bpy.data.objects):
    if ob.name.startswith('bk2_'):
        bpy.data.objects.remove(ob, do_unlink=True)

FRAME = matp('Bk2Frame', (0.78, 0.34, 0.10), rough=0.35, metal=0.3)   # オレンジ
TIRE  = matp('Bk2Tire', (0.04, 0.04, 0.045), rough=0.95)
SILVER= matp('Bk2Silver', (0.75, 0.76, 0.78), rough=0.3, metal=0.85)
DARK  = matp('Bk2Dark', (0.12, 0.12, 0.13), rough=0.6, metal=0.2)
SADDLE= matp('Bk2Saddle', (0.10, 0.09, 0.09), rough=0.8)

WR = 0.20                       # 16インチ相当
FA = Vector((0, 0.50, WR))
RA = Vector((0, -0.50, WR))
SC = Vector((0, -0.33, 0.44))   # シートクラスタ
HB = Vector((0, 0.44, 0.60))    # ヘッド下部(ビーム前端)
BB = Vector((0, -0.24, 0.25))   # ボトムブラケット

def cyl_between(name, mat, p1, p2, r, verts=12):
    p1=Vector(p1); p2=Vector(p2)
    d=p2-p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=((p1+p2)/2))
    ob=bpy.context.object; ob.name=name
    ob.rotation_mode='QUATERNION'
    ob.rotation_quaternion=d.to_track_quat('Z','Y')
    ob.data.materials.append(mat)
    return ob

def wheel(prefix, center):
    bpy.ops.mesh.primitive_torus_add(major_radius=WR-0.012, minor_radius=0.017,
        location=center, rotation=(0, math.radians(90), 0), major_segments=30, minor_segments=8)
    t = bpy.context.object; t.name = prefix + '_tire'
    t.data.materials.append(TIRE)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR-0.026, minor_radius=0.006,
        location=center, rotation=(0, math.radians(90), 0), major_segments=26, minor_segments=6)
    r = bpy.context.object; r.name = prefix + '_rim'
    r.data.materials.append(SILVER)
    for k in range(6):
        a = k * math.tau / 6
        cyl_between(prefix + '_sp%d' % k, SILVER, center,
            (center[0], center[1] + math.cos(a)*(WR-0.03), center[2] + math.sin(a)*(WR-0.03)), 0.0022, 6)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.02, depth=0.06,
        location=center, rotation=(0, math.radians(90), 0))
    h = bpy.context.object; h.name = prefix + '_hub'
    h.data.materials.append(SILVER)
    # フェンダー
    bpy.ops.mesh.primitive_torus_add(major_radius=WR+0.012, minor_radius=0.012,
        location=center, rotation=(0, math.radians(90), 0), major_segments=24, minor_segments=6)
    f = bpy.context.object; f.name = prefix + '_fender'
    f.scale = (1.0, 1.0, 2.2)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center[0], center[1], center[2] - 0.33))
    c = bpy.context.object
    c.scale = (0.6, 0.8, 0.66)
    bpy.ops.object.transform_apply(scale=True)
    boo = f.modifiers.new('C', 'BOOLEAN'); boo.operation = 'DIFFERENCE'; boo.object = c
    bpy.context.view_layer.objects.active = f
    bpy.ops.object.modifier_apply(modifier=boo.name)
    bpy.data.objects.remove(c, do_unlink=True)
    f.data.materials.clear()
    f.data.materials.append(SILVER)

wheel('bk2_wf', FA)
wheel('bk2_wr', RA)

# メインビーム(太い折り畳みフレーム)+ヒンジ
cyl_between('bk2_beam1', FRAME, HB, (0, 0.05, 0.53), 0.030)
cyl_between('bk2_beam2', FRAME, (0, 0.05, 0.53), SC, 0.030)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.05, 0.53))
hin = bpy.context.object; hin.name = 'bk2_hinge'
hin.scale = (0.045, 0.07, 0.09)
bpy.ops.object.transform_apply(scale=True)
hin.data.materials.append(DARK)
# ヘッドチューブ(高い折り畳みステム)+ハンドル
cyl_between('bk2_head', FRAME, (0, HB.y+0.03, HB.z-0.10), (0, 0.42, 1.00), 0.020)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.42, 0.78))
hin2 = bpy.context.object; hin2.name = 'bk2_hinge2'
hin2.scale = (0.04, 0.055, 0.07)
bpy.ops.object.transform_apply(scale=True)
hin2.data.materials.append(DARK)
cyl_between('bk2_bar', SILVER, (-0.24, 0.41, 1.02), (0.24, 0.41, 1.02), 0.011)
for s in (-1, 1):
    cyl_between('bk2_grip%d' % max(s,0), DARK, (s*0.24, 0.41, 1.02), (s*0.28, 0.38, 1.02), 0.014)
# フォーク
cyl_between('bk2_fork_l', SILVER, (0.035, HB.y+0.02, HB.z-0.08), (0.035, FA.y, FA.z), 0.010)
cyl_between('bk2_fork_r', SILVER, (-0.035, HB.y+0.02, HB.z-0.08), (-0.035, FA.y, FA.z), 0.010)
# シートポスト(長い)+サドル
cyl_between('bk2_spost', SILVER, SC, (0, -0.36, 0.86), 0.014)

def build_saddle(name, mat, cx, cy, cz, s=1.0):
    """実物比のサドル: 先細ノーズ+幅広リアのロフト(250x170相当)"""
    import bmesh as _bm
    secs = [
        ( 0.125, 0.018, 0.009, 0.012),
        ( 0.060, 0.030, 0.015, 0.004),
        (-0.020, 0.052, 0.020, 0.000),
        (-0.075, 0.083, 0.024, 0.006),
        (-0.115, 0.060, 0.019, 0.014),
    ]
    mesh = bpy.data.meshes.new(name)
    bm = _bm.new()
    rings = []
    for (dy, hw_, hh, dz) in secs:
        ring = []
        for k in range(12):
            a = k * math.tau / 12
            ring.append(bm.verts.new((cx + math.cos(a)*hw_*s, cy + dy*s, cz + dz*s + math.sin(a)*hh*s)))
        rings.append(ring)
    n = 12
    for i in range(len(rings)-1):
        for j in range(n):
            bm.faces.new((rings[i][j], rings[i][(j+1)%n], rings[i+1][(j+1)%n], rings[i+1][j]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[-1]))
    _bm.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh); bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    sub = ob.modifiers.new('S', 'SUBSURF'); sub.levels = 1
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=sub.name)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.shade_smooth()
    return ob

build_saddle('bk2_saddle', SADDLE, 0, -0.37, 0.885, 0.92)
# リア三角+BB+クランク
for s in (-1, 1):
    cyl_between('bk2_cs%d' % max(s,0), FRAME, (s*0.025, SC.y, SC.z-0.02), (s*0.04, RA.y, RA.z), 0.009)
    cyl_between('bk2_cs2%d' % max(s,0), FRAME, (s*0.025, BB.y, BB.z), (s*0.04, RA.y, RA.z), 0.009)
cyl_between('bk2_st', FRAME, SC, BB, 0.016)
bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.014, depth=0.11,
    location=BB, rotation=(0, math.radians(90), 0))
crk = bpy.context.object; crk.name = 'bk2_crankaxle'; crk.data.materials.append(SILVER)
for s in (-1, 1):
    cyl_between('bk2_crank%d' % max(s,0), DARK, (s*0.055, BB.y, BB.z), (s*0.055, BB.y + s*0.11, BB.z - s*0.04), 0.008)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(s*0.09, BB.y + s*0.11, BB.z - s*0.04))
    ped = bpy.context.object; ped.name = 'bk2_pedal%d' % max(s,0)
    ped.scale = (0.075, 0.065, 0.016)
    bpy.ops.object.transform_apply(scale=True)
    ped.data.materials.append(DARK)
# チェーンリングカバー+スタンド
bpy.ops.mesh.primitive_cylinder_add(vertices=22, radius=0.075, depth=0.016,
    location=(0.04, BB.y, BB.z), rotation=(0, math.radians(90), 0))
cc = bpy.context.object; cc.name = 'bk2_chainring'; cc.data.materials.append(DARK)
cyl_between('bk2_stand', DARK, (-0.045, RA.y-0.02, RA.z-0.02), (-0.08, RA.y-0.09, 0.008), 0.007)
print('FBIKE_OK', len([o for o in bpy.data.objects if o.name.startswith('bk2_')]))
