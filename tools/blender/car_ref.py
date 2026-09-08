"""参考モデル(Meshy)を「見るため」に整える。

参考モデルは作り変えない。ここでやるのは
  1. 最終と同じ座標系へ置く(長手+Y / 上+Z / 接地面 z=0 / 中心が原点)
  2. テクスチャを外した無地で正投影に撮る
だけ。撮った絵を三面図として見て、寸法を人が書き出す。

意図して「解析しない」。断面を密にサンプリングして当てはめたり、
テクセルを分類してラベルにしたりすると、標本1つ分のノイズと癖を
そのまま形に持ち込むことになる。実際に前者では風船になり、後者では
境界がギザギザになった。参考モデルから取るのは、人が言葉にできる
寸法だけに絞る。
"""
import bpy
import numpy as np
import os

SRC = "Meshy_Blue Hatchback Blueprint_mesh_node"
REF = "ref_car"
TARGET_LEN = 4.30      # 全長[m]。実車ハッチバック相当へ等倍スケール


def _log(*a):
    print("[car_ref]", *a)


def _select_only(ob):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def _co(ob):
    """頂点座標を (N,3) で取る。foreach_get は平坦な配列でないと通らない。"""
    V = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", V)
    return V.reshape(-1, 3)


def setup_reference(src_name=SRC):
    """参考モデルを最終と同じ座標系へ置いたコピーを作る。"""
    old = bpy.data.objects.get(REF)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    src = bpy.data.objects[src_name]
    ob = src.copy()
    ob.data = src.data.copy()
    ob.name = REF
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler = (0.0, 0.0, 0.0)
    ob.location = (0.0, 0.0, 0.0)
    ob.scale = (1.0, 1.0, 1.0)
    _select_only(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    V = _co(ob)
    size = V.max(axis=0) - V.min(axis=0)
    # 一番長い軸が長手。それを +Y へ持ってくる
    long_axis = int(np.argmax(size))
    if long_axis == 0:
        ob.rotation_euler = (0.0, 0.0, np.radians(90.0))
        _select_only(ob)
        bpy.ops.object.transform_apply(rotation=True)
        V = _co(ob)
        size = V.max(axis=0) - V.min(axis=0)
    s = TARGET_LEN / size[1]
    ob.scale = (s, s, s)
    _select_only(ob)
    bpy.ops.object.transform_apply(scale=True)
    V = _co(ob)
    lo, hi = V.min(axis=0), V.max(axis=0)
    ob.location = (-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])
    _select_only(ob)
    bpy.ops.object.transform_apply(location=True)
    V = _co(ob)
    _log(f"{REF}: {len(ob.data.polygons)} 面 / 寸法 "
         f"{np.round(V.max(axis=0) - V.min(axis=0), 3)} "
         f"/ 底面 z={V[:, 2].min():.3f}")
    return ob


def clay_material(name='ref_clay', rgb=(0.62, 0.63, 0.66)):
    """形だけを見るための無地マテリアル。"""
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Roughness'].default_value = 0.42
    b.inputs['Metallic'].default_value = 0.0
    return m


def as_clay(ob, name=None):
    """無地マテリアルを貼ったコピーを返す。参考モデル本体は触らない。"""
    nm = name or (ob.name + '_clay')
    old = bpy.data.objects.get(nm)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    o = ob.copy()
    o.data = ob.data.copy()
    o.name = nm
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.clear()
    o.data.materials.append(clay_material())
    o.data.polygons.foreach_set(
        "material_index", np.zeros(len(o.data.polygons), dtype=np.int32))
    o.data.update()
    return o


