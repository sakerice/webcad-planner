"""Meshy製ハッチバックをWeb用にリダクションして car_hatchback.glb を書き出す。

前提: Meshyから読み込んだ高密度メッシュ(約197万トライアングル / 2048px の
base_color・metallic_roughness・normal 付き)が1オブジェクトとして
シーンに入っていること。元オブジェクトは複製して使うので変更しない。

やっていること:
  1. 複製 → ルーズパーツ分離(車体1 + ホイール系6)
  2. パーツごとに目標トライアングル数を割り当ててデシメート
  3. 間引いたメッシュを元メッシュへ吸着させ、元の法線を転写する
  4. 1オブジェクトへ結合し、既存 car_sedan.glb と同じ向き
     (glTF -Z が車の前、+X が右、長手方向は Z)へ回転・実寸へスケール
  5. ベースカラーテクスチャの塗装部分(青)を真っ白なべた塗りへ置換
  6. 同じテクスチャを持つ CarBody / CarDetail の2マテリアルを作り、
     テクスチャの彩度で分類した「塗装面」を CarBody へ割り当てる
     → アプリ側 configureCarGlbMaterials() が CarBody 以外をロックするので、
       ユーザーの色指定は 色 × テクスチャ となり塗装部分だけに乗る。
       塗装/トリムの見た目の境界はテクスチャ(ピクセル単位)が持つため、
       マテリアル分割が三角形単位でもふちがギザつかない
  7. GLB書き出し

※ テクスチャを捨てて単色マテリアルの塗り分けにする案は試して捨てた。
   このモデルは塗装・ガラス・黒樹脂の区別をテクスチャしか持っておらず、
   ジオメトリ側に境目が無い。詳細は README の「テクスチャを外せない理由」。

使い方(既存パイプラインと同じ):
    python3 tools/blender/bmcp.py code tools/blender/car_meshy_reduce.py

書き出し後は tools/slim_car_hatchback.sh でテクスチャ縮小+Draco圧縮をかける。
"""

import bpy
import os
import bmesh
import math
import numpy as np

# ── 設定 ────────────────────────────────────────────────────
SRC_OBJ = "Meshy_Blue Hatchback Blueprint_mesh_node"
WORK_NAME = "car_hb"
OUT = "/Users/nariiwa/Projects/webcad-planner/assets/models/context/car_hatchback.glb"

# トライアングル配分。元メッシュ自体は完全にクリア(20万まで落としても
# 最大ズレ 0.82mm)なので、造形が溶けるのはデシメートのやりすぎが原因。
#
# 2026-08-22 に無地マテリアルで梯子を作って並べ直した結果:
#   4.6万 パネルの見切り・窓枠が潰れて瘤になる。これが「波打ち」の正体
#   9.0万 見切りが戻る。最大ズレ 1.62mm
#   14万  最大ズレ 1.10mm
#   20万  ほぼ元と同一。最大ズレ 0.82mm
# 以前「12万でも見分けがつかなかった」と書いていたのは、比較ページに
# shadow.bias が入っておらずセルフシャドウのモアレで差が潰れていたため。
#
# 配信サイズ(tools/slim_car_hatchback.sh 通過後):
#   6万tri=554KB / 11万tri=728KB / 18万tri=955KB
BODY_TRIS = 90000    # 車体シェルに割り当てるトライアングル数
WHEEL_TRIS = 20000   # ホイール系6パーツ合計

# 車体シェルの面数を役割ごとに配分するか(car_part_budget.py)。既定は無効。
#
# 「一律に間引くと削る配分がその形の重要度を見ない」という考えは正しく、
# 実際に灯火を2倍、ミラーを1.7倍、ガラスを1.3倍に振り直せた。
# しかし同じ11万三角で撮り比べると、**部位別のほうが見た目が悪い**。
# 役割ごとに Decimate を8回かけるため、崩れが積み上がる:
#   - ヘッドライトは面数2倍なのに輪郭が甘くなった
#   - ボンネットのハイライトが折れて面が見える
#   - 原本との画素差も全視点で悪化(hero +2.2pt / front +6.2pt)
# 配分で得るものより、パスを重ねて失うもののほうが大きかった。
#
# ラベル分け自体は有効なので、ガラスのマテリアル分けには常に使っている。
# 将来ホイールのように独立した島を持つアセットでは配分が効くはずなので、
# 仕組みは残す。
PART_BUDGET = False
TARGET_LEN = 4.30    # 全長[m]。実車ハッチバック相当へ等倍スケール
SAT_TH = 0.10        # 彩度しきい値。これを超える面を塗装(CarBody)とみなす
SMOOTH_PASSES = 3    # 分類のごま塩を消す回数
DILATE_PASSES = 0    # 塗装領域を外周へ広げるリング数。CarDetail が元テクスチャを
                     # 持つようになったので、境界を塗装側へ寄せる必要はなくなった
