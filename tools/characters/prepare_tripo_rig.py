# Tripo で骨組みを付けて書き出した人物の GLB を、動きを移し替える前の形にそろえる。
#   - 身長を指定の値（m）にする（Tripo の書き出しは身長 約0.98 で出てくる）
#   - 足の裏を原点の高さに置く
#   - 縮尺を骨と形に焼き込む（three.js 側で拡大しない）
#   - 面ごとに分かれている頂点をつなぐ（Tripo の書き出しは四角面ごとに頂点が別で、頂点数が4倍・ファイルが5MB を超える）。
#     画像の座標（UV）の継ぎ目は書き出しが分け直すので、見た目は変わらない
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/characters/prepare_tripo_rig.py -- in.glb out.glb 1.60
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST, HEIGHT = argv[0], argv[1], float(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
meshes = [o for o in sc.objects if o.type == 'MESH' and o.parent == arm]
for o in [o for o in sc.objects if o.type == 'MESH' and o not in meshes]:
    bpy.data.objects.remove(o, do_unlink=True)   # 骨の表示用の形（Icosphere など）は捨てる
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
lo = min(p.z for p in pts); hi = max(p.z for p in pts)
k = HEIGHT / (hi - lo)
arm.location = (arm.location.x * k, arm.location.y * k, (arm.location.z - lo) * k)
arm.scale = arm.scale * k
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in [arm] + meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.context.view_layer.update()
import bmesh
for o in meshes:
    n0 = len(o.data.vertices)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free()
    o.data.shade_smooth()
    print('weld', o.name, n0, '->', len(o.data.vertices))
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
print('height', round(max(p.z for p in pts) - min(p.z for p in pts), 4), 'min z', round(min(p.z for p in pts), 4),
      'scale', round(k, 4))
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True)