# 三面図の視点。dir はカメラを置く方向。この車体はフロントが -Y。
# plane は画面に写る2軸で、各視点をその軸の実寸で切り取るのに使う。
SHEET = {
    'side':  dict(dir=(1, 0, 0), plane=(1, 2)),
    'front': dict(dir=(0, -1, 0), plane=(0, 2)),
    'rear':  dict(dir=(0, 1, 0), plane=(0, 2)),
    'top':   dict(dir=(0, 0, 1), plane=(0, 1)),
    # 真正面・真後ろの正投影は面がほぼ稜線に潰れ、陰影で形を読めない。
    # 面の張りを見るには斜めから見る
    '3qf':   dict(dir=(1, -0.85, 0.42), plane=(1, 2)),
    '3qr':   dict(dir=(1, 0.85, 0.42), plane=(1, 2)),
}


def _rig_lights():
    for nm, loc, rot, energy, size in (
        ('refrig_key', (4.5, -5.0, 6.0), (0.65, 0.0, 0.72), 700.0, 6.0),
        ('refrig_fill', (-6.0, -2.0, 3.5), (1.05, 0.0, -1.10), 240.0, 8.0),
        ('refrig_top', (0.0, 0.0, 8.0), (0.0, 0.0, 0.0), 300.0, 10.0),
    ):
        old = bpy.data.objects.get(nm)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
        L = bpy.context.object
        L.name = nm
        L.data.energy = energy
        L.data.size = size


def render_sheet(objs, outdir, tag='ref', res=1600, margin=1.06, views=None,
                 frame=None):
    """正投影の三面図を撮る。全視点で同じスケール。

    frame に (中心, 寸法) を渡すと、その枠で撮る。参考と自分を画素で
    見比べるには、両者を必ず同じ枠で撮らなければならない。各自の
    バウンディングボックスで枠を決めると、寸法がわずかに違うだけで
    全体がずれて写り、形の差と区別がつかなくなる。
    戻り値の (中心, 寸法) を、次の撮影に frame として渡す。"""
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('refrig_world')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.80, 0.81, 0.84, 1.0)
        bg.inputs['Strength'].default_value = 0.9
    _rig_lights()

    pts = []
    for ob in objs:
        M = np.array(ob.matrix_world)
        P = _co(ob)
        pts.append(P @ M[:3, :3].T + M[:3, 3])
    P = np.vstack(pts)
    ctr = (P.min(axis=0) + P.max(axis=0)) / 2
    size = P.max(axis=0) - P.min(axis=0)
    own = (ctr.copy(), size.copy())
    if frame is not None:
        ctr, size = np.asarray(frame[0], float), np.asarray(frame[1], float)

    for name in (views or SHEET):
        v = SHEET[name]
        # 視点ごとに、その面に写る実寸で切り取る。全視点を同じ倍率にすると
        # 正面図が小さくなりすぎて、見るための絵にならない
        span = float(max(size[v['plane'][0]], size[v['plane'][1]])) * margin
        old = bpy.data.objects.get('refrig_cam')
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        d = np.array(v['dir'], dtype=float)
        bpy.ops.object.camera_add(location=tuple(ctr + d * 20.0))
        cam = bpy.context.object
        cam.name = 'refrig_cam'
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = span
        from mathutils import Vector
        up = 'Y' if name != 'top' else 'Y'
        cam.rotation_euler = Vector(tuple(-d)).to_track_quat('-Z', up).to_euler()
        sc.camera = cam
        sc.render.resolution_x = res
        sc.render.resolution_y = res
        sc.render.filepath = os.path.join(outdir, f"{tag}_{name}.png")
        bpy.ops.render.render(write_still=True)
    _log(f"三面図: {outdir} ({tag}_*.png) / 全体寸法 {np.round(own[1], 3)} m")
    return own


def ref_frame(objs):
    """撮影せずに枠(中心, 寸法)だけを出す。撮り直さない周回で使う。"""
    pts = []
    for ob in objs:
        M = np.array(ob.matrix_world)
        pts.append(_co(ob) @ M[:3, :3].T + M[:3, 3])
    P = np.vstack(pts)
    return (P.min(axis=0) + P.max(axis=0)) / 2, P.max(axis=0) - P.min(axis=0)