SMOOTH_ANGLE = 40.0  # スムーズシェーディングの角度[deg]。法線転写時は使わない

# デシメート前の平滑化。表面ノイズ対策として入れていたが、元メッシュにノイズは
# なく、実際には造形を溶かすだけだったので既定で無効。
PRESMOOTH_ITERS = 0
PRESMOOTH_FACTOR = 1.0

# デシメートは頂点を元の面からわずかに浮き沈みさせる。振幅は1mm以下だが、
# 光沢のあるボディを浅い角度から見ると細かいシワとしてはっきり出る。
# 対策として、間引いたあとに
#   1. Shrinkwrap で頂点を元メッシュ表面へ吸着(位置のズレを消す)
#   2. Data Transfer で元メッシュの法線を転写(陰影を元と同じにする)
# を行う。ポリゴン数を増やすより効く。
WRAP_TO_SOURCE = True
TRANSFER_NORMALS = True
REF_PREFIX = "carref_"

# 塗装マテリアルの既定色。既存 car_build.py の CarBody と揃える
BODY_RGB = (0.90, 0.90, 0.91)
GLASS_RGB = (0.030, 0.034, 0.040)   # ガラス
RUBBER_RGB = (0.028, 0.028, 0.031)  # タイヤ・モール
TRIM_SEAM_RGB = (0.055, 0.056, 0.060)  # トリム側に残る塗装色の置き換え先


def _log(*a):
    print("[car_meshy_reduce]", *a)


def _select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    objs = list(objs)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def stage_split():
    """元メッシュを複製し、ルーズパーツへ分離する。"""
    for ob in list(bpy.data.objects):
        if ob.name.startswith(WORK_NAME) or ob.name.startswith(REF_PREFIX):
            bpy.data.objects.remove(ob, do_unlink=True)
    # 孤立メッシュが名前を握ったままだと再実行時に car_hb.007 のような
    # 連番名になり、GLB内のメッシュ名が毎回変わってしまう
    for me in list(bpy.data.meshes):
        if (me.name.startswith(WORK_NAME) or me.name.startswith(REF_PREFIX)) and me.users == 0:
            bpy.data.meshes.remove(me)

    src = bpy.data.objects[SRC_OBJ]
    dup = src.copy()
    dup.data = src.data.copy()
    dup.name = WORK_NAME
    dup.data.name = WORK_NAME
    bpy.context.scene.collection.objects.link(dup)

    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    _select_only([dup])
    bpy.ops.mesh.separate(type='LOOSE')

    parts = [o for o in bpy.data.objects if o.name.startswith(WORK_NAME)]
    parts.sort(key=lambda o: -len(o.data.polygons))
    _log("split into", len(parts), "parts:",
         [len(o.data.polygons) for o in parts])
    return parts


_MODULES = {}


def _load_sibling(filename, cache_key):
    """同じディレクトリの補助モジュールを読み込む。

    このファイルは Blender へ exec で流し込んで使うことがあり、その場合は
    __file__ が無い。OUT が絶対パスなので、そこから上へ辿って探す。
    """
    if cache_key in _MODULES:
        return _MODULES[cache_key]
    rel = os.path.join('tools', 'blender', filename)
    d = os.path.dirname(os.path.abspath(OUT))
    while True:
        cand = os.path.join(d, rel)
        if os.path.exists(cand):
            break
        up = os.path.dirname(d)
        if up == d:
            raise FileNotFoundError(f'{rel} が {OUT} の上位に見つからない')
        d = up
    g = {"__name__": filename[:-3]}
    exec(open(cand).read(), g)
    mod = type('M', (), g)
    _MODULES[cache_key] = mod
    return mod


def _cut_regions():
    """car_cut_regions.py を読み込む。"""
    return _load_sibling('car_cut_regions.py', 'cut')


