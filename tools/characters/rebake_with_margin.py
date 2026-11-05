# テクスチャの各島（UV の切れ端）の間に余白を取って、色の画像を焼き直す。
#
# Tripo の書き出しは島がすき間なく詰まっていて、遠くで使う縮小版の画像（ミップマップ）で隣の島の色がにじむ
# （髪に白い筋が出た）。島の形はそのまま、間を空けて並べ直し、元の画像から色を焼き写す。余白は島の縁の色で埋める。
# サイトの三人称は色の画像しか使わないので、法線・粗さの画像は外す。
#
# 島の間にもともと余白があり、その余白が白などで塗られている物（Meshy の書き出し）は、keep を付けて並べ方を変えずに焼き直す。
# 島の中の色は元のまま、余白だけが島の縁の色で塗り直される（解像度は落ちない）。
#
# 並べ直すとき、頭（顔・髪）の島を HEAD_WEIGHT 倍に広げてから詰める。島の間の余白のぶん全体が縮むので、
# そのままだと顔の解像度が下がる（前の版で約3割下がった）。無地に近いスカートなどの島がそのぶん小さくなる。
#
# 使い方: Blender -b -P tools/characters/rebake_with_margin.py -- <入力.glb> <書き出し先.glb> [画像の大きさ=2048] [keep|head=1.6]
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 2048
KEEP_LAYOUT = len(argv) > 3 and argv[3] == 'keep'
HEAD_WEIGHT = next((float(a.split('=')[1]) for a in argv[3:] if a.startswith('head=')), 1.0)
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
if not KEEP_LAYOUT and HEAD_WEIGHT != 1.0:
    import bmesh
    from bpy_extras import bmesh_utils
    bm = bmesh.new(); bm.from_mesh(me.data)
    uvl = bm.loops.layers.uv['packed']
    zs = [v.co.z for v in bm.verts]; z0, z1 = min(zs), max(zs)
    n_head = 0
    for isl in bmesh_utils.bmesh_linked_uv_islands(bm, uvl):
        zc = sum(l.vert.co.z for f in isl for l in f.loops) / sum(len(f.loops) for f in isl)
        if (zc - z0) / (z1 - z0) < 0.80: continue            # 首から上（身長の上2割）だけ
        loops = [l for f in isl for l in f.loops]
        cu = sum(l[uvl].uv.x for l in loops) / len(loops); cv = sum(l[uvl].uv.y for l in loops) / len(loops)
        for l in loops:
            l[uvl].uv.x = cu + (l[uvl].uv.x - cu) * HEAD_WEIGHT
            l[uvl].uv.y = cv + (l[uvl].uv.y - cv) * HEAD_WEIGHT
        n_head += 1
    bm.to_mesh(me.data); bm.free()
    print('head islands scaled', n_head, 'x', HEAD_WEIGHT)
if not KEEP_LAYOUT:          # uv_layers.new は今の UV を写した物になる。keep のときはそのまま使う
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
