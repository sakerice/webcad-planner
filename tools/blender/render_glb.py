"""GLB を読み込んで3方向からレンダリングし、品質を目で確かめるための道具。

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/blender/render_glb.py -- <glb> <out_dir> [size]

原点まわりに3/4・真横・正面の3枚を出す。モデルの寸法に合わせてカメラを
自動で引くので、どのモデルでも同じ手順で見比べられる。
"""
import os
import sys
import math

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
GLB = argv[0]
OUT = argv[1] if len(argv) > 1 else '/tmp'
SIZE = int(argv[2]) if len(argv) > 2 else 800

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
        mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
ctr = (mn + mx) / 2
size = max((mx - mn).x, (mx - mn).y, (mx - mn).z)
print('[render_glb] bbox %.3f x %.3f x %.3f' % ((mx-mn).x, (mx-mn).y, (mx-mn).z))
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
print('[render_glb] meshes=%d tris=%d' % (len(objs), tris))

# 地面(影を受ける)
bpy.ops.mesh.primitive_plane_add(size=size * 12, location=(ctr.x, ctr.y, mn.z - 0.001))
gm = bpy.data.materials.new('Ground')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.56, 0.58, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
bpy.context.object.data.materials.append(gm)

world = bpy.data.worlds.new('W')
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.68, 0.78, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.4

bpy.ops.object.light_add(type='SUN', location=(ctr.x + size, ctr.y - size, ctr.z + size * 1.6))
sun = bpy.context.object
sun.data.energy = 3.2
sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(52), 0, math.radians(38))

scene = bpy.context.scene
try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'CYCLES'
try:
    scene.cycles.samples = 64
except Exception:
    pass
scene.render.resolution_x = SIZE
scene.render.resolution_y = int(SIZE * 0.78)
scene.render.film_transparent = False

bpy.ops.object.camera_add()
cam = bpy.context.object
cam.data.lens = 45
scene.camera = cam

# モデルの正面は +Y。カメラは -Z を向くので、+Y 側から見るには rot_z=180 が要る。
# ここを間違えると、ずっと背面だけを見て「正面が作れていない」と誤診する。
VIEWS = {
    'q': (math.radians(62), 0, math.radians(215)),   # 前方 3/4
    'side': (math.radians(80), 0, math.radians(270)),
    'front': (math.radians(80), 0, math.radians(180)),
}
dist = max((mx - mn).length, size) * 2.35
os.makedirs(OUT, exist_ok=True)
base = os.path.splitext(os.path.basename(GLB))[0]
for name, rot in VIEWS.items():
    cam.rotation_euler = rot
    d = Vector((0, 0, 1))
    d.rotate(cam.rotation_euler)
    cam.location = ctr + d * dist
    scene.render.filepath = os.path.join(OUT, '%s_%s.png' % (base, name))
    bpy.ops.render.render(write_still=True)
    print('[render_glb] wrote %s' % scene.render.filepath)
