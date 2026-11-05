# テクスチャの各島（UV の切れ端）の間に余白を取って、色の画像を焼き直す。
#
# Tripo の書き出しは島がすき間なく詰まっていて、遠くで使う縮小版の画像（ミップマップ）で隣の島の色がにじむ
# （髪に白い筋が出た）。島の形はそのまま、間を空けて並べ直し、元の画像から色を焼き写す。余白は島の縁の色で埋める。
# サイトの三人称は色の画像しか使わないので、法線・粗さの画像は外す。
#
# 使い方: Blender -b -P tools/characters/rebake_with_margin.py -- <入力.glb> <書き出し先.glb> [画像の大きさ=2048]
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 2048
PACK_MARGIN = 0.003         # 島の間（UV の幅に対する比。2048 で約6画素、1024 で約3画素。広げすぎると島が小さくなり顔がぼやける）
BAKE_MARGIN = 64            # 島の外を縁の色で埋める幅（画素）

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
me = next(o for o in sc.objects if o.type == 'MESH')
mat = me.data.materials[0]
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
def upstream_image(node):
    # 色の入力から上流をたどり、最初の画像の節を返す（間に色の掛け合わせなどが入っていてもよい）
    todo, seen = [node], set()
    while todo:
        n = todo.pop(0)
        if n.type == 'TEX_IMAGE': return n
        if n.name in seen: continue
        seen.add(n.name)
        todo += [l.from_node for i in n.inputs for l in i.links]
    raise SystemExit('色の画像が見つからない')
src_tex = upstream_image(bsdf.inputs['Base Color'].links[0].from_node)
src_img = src_tex.image
old_uv = me.data.uv_layers.active.name

# 島を並べ直した UV を作る
new_uv = me.data.uv_layers.new(name='packed')
me.data.uv_layers.active = new_uv
for o in sc.objects: o.select_set(o == me)
bpy.context.view_layer.objects.active = me
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, margin=PACK_MARGIN, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')

# 元の画像を元の UV で読んで光らせ、新しい UV の画像へ焼き写す
out = bpy.data.images.new(src_img.name + '_packed', SIZE, SIZE, alpha=False)
uv_src = nt.nodes.new('ShaderNodeUVMap'); uv_src.uv_map = old_uv
nt.links.new(uv_src.outputs['UV'], src_tex.inputs['Vector'])
emit = nt.nodes.new('ShaderNodeEmission')
nt.links.new(src_tex.outputs['Color'], emit.inputs['Color'])
mout = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
keep = mout.inputs['Surface'].links[0].from_socket
nt.links.new(emit.outputs['Emission'], mout.inputs['Surface'])
tgt = nt.nodes.new('ShaderNodeTexImage'); tgt.image = out
uv_dst = nt.nodes.new('ShaderNodeUVMap'); uv_dst.uv_map = 'packed'
nt.links.new(uv_dst.outputs['UV'], tgt.inputs['Vector'])
nt.nodes.active = tgt
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.cycles.device = 'CPU'
# 骨の休み姿勢で焼く（動きの途中の形で焼くと、伸びた所で色がずれる）
arm = next((o for o in sc.objects if o.type == 'ARMATURE'), None)
if arm: arm.data.pose_position = 'REST'
bpy.ops.object.bake(type='EMIT', margin=BAKE_MARGIN, margin_type='EXTEND', use_clear=True, uv_layer='packed')
if arm: arm.data.pose_position = 'POSE'
out.pack()

# 材質を新しい画像に差し替え、元の UV と法線・粗さの画像を外す
nt.links.new(keep, mout.inputs['Surface'])
for n in (emit, uv_src): nt.nodes.remove(n)
nt.links.new(tgt.outputs['Color'], bsdf.inputs['Base Color'])
for name in ('Normal', 'Metallic', 'Roughness'):
    for l in list(bsdf.inputs[name].links): nt.links.remove(l)
keep_name = tgt.name      # bpy の節は取り出すたびに別の Python の物になるので、is ではなく名前で比べる
for n in list(nt.nodes):
    if n.type in ('NORMAL_MAP', 'SEPRGB', 'SEPARATE_COLOR', 'MIX') or (n.type == 'TEX_IMAGE' and n.name != keep_name):
        nt.nodes.remove(n)
nt.nodes.remove(uv_dst)
me.data.uv_layers.remove(me.data.uv_layers[old_uv])
me.data.uv_layers['packed'].name = 'UVMap'
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_animations=True, export_image_format='JPEG')
print('rebaked', SRC, '->', DST, 'islands margin', PACK_MARGIN, 'size', SIZE)
