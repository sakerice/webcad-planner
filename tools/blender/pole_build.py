import bpy, math

def matp(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

def raw_box(mat, x, y, z, sx, sy, sz):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    ob = bpy.context.object
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob

for ob in list(bpy.data.objects):
    if ob.name.startswith('up_'):
        bpy.data.objects.remove(ob, do_unlink=True)

CONC = matp('UpConcrete', (0.62, 0.63, 0.63), rough=0.92)
ARM  = matp('UpArm', (0.45, 0.47, 0.49), rough=0.7, metal=0.3)
INS  = matp('UpInsulator', (0.90, 0.90, 0.88), rough=0.35)
TRAF = matp('UpTrafo', (0.52, 0.54, 0.55), rough=0.6, metal=0.3)
BAND = matp('UpBand', (0.25, 0.26, 0.27), rough=0.6, metal=0.4)

H = 6.5
# tapered pole
bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.155, radius2=0.09, depth=H, location=(0, 0, H/2))
pole = bpy.context.object; pole.name = 'up_pole'
pole.data.materials.append(CONC)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
# top cap
bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.10, depth=0.05, location=(0, 0, H + 0.02))
cap = bpy.context.object; cap.name = 'up_cap'; cap.data.materials.append(ARM)

parts = []
# 腕金(クロスアーム) 上段: 電線方向(x)に直交…アプリの電線は±x方向なのでアームはx向き
arm1 = raw_box(ARM, 0, 0, H*0.90, 1.55, 0.075, 0.075); parts.append(arm1)
for k, ax in enumerate((-0.62, 0.0, 0.62)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.035, depth=0.12, location=(ax, 0, H*0.90 + 0.10))
    c = bpy.context.object; c.data.materials.append(INS); parts.append(c)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.05, depth=0.045, location=(ax, 0, H*0.90 + 0.14))
    c2 = bpy.context.object; c2.data.materials.append(INS); parts.append(c2)
# 下段アーム
arm2 = raw_box(ARM, 0, 0, H*0.76, 1.25, 0.07, 0.07); parts.append(arm2)
for ax in (-0.48, 0.48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.032, depth=0.11, location=(ax, 0, H*0.76 + 0.09))
    c = bpy.context.object; c.data.materials.append(INS); parts.append(c)
# 変圧器(トランス) + 取付バンド
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.20, depth=0.78, location=(0.30, 0, H*0.60))
tr = bpy.context.object; tr.name = 'up_trafo'; tr.data.materials.append(TRAF); parts.append(tr)
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.205, depth=0.05, location=(0.30, 0, H*0.60 + 0.42))
trc = bpy.context.object; trc.data.materials.append(BAND); parts.append(trc)
parts.append(raw_box(BAND, 0.14, 0, H*0.60 + 0.28, 0.30, 0.06, 0.05))
parts.append(raw_box(BAND, 0.14, 0, H*0.60 - 0.28, 0.30, 0.06, 0.05))
# バンド(ポール金具)
for bz in (H*0.90 - 0.05, H*0.76 - 0.05):
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.125, depth=0.06, location=(0, 0, bz))
    c = bpy.context.object; c.data.materials.append(BAND); parts.append(c)
# 足場ボルト(交互)
z = 2.2
side = 1
while z < H*0.72:
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.018, depth=0.30,
        location=(side*0.20, 0, z), rotation=(0, math.radians(90), 0))
    c = bpy.context.object; c.data.materials.append(BAND); parts.append(c)
    z += 0.45; side *= -1
# 標識プレート
parts.append(raw_box(INS, 0, 0.13, 2.6, 0.16, 0.02, 0.42))

# join all except pole into one fittings mesh
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
fit = bpy.context.view_layer.objects.active
fit.name = 'up_fittings'

print('POLE_OK')
