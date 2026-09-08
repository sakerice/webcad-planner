"""車体を「視覚的な役割」で分け、役割ごとに面数を割り当てて間引く。

一律に間引くと、削る配分が「その形が何であるか」を見ない。ホイールの
スポークが大きく平らなドア面より強く削られ、ガラスは「大きくて平らだから」
真っ先に削られて、金属質の反射がファセットとして出る。

【この元データで分かった制約】
  * 車体シェル124万面は**まるごと1つの島**。ガラスも灯火もミラーも
    グリルも本体に溶接されていて、パーツとして取り出せない。
    切り離して別々に間引くと、必ず境界に亀裂が入る。
  * パネルの合わせ目は貫通した溝ではなく浅い窪み。稜線で割っても
    (25/35/50度いずれも)63万面のまま1枚で、ボンネットやドアハンドルは
    分離できない。これらは1枚の塗装面の上の起伏でしかない。
  * ホイールだけは別の島(6個)なので、独立して扱える。

【なので採った方法】
  面ごとに役割ラベルを付け、**役割ごとに1回ずつ Decimate をかける**。
  対象の役割だけウェイト1.0、他は0.0の頂点グループを作る。
  ウェイト0の領域は一切削られないので、他の役割は完全に無傷のまま、
  狙った役割からだけ狙った枚数を落とせる(検証済み: 6万面の削減が
  100%「内側」から出て、他7役割は±2面)。

  中間的なウェイト(0.15〜0.95)で一発で配分する方法も試したが、
  Blender側の効き方が読み切れず、守りたい灯火が-50%になるなど
  狙いと逆に出た。二値のロックだけを使うこと。

座標系はMeshy元データのまま(長手X、リアが+X、フロントが-X、上が+Z、全長1.9)。
"""
import bpy
import bmesh
import numpy as np

# 役割ごとの割り当て枚数(車体シェル分。合計 90,000)と、確認用の表示色。
#
# 一律に間引いたときの内訳と比べて決めている:
#   塗装 45,685 / ガラス 12,758 / 灯火 1,790 / グリル 8,118 /
#   ミラー 1,150 / アーチ 6,056 / トリム 8,948 / 内側 5,494
#
# ガラスを増やしているのは、窓に出ていた明るいファセットが
# 「削りすぎ」だったため。大きくて平らな面は二次誤差では真っ先に
# 削られるが、金属質の反射が乗るので絵では最も粗が目立つ。
GROUPS = [
    ("paint",  "塗装ボディ",       45500, (0.32, 0.46, 0.86)),
    ("glass",  "ガラス",           17000, (0.20, 0.72, 0.68)),
    ("lamp",   "灯火",              3500, (0.92, 0.32, 0.28)),
    ("grille", "グリル・開口",      8000, (0.95, 0.66, 0.18)),
    ("mirror", "ミラー",            2000, (0.78, 0.36, 0.86)),
    ("arch",   "アーチライナー",    4000, (0.42, 0.42, 0.48)),
    ("trim",   "その他トリム",      8000, (0.96, 0.90, 0.55)),
    ("hidden", "内側・見えない面",  2000, (0.14, 0.14, 0.16)),
]
SHELL_TRIS = sum(g[2] for g in GROUPS)
GIDX = {g[0]: i for i, g in enumerate(GROUPS)}

# 元データの実測値(前段の島分離で確認したもの)
WHEEL_CTR = [(-0.566, -0.341, -0.202), (-0.566, 0.341, -0.202),
             (+0.631, +0.341, -0.202), (+0.631, -0.340, -0.202)]
WHEEL_R = 0.152
X_FRONT, X_REAR = -0.95, 0.95
BODY_HALF_W = 0.406     # ミラーを除いた車体の半幅(実測: 全長方向どこでも0.402)
MIRROR_X = (-0.42, -0.15)  # ミラーが張り出しているX範囲(実測 -0.38..-0.19)
Z_BELT = 0.11           # ベルトライン(ここより上がグリーンハウス)


def _log(*a):
    print("[segment]", *a)


