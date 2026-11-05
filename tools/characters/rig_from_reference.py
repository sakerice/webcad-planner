# 骨の付いた人物（参照）の骨と重みを、同じ絵から作った骨の無いメッシュへ移す。
# Tripo で作り直した版の書き出しに骨が無かったとき、同じ絵から作り骨を付けた版の骨を使う（姿勢と寸法がそろっている前提）。
# 使い方: Blender -b -P tools/characters/rig_from_reference.py -- <骨付きの参照.glb> <骨の無い.glb> <書き出し先.glb>
import bpy,sys,bmesh
from mathutils import Vector
a=sys.argv[sys.argv.index('--')+1:]; RIGB,MESHC,OUT=a
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=RIGB)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
bm_=next(o for o in bpy.context.scene.objects if o.type=='MESH')
before=set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=MESHC)
cm=next(o for o in bpy.context.scene.objects if o not in before and o.type=='MESH')
bpy.context.view_layer.update()
def bb(o):
    ps=[o.matrix_world@v.co for v in o.data.vertices]
    return Vector([min(p[i] for p in ps) for i in range(3)]),Vector([max(p[i] for p in ps) for i in range(3)])
b0,b1=bb(bm_); c0,c1=bb(cm)
print('B bbox',b0,b1); print('C bbox',c0,c1)
# 高さで合わせ、足元中心を合わせる
s=(b1.z-b0.z)/(c1.z-c0.z)
# meshを直接ワールド変換
mw=cm.matrix_world.copy(); cm.parent=None; cm.matrix_world=mw
bpy.context.view_layer.objects.active=cm
for o in bpy.context.scene.objects: o.select_set(o==cm)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
cc=Vector(((c0.x+c1.x)/2,(c0.y+c1.y)/2,c0.z)); bc=Vector(((b0.x+b1.x)/2,(b0.y+b1.y)/2,b0.z))
for v in cm.data.vertices: v.co=(v.co-cc)*s+bc
c0,c1=bb(cm); print('C fitted',c0,c1,'scale',s)
# 重みの移し替え
bk=bmesh.new(); bk.from_mesh(cm.data); bmesh.ops.remove_doubles(bk,verts=bk.verts,dist=1e-5*s*100); bk.to_mesh(cm.data); bk.free()
for g in bm_.vertex_groups: cm.vertex_groups.new(name=g.name)
dt=cm.modifiers.new('dt','DATA_TRANSFER'); dt.object=bm_; dt.use_vert_data=True
dt.data_types_verts={'VGROUP_WEIGHTS'}; dt.vert_mapping='POLYINTERP_NEAREST'
dt.layers_vgroup_select_src='ALL'; dt.layers_vgroup_select_dst='NAME'
bpy.context.view_layer.objects.active=cm
bpy.ops.object.modifier_apply(modifier='dt')
# 重みの正規化
for v in cm.data.vertices:
    t=sum(g.weight for g in v.groups)
    if t>0:
        for g in v.groups: g.weight/=t
cm.parent=arm; cm.matrix_parent_inverse=arm.matrix_world.inverted()
m=cm.modifiers.new('Armature','ARMATURE'); m.object=arm
bpy.data.objects.remove(bm_)
print('C verts',len(cm.data.vertices),'unweighted',sum(1 for v in cm.data.vertices if not v.groups))
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',export_animations=False)