def _part_budget():
    """car_part_budget.py を読み込む。"""
    return _load_sibling('car_part_budget.py', 'pb')


def stage_decimate():
    """パーツごとに目標トライアングル数へデシメートする。"""
    parts = [o for o in bpy.data.objects if o.name.startswith(WORK_NAME)]
    parts.sort(key=lambda o: -len(o.data.polygons))
    body, wheels = parts[0], parts[1:]
    wheel_total = sum(len(o.data.polygons) for o in wheels) or 1

    targets = {body.name: BODY_TRIS}
    for w in wheels:
        targets[w.name] = max(300, int(WHEEL_TRIS * len(w.data.polygons) / wheel_total))

    for ob in parts:
        cur = len(ob.data.polygons)
        ratio = min(1.0, targets[ob.name] / cur)

        ref = _make_reference(ob) if (WRAP_TO_SOURCE or TRANSFER_NORMALS) else None

        _select_only([ob])
        # 既定では無効(PRESMOOTH_ITERS=0)。ボディのざらつき対策として一度
        # 入れたが、元メッシュを同条件でレンダーして比べたところ元は完全に
        # クリアで、ざらつきはデシメートのやりすぎが原因だった。平滑化は
        # 造形を溶かすだけなので、直すならポリゴン数を上げること。
        if PRESMOOTH_ITERS > 0:
            sm = ob.modifiers.new("presmooth", 'SMOOTH')
            sm.factor = PRESMOOTH_FACTOR
            sm.iterations = PRESMOOTH_ITERS
            bpy.ops.object.modifier_apply(modifier=sm.name)
        if ob is body:
            # ラベルは面数配分だけでなくガラスのマテリアル分けにも使う。
            # 属性はDecimateもJoinもまたいで残る。
            _part_budget().store_labels(ob)
        if PART_BUDGET and ob is body:
            _part_budget().decimate_by_part(ob, total_tris=targets[ob.name])
            _log(f"decimate {ob.name}: {cur} -> {len(ob.data.polygons)} (部位別)")
        else:
            mod = ob.modifiers.new("dec", 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
            _log(f"decimate {ob.name}: {cur} -> {len(ob.data.polygons)} (ratio {ratio:.4f})")

        if ref:
            _refit_to_reference(ob, ref)
    return parts


def _make_reference(ob):
    """間引く前の形を、吸着・法線転写のリファレンスとして取っておく。"""
    ref = ob.copy()
    ref.data = ob.data.copy()
    ref.name = REF_PREFIX + ob.name
    ref.data.name = ref.name
    bpy.context.scene.collection.objects.link(ref)
    ref.hide_render = True
    ref.hide_viewport = True
    return ref


def _refit_to_reference(ob, ref):
    """間引いたメッシュを元の面へ吸着させ、元の法線を転写する。"""
    ref.hide_viewport = False  # モディファイアの評価に必要
    _select_only([ob])
    if WRAP_TO_SOURCE:
        sw = ob.modifiers.new("wrap", 'SHRINKWRAP')
        sw.target = ref
        sw.wrap_method = 'NEAREST_SURFACEPOINT'
        sw.offset = 0.0
        bpy.ops.object.modifier_apply(modifier=sw.name)
    if TRANSFER_NORMALS:
        # 転写した法線を後から角度スムーズで上書きしないよう、ここで
        # 全面スムーズにしておく(シャープさは転写される法線が持っている)
        bpy.ops.object.shade_smooth()
        dt = ob.modifiers.new("xfer", 'DATA_TRANSFER')
        dt.object = ref
        dt.use_loop_data = True
        dt.data_types_loops = {'CUSTOM_NORMAL'}
        dt.loop_mapping = 'POLYINTERP_NEAREST'
        bpy.ops.object.datalayout_transfer(modifier=dt.name)
        bpy.ops.object.modifier_apply(modifier=dt.name)
    ref.hide_viewport = True


def stage_join_and_place():
    """結合し、既存GLBと同じ向き・実寸へ整える。"""
    parts = [o for o in bpy.data.objects if o.name.startswith(WORK_NAME)]
    parts.sort(key=lambda o: -len(o.data.polygons))
    _select_only(parts)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = WORK_NAME
    ob.data.name = WORK_NAME

    # 元データは車の前が Blender -X。glTF +Y-up 書き出しでは
    # (x, y, z)_blender -> (x, z, -y)_gltf なので、既存 car_sedan.glb と同じ
    # 「前が glTF -Z」にするには前を Blender +Y へ向ける = Z軸まわり -90度。
    # ※ Meshy(glTF)由来のオブジェクトは rotation_mode が QUATERNION のことがあり、
    #   そのままだと rotation_euler への代入が黙って無視される。
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler = (0.0, 0.0, -math.pi / 2)
    bpy.context.view_layer.update()
    length = max(ob.dimensions)
    s = TARGET_LEN / length
    ob.scale = (s, s, s)

    _select_only([ob])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # 接地させる(最低点をZ=0へ)
    zmin = min((ob.matrix_world @ v.co).z for v in ob.data.vertices)
    ob.location.z -= zmin
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    # 法線を転写している場合、角度スムーズをかけるとカスタム法線が消えて
    # 波打ちが戻る。転写した法線がシャープエッジの情報も持っているので触らない。
    if not TRANSFER_NORMALS:
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(SMOOTH_ANGLE))
        except Exception:
            bpy.ops.object.shade_smooth()
            if hasattr(ob.data, "use_auto_smooth"):
                ob.data.use_auto_smooth = True
                ob.data.auto_smooth_angle = math.radians(SMOOTH_ANGLE)

    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    size = co.max(axis=0) - co.min(axis=0)
    # 回転が効いていないと長手方向がXのまま残る。書き出してから気づくと
    # アプリ側で車が真横を向くので、ここで落とす。
    assert size[1] > size[0], f"long axis must be Blender +Y after rotation, got {size}"
    _log("joined:", len(ob.data.polygons), "tris, size", tuple(round(float(v), 3) for v in size))
    return ob