def face_data(ob):
    me = ob.data
    nf = len(me.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("center", ctr)
    nor = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("normal", nor)
    ar = np.empty(nf, dtype=np.float64)
    me.polygons.foreach_get("area", ar)
    return ctr.reshape(-1, 3), nor.reshape(-1, 3), ar


def texture_class(ob, img_name='base_color'):
    """面ごとのベースカラー分類。0塗装 1赤 2暗 3明 4中間。"""
    me = ob.data
    img = bpy.data.images[img_name]
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)[:, :, :3]
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    nf = len(me.polygons)
    ls = np.empty(nf, dtype=np.int32)
    lt = np.empty(nf, dtype=np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    mt = int(lt.max())
    c = sum(uv[ls + np.minimum(k, lt - 1)] for k in range(mt)) / mt
    xs = np.clip((c[:, 0] % 1.0 * W).astype(np.int32), 0, W - 1)
    ys = np.clip((c[:, 1] % 1.0 * H).astype(np.int32), 0, H - 1)
    rgb = px[ys, xs]
    sat = rgb.max(axis=1) - rgb.min(axis=1)
    lum = rgb.mean(axis=1)
    cls = np.full(nf, 4, dtype=np.int32)
    cls[(sat > 0.10) & (rgb[:, 2] > rgb[:, 0])] = 0
    cls[(sat > 0.12) & (rgb[:, 0] > rgb[:, 2])] = 1
    cls[(sat <= 0.10) & (lum < 0.16)] = 2
    cls[(sat <= 0.10) & (lum > 0.55)] = 3
    return cls


def label_faces(ob):
    """面ごとに役割ラベルを返す。"""
    ctr, nor, area = face_data(ob)
    cls = texture_class(ob)
    nf = len(ctr)
    x, y, z = ctr[:, 0], ctr[:, 1], ctr[:, 2]
    ay = np.abs(y)

    g = np.full(nf, GIDX['paint'], dtype=np.int32)

    # その他トリム: 暗部・明部・中間で、塗装でないもの
    g[(cls == 2) | (cls == 3) | (cls == 4)] = GIDX['trim']

    # ガラス: ベルトラインより上の暗部・中間。屋根の塗装は含めない
    green = (z > Z_BELT) & ((cls == 2) | (cls == 4))
    g[green] = GIDX['glass']

    # グリル・開口: 前端の下側
    g[(x < X_FRONT + 0.16) & (z < Z_BELT) & (cls != 0)] = GIDX['grille']

    # 灯火: 赤、または前後端の明部
    lamp = (cls == 1) | ((cls == 3) & ((x < X_FRONT + 0.20) | (x > X_REAR - 0.20)))
    g[lamp] = GIDX['lamp']

    # ミラー: 車体の側面より外へ張り出している部分。フェンダーの膨らみを
    # 拾わないよう、実測したX範囲に限る
    g[(ay > BODY_HALF_W) & (x > MIRROR_X[0]) & (x < MIRROR_X[1])] = GIDX['mirror']

    # アーチライナー: ホイール中心の近くで、開口の内側
    arch = np.zeros(nf, dtype=bool)
    for cx, cy, cz in WHEEL_CTR:
        r = np.sqrt((x - cx) ** 2 + (z - cz) ** 2)
        arch |= (r < WHEEL_R + 0.045) & (np.sign(y) == np.sign(cy)) & (ay > 0.20)
    g[arch & (cls != 0)] = GIDX['arch']

    # 内側・見えない面: キャビンの中、または法線が内を向いている床下
    inside = (ay < BODY_HALF_W - 0.05) & (z > Z_BELT - 0.04) & (z < 0.30) \
        & (x > X_FRONT + 0.42) & (x < X_REAR - 0.30) & (nor[:, 2] < 0.2) \
        & (cls != 0) & ~green
    under = (z < -0.16) & (nor[:, 2] < -0.55)
    g[inside | under] = GIDX['hidden']

    return g, area


def report(g, area):
    """役割ごとの面数・面積比・割り当てを並べる。"""
    tot_a = area.sum()
    _log(f"{'役割':16s} {'面数':>9s} {'比':>6s} {'面積比':>7s} {'割当':>8s}")
    for i, (key, jp, tgt, _) in enumerate(GROUPS):
        m = g == i
        _log(f"{jp:16s} {int(m.sum()):9d} {100*m.mean():5.1f}% "
             f"{100*area[m].sum()/tot_a:6.1f}% {tgt:8d}")
    return len(g), tot_a


def colorize(ob, g, name='seg_view'):
    """ラベルを色で塗ったコピーを作る。分類が正しいかは目で見て確かめる。"""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    o = ob.copy()
    o.data = ob.data.copy()
    o.name = name
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.clear()
    for key, jp, tgt, rgb in GROUPS:
        mn = f'seg_{key}'
        m = bpy.data.materials.get(mn)
        if m:
            bpy.data.materials.remove(m)
        m = bpy.data.materials.new(mn)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Roughness'].default_value = 0.45
        b.inputs['Metallic'].default_value = 0.0
        o.data.materials.append(m)
    o.data.polygons.foreach_set("material_index", g.astype(np.int32))
    o.data.update()
    return o


def binary_group(ob, face_mask, name='pb_target', strict=True):
    """対象の面だけウェイト1.0、他は0.0の頂点グループを作る。

    strict=True は境界の頂点を0へ倒す(全ての隣接面が対象のときだけ1)。
    隣の役割のふちが一緒に削れて痩せるのを防ぐ。守りたい役割はこちら。

    strict=False は隣接面が1つでも対象なら1にする。境界も動けるので
    細い領域を最後まで縮められる。境界がわずかに隣へ食い込むので、
    見えない内側や暗いライナーのように、ふちの精度が要らない役割だけ。
    (strict のままだと内側は 8.6万面から1.9万面までしか縮まなかった)
    """
    me = ob.data
    vg = ob.vertex_groups.get(name)
    if vg:
        ob.vertex_groups.remove(vg)
    vg = ob.vertex_groups.new(name=name)
    nf = len(me.polygons)
    lt = np.empty(nf, dtype=np.int32)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    fw = np.repeat(face_mask.astype(np.float64), lt)
    if strict:
        acc = np.ones(len(me.vertices))
        np.minimum.at(acc, lv, fw)
    else:
        acc = np.zeros(len(me.vertices))
        np.maximum.at(acc, lv, fw)
    idx = np.nonzero(acc > 0.5)[0].tolist()
    if idx:
        vg.add(idx, 1.0, 'REPLACE')
    return vg, len(idx)


LABEL_ATTR = 'pb_label'


def store_labels(ob, g=None):
    """役割ラベルを面の属性として持たせる。

    Decimate をまたいでも属性は残り、比率もそのまま保たれる(検証済み)。
    段ごとにラベルを引き直すと、粗くなるにつれて境界の面が別の役割へ
    化けてしまい、狙った枚数に収束しない(合計が9万に対し12.9万になった)。
    """
    me = ob.data
    if g is None:
        g, _ = label_faces(ob)
    if LABEL_ATTR in me.attributes:
        me.attributes.remove(me.attributes[LABEL_ATTR])
    at = me.attributes.new(name=LABEL_ATTR, type='INT', domain='FACE')
    at.data.foreach_set('value', g.astype(np.int32))
    return g


def read_labels(ob):
    me = ob.data
    v = np.empty(len(me.polygons), dtype=np.int32)
    me.attributes[LABEL_ATTR].data.foreach_get('value', v)
    return np.clip(v, 0, len(GROUPS) - 1)


# ふちの精度が要らない役割。境界も解放して最後まで縮める
LOOSE = {'hidden', 'arch', 'trim'}
# 何段目で落とすか。見えない内側から順に、守りたいものを後に回す。
# 塗装は最後。総数の帳尻をここで合わせる。
ORDER = ['hidden', 'arch', 'trim', 'grille', 'lamp', 'mirror', 'glass', 'paint']


def _shrink(ob, key, want, passes=1):
    i = GIDX[key]
    jp = GROUPS[i][1]
    for _ in range(passes):
        g = read_labels(ob)
        have = int((g == i).sum())
        if have <= want:
            break
        _, nsel = binary_group(ob, g == i, strict=key not in LOOSE)
        if nsel == 0:
            break
        total = len(ob.data.polygons)
        _select_only(ob)
        d = ob.modifiers.new('pb', 'DECIMATE')
        d.decimate_type = 'COLLAPSE'
        d.ratio = max(0.0, (total - (have - want)) / total)
        d.use_collapse_triangulate = True
        d.vertex_group = 'pb_target'
        d.vertex_group_factor = 1.0
        bpy.ops.object.modifier_apply(modifier=d.name)
        if len(ob.data.polygons) >= total:
            break          # これ以上は縮まない
    g = read_labels(ob)
    _log(f"  {jp:16s} -> {int((g == i).sum()):6d} 面 (割当 {want}) "
         f"／ 全体 {len(ob.data.polygons)}")


def decimate_by_part(ob, targets=None, total_tris=None):
    """役割ごとに1回ずつ Decimate をかけ、狙った枚数まで落とす。

    ウェイト0の領域は一切削られないので、役割どうしが干渉しない。
    細い領域は境界のロックで縮みきらないことがあるため、最後に塗装で
    総数の帳尻を合わせる(塗装は面積の45%を占める最大の役割なので、
    多少増減しても密度がほとんど変わらない)。
    """
    targets = dict(targets or {k: t for k, _, t, _ in GROUPS})
    total_tris = total_tris or SHELL_TRIS
    if LABEL_ATTR not in ob.data.attributes:
        store_labels(ob)
    _log(f"部位別に間引く: {len(ob.data.polygons)} 面 -> 目標 {total_tris}")
    for key in ORDER:
        if key == 'paint':
            g = read_labels(ob)
            have = int((g == GIDX['paint']).sum())
            rest = len(ob.data.polygons) - have
            targets['paint'] = max(1000, total_tris - rest)
        _shrink(ob, key, targets[key], passes=3 if key in LOOSE else 1)
    vg = ob.vertex_groups.get('pb_target')
    if vg:
        ob.vertex_groups.remove(vg)
    _log(f"完了: {len(ob.data.polygons)} 面")
    return ob


def _select_only(ob):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
