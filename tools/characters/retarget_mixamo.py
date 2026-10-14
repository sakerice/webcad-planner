# Mixamo の動き（骨だけの FBX）を、Meshy で作った人物の GLB に移し替えて書き出す。
#
# 使い方（Blender をヘッドレスで回す）:
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/characters/retarget_mixamo.py -- \
#     <人物.glb> <書き出し先.glb> Idle=<待機.fbx> Walking=<歩き.fbx> Sitting=<座り.fbx> ...
#
# Meshy の骨は Mixamo と同じ名前（mixamorig:Hips など）だが、休み姿勢（骨の向き）が違う。
# そこで骨ごとに、休み姿勢の骨の方向を動き側にそろえたうえで「休み姿勢からの回転の差（ワールド空間）」を移す。腰の位置は、腰の高さの比で縮めて移す。
# 指の骨は人物側に無いので捨てる。人物にもとからある動きは、名前が重なる物を置き換え、それ以外は残す
# （DROP に挙げた物は捨てる）。
import sys
import bpy
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
CLIPS = [a.split('=', 1) for a in argv[2:]]
DROP = {'Chair_Sit_Idle_M', 'Chair_Sit_Idle_F'}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
tgt = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
scene = bpy.context.scene
scene.render.fps = 30

for act in list(bpy.data.actions):
    if act.name in DROP or act.name in {n for n, _ in CLIPS}:
        bpy.data.actions.remove(act)


def rest_world(arm, name):
    return arm.matrix_world @ arm.data.bones[name].matrix_local


def order(arm):
    out = []
    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)
    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    return out


tgt.animation_data_create()
tgt.animation_data.action = None
for pb in tgt.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
tgt_names = order(tgt)
tgt_rest = {n: rest_world(tgt, n) for n in tgt_names}

for clip_name, fbx in CLIPS:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False)
    new = [o for o in bpy.context.scene.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE')
    src_act = src.animation_data.action
    f0, f1 = (int(round(v)) for v in src_act.frame_range)
    names = [n for n in tgt_names if n in src.data.bones]
    src_rest = {n: rest_world(src, n) for n in names}
    # 休み姿勢の違い（Mixamo は T 字、Meshy は腕が下がり気味など）を消すため、人物側の休み姿勢の骨を
    # 動き側の休み姿勢の骨と同じ方向に向けてから差を当てる（骨の向き = 骨の Y 軸）
    Y = Vector((0, 1, 0))
    # 向きをそろえるのは、休み姿勢そのものが違う腕だけ（Mixamo は腕が水平、Meshy は斜め下）。
    # 背骨・鎖骨・首・脚までそろえると、Mixamo の人形の鎖骨の上向きや背骨の反りが乗り、
    # 肩が持ち上がって胸が丸まった（利用者の指摘）。それ以外は休み姿勢からの差だけを当てる
    def needs_align(n):
        return any(k in n for k in ('Arm', 'Hand'))
    align = {n: ((tgt_rest[n].to_quaternion() @ Y).rotation_difference(src_rest[n].to_quaternion() @ Y)
                 if needs_align(n) else Quaternion()) for n in names}
    hip = 'mixamorig:Hips'
    scale = tgt_rest[hip].translation.z / src_rest[hip].translation.z  # Blender は上が Z

    act = bpy.data.actions.new(clip_name)
    tgt.animation_data_create()
    tgt.animation_data.action = act
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    tw_inv = tgt.matrix_world.inverted()
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        for n in tgt_names:
            pb = tgt.pose.bones[n]
            if n not in names:
                pb.matrix_basis = Matrix.Identity(4)
                continue
            pw = src.matrix_world @ src.pose.bones[n].matrix
            rot = pw.to_quaternion() @ src_rest[n].to_quaternion().inverted() @ align[n] @ tgt_rest[n].to_quaternion()
            if n == hip:
                loc = tgt_rest[n].translation + (pw.translation - src_rest[n].translation) * scale
            else:
                loc = (tgt.matrix_world @ pb.matrix).translation
            m = Matrix.Translation(loc) @ rot.to_matrix().to_4x4()
            pb.matrix = tw_inv @ m
            bpy.context.view_layer.update()
        for n in tgt_names:
            pb = tgt.pose.bones[n]
            pb.keyframe_insert('rotation_quaternion', frame=f - f0)
            if n == hip:
                pb.keyframe_insert('location', frame=f - f0)
    act.use_fake_user = True
    tgt.animation_data.action = None
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.actions.remove(src_act)
    print('clip', clip_name, f1 - f0 + 1, 'frames, hip scale', round(scale, 3))

# 動きを NLA のトラックに並べて、全部を書き出す
for tr in list(tgt.animation_data.nla_tracks):
    tgt.animation_data.nla_tracks.remove(tr)
tgt.animation_data.action = None
for act in bpy.data.actions:
    tr = tgt.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, 0, act)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_animation_mode='NLA_TRACKS',
                          export_image_format='AUTO', export_yup=True)
print('wrote', DST, [a.name for a in bpy.data.actions])