def _trim_base_color():
    """トリム用のベースカラー。塗装の色を中立な暗色へ置き換える。

    境界を切っても、等値線のすぐ外側の面はまだ塗装寄りの色を持っている。
    ボディを赤にすると、そこだけ元の青が細い線として残って見える。
    塗装色は CarBody が持つので、トリム側のテクスチャからは抜いてよい。
    抜いた跡は暗い線になり、パネルの合わせ目として読める。
    """
    src = bpy.data.images['base_color']
    W, H = src.size
    px = np.empty(W * H * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    sat = rgb.max(axis=1) - rgb.min(axis=1)
    paint = (sat > 0.045) & (rgb[:, 2] > rgb[:, 0])
    out = px.copy()
    out[:, :3][paint] = TRIM_SEAM_RGB
    name = 'base_color_trim'
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, W, H, alpha=True)
    img.colorspace_settings.name = src.colorspace_settings.name
    img.pixels.foreach_set(out.reshape(-1))
    img.pack()
    _log(f"トリム用ベースカラー: 塗装 {int(paint.sum())} texel を中立色へ")
    return img


def _fix_orm():
    """ORMの金属度を暗部で落とす。

    元のORMは窓やグリルまで金属度が高く、粗く分割された面が鏡になって
    明るいファセットとして反射に出る。これはマテリアルの性質の話で、
    部位の境界とは別問題なのでテクスチャ側で直してよい。
    """
    src = bpy.data.images['base_color']
    W, H = src.size
    px = np.empty(W * H * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3]
    sat = rgb.max(axis=1) - rgb.min(axis=1)
    lum = rgb.mean(axis=1)
    dark = (sat <= 0.10) & (lum < 0.42)

    orm_src = bpy.data.images['metallic_roughness']
    W2, H2 = orm_src.size
    p2 = np.empty(W2 * H2 * 4, dtype=np.float32)
    orm_src.pixels.foreach_get(p2)
    p2 = p2.reshape(-1, 4)
    if (W2, H2) == (W, H):
        # 金属度だけ落とす。粗さに一律の上限をかけるとタイヤまで鏡になり、
        # ホイールと窓に白黒の破片が出た。
        p2[:, 2][dark] = 0.0
        _log(f"ORM: 暗部 {int(dark.sum())} texel の金属度を0に")
    name = 'metallic_roughness_fix'
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    orm = bpy.data.images.new(name, W2, H2, alpha=True)
    orm.colorspace_settings.name = 'Non-Color'
    orm.pixels.foreach_set(p2.reshape(-1))
    orm.pack()
    return orm


