"""GLB から平面図用(top)とライブラリ用(thumb)の PNG を起こす。

モデルを追加したら **必ず** これを通す。アイコンを別モデルから流用すると、
平面図に別物の記号が並ぶ(シーリングファンの位置に庭木が描かれる、など)。
モデルを作り直したときも撮り直しが要る — GLB だけ新しくアイコンが古い状態は、
ファイルの日付を見るまで誰も気付けない。

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/blender/make_icons.py -- <glb> [<glb> ...]

出力は GLB と同じディレクトリの <stem>_top.png / <stem>_thumb.png。

■ top の向き
  平面図はアイテムを rot に従って回して描くので、画像の上端がモデルの正面
  (+Y)でなければならない。真上から見下ろす(rot=0)カメラは +Y が画面上に来る
  ので、モデルの正面が +Y を向いてさえいれば向きは合う。
"""
import os
import sys
import math

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RES = 512


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    # glTF は Y-up。Blender の Z-up へ戻さないと平面図が横倒しになる。
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return ob


def scene_for(ob):
    """カメラ/ライトを片付けて、背景透過で撮り直す準備をする。"""
    for o in list(bpy.context.scene.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    w = bpy.data.worlds.new('IconWorld')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.5
    return sc


def sun(energy, rot, loc):
    bpy.ops.object.light_add(type='SUN', location=loc)
    s = bpy.context.active_object
    s.data.energy = energy
    s.data.angle = math.radians(28)
    s.rotation_euler = rot


def bounds(ob):
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    return mn, mx


def render_top(ob, path):
    sc = scene_for(ob)
    sun(3.0, (math.radians(14), 0, math.radians(30)), (1.5, -1.5, 8))
    mn, mx = bounds(ob)
    ctr = (mn + mx) / 2
    dx, dy, dz = (mx - mn)
    bpy.ops.object.camera_add(location=(ctr.x, ctr.y, mx.z + max(dx, dy) + 2.0),
                              rotation=(0, 0, 0))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(dx, dy) * 1.06
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_thumb(ob, path):
    sc = scene_for(ob)
    sun(3.4, (math.radians(50), 0, math.radians(35)), (3, -4, 6))
    mn, mx = bounds(ob)
    ctr = (mn + mx) / 2
    dx, dy, dz = (mx - mn)
    span = max(dx, dy, dz)
    dist = span * 1.9
    # 3/4 は「正面(+Y)の左手前」から。カメラを -Y 側に置くと背面しか写らず、
    # 表札もインターホンも無い真っ平らな面をサムネにしてしまう(実際にやらかした)。
    bpy.ops.object.camera_add(
        location=(ctr.x - dist * 0.62, ctr.y + dist * 0.95, mx.z + span * 0.35))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = span * 1.20
    sc.camera = cam
    bpy.ops.object.empty_add(location=(ctr.x, ctr.y, mn.z + dz * 0.45))
    tgt = bpy.context.active_object
    cam.constraints.new('TRACK_TO').target = tgt
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


for glb in argv:
    stem = os.path.splitext(glb)[0]
    clear()
    ob = import_glb(glb)
    mn, mx = bounds(ob)
    print('[icons] %s  %.3f x %.3f x %.3f m'
          % (os.path.basename(glb), mx.x - mn.x, mx.y - mn.y, mx.z - mn.z))
    render_top(ob, stem + '_top.png')
    clear()
    ob = import_glb(glb)
    render_thumb(ob, stem + '_thumb.png')
    print('[icons] wrote %s_top.png / _thumb.png' % os.path.basename(stem))