def stage_materials(ob=None):
    """部位の境界でメッシュを切り、部位ごとにマテリアルを割り当てる。

    面を「どちらの部位か」で振り分けるだけだと、境界は既にある三角形の
    辺に沿うしかない。境界が三角形の途中を通っていても、その面はどちらか
    一方へ倒れる。だから輪郭が必ず階段になり、面数を上げても細かくなる
    だけで消えない。実際に灯火・グリル・窓のふちにギザつきとして出ていた。

    境界の位置でメッシュを切ってしまえば、境界はメッシュの辺そのものに
    なる。実車のモデルで灯火やガラスが別パーツになっているのと同じ形。
    切るのは car_cut_regions.py。

    テクスチャは「境界がどこか」を読むためだけに使う。塗装部は独立した
    面になるので、CarBody はテクスチャを持たない単色マテリアルにできる。
    アプリはそこへ色を入れるだけで済み、シェーダの細工が要らない。
    """
    ob = ob or bpy.data.objects[WORK_NAME]
    me = ob.data
    src_mat = bpy.data.materials['material']
    for name in ('CarBody', 'CarGlass', 'CarLamp', 'CarRubber', 'CarTrim',
                 'CarDetail', '_car_src'):
        old = bpy.data.materials.get(name)
        if old:
            bpy.data.materials.remove(old)

    orm = _fix_orm()
    trim_bc = _trim_base_color()
    base = src_mat.copy()
    base.name = '_car_src'
    for n in base.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or n.image is None:
            continue
        if n.image.name.startswith('metallic_roughness'):
            n.image = orm
        elif n.image.name.startswith('base_color'):
            n.image = trim_bc

    def mk(name, col=None, rough=None, metal=None, keep_map=True, coat=0.0):
        m = base.copy()
        m.name = name
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        if not keep_map:
            for l in list(b.inputs['Base Color'].links):
                nt.links.remove(l)
        if col is not None:
            b.inputs['Base Color'].default_value = (*col, 1.0)
        if rough is not None:
            for l in list(b.inputs['Roughness'].links):
                nt.links.remove(l)
            b.inputs['Roughness'].default_value = rough
        if metal is not None:
            for l in list(b.inputs['Metallic'].links):
                nt.links.remove(l)
            b.inputs['Metallic'].default_value = metal
        for sock, val in (('Coat Weight', coat), ('Coat Roughness', 0.10)):
            if sock in b.inputs:
                b.inputs[sock].default_value = val
        return m

    mats = [
        # 塗装。テクスチャを持たないので、アプリは color を入れるだけでよい
        mk('CarBody', BODY_RGB, 0.28, 0.10, keep_map=False, coat=0.55),
        mk('CarGlass', GLASS_RGB, 0.10, 0.0, keep_map=False),
        mk('CarLamp', None, 0.12, 0.0, keep_map=True),
        mk('CarRubber', RUBBER_RGB, 0.85, 0.0, keep_map=False),
        mk('CarTrim', None, None, None, keep_map=True),
    ]
    cut = _cut_regions()
    idx = cut.assign_regions(ob, cut.region_masks(),
                             order=['paint', 'glass', 'lamp', 'rubber'],
                             materials=mats)
    for i, m in enumerate(mats):
        _log(f"  {m.name:9s}: {int((idx == i).sum())} 面")
    mi = np.clip(idx, 0, len(mats) - 1)
    me.polygons.foreach_set("material_index", mi)
    me.update()
    return ob


def stage_export(ob=None):
    ob = ob or bpy.data.objects[WORK_NAME]
    # 部位ラベルの属性はここまでの内部用。glTFへ持ち出さない
    a = ob.data.attributes.get('pb_label')
    if a:
        ob.data.attributes.remove(a)
    # join直後は car_hb.007 のような連番名が残ることがある。
    # 書き出されるノード名になるので揃えておく。
    for other in bpy.data.objects:
        if other is not ob and other.name == WORK_NAME:
            other.name = WORK_NAME + "_old"
    ob.name = WORK_NAME
    ob.data.name = WORK_NAME
    _select_only([ob])
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    import os
    _log("exported", OUT, os.path.getsize(OUT), "bytes")
    return OUT


def run():
    stage_split()
    stage_decimate()
    ob = stage_join_and_place()
    stage_materials(ob)
    stage_export(ob)


if __name__ == "__main__":
    run()
