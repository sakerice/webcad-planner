"""部位の境界そのものをエッジとして切り、部位ごとにマテリアルを割り当てる。

【なぜ切るのか】
面を「どちらの部位か」で振り分けるだけだと、境界は既にある三角形の辺に
沿うしかない。境界が三角形の途中を通っていても、その面はどちらか一方へ
倒れる。だから輪郭が必ず階段になる。面数を上げても階段が細かくなるだけで、
原理的に消えない。

境界の位置でメッシュを切ってしまえば、境界はメッシュの辺そのものになる。
階段は出ない。実車のモデルで灯火やガラスが別パーツになっているのと同じ形。

【境界の位置をどこから知るか】
この元データ(Meshy)は車体全体が1枚の連続した皮で、部位の切れ目が
ジオメトリに無い。どこが塗装でどこがガラスかを持っているのはテクスチャ
だけなので、そこから読む。読むのに使うだけで、成果物はポリゴンと
マテリアルになる。テクスチャは実行時のマスクには使わない。

【やり方】
部位ごとに 0..1 の連続値マスクをテクスチャから作り、頂点ごとに評価して、
0.5 の等値線が横切る辺を分割する(marching triangles)。分割点は辺上の
線形補間なので、辺を共有する両側の面で必ず一致する。隙間は開かない。
分割後に、新しくできた2頂点を結んで面を割る。
"""
import bpy
import bmesh
import numpy as np

# 部位。順に切っていく。名前 / マテリアル名 / 表示色 / 粗さ / 金属度
REGIONS = [
    ('paint',  'CarBody',  None,                  None, None),
    ('glass',  'CarGlass', (0.035, 0.040, 0.046), 0.10, 0.0),
    ('lamp',   'CarLamp',  None,                  0.12, 0.0),
    ('rubber', 'CarRubber', (0.030, 0.030, 0.033), 0.85, 0.0),
]
EPS_SNAP = 0.06     # これより端に寄った交点は頂点へ寄せる(細長い面を作らない)


def _log(*a):
    print("[cut_regions]", *a)


def _smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def region_masks(img_name='base_color'):
    """ベースカラーから、部位ごとの 0..1 マスクを作る。

    二値で切らず階調にする。元テクスチャの境界は中間色でなめらかに
    繋がっているので、二値化すると等値線がテクセルの角を拾ってしまう。
    """
    img = bpy.data.images[img_name]
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(H, W, 4)[:, :, :3]
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    blue = rgb[:, :, 2] - rgb[:, :, 0]
    red = rgb[:, :, 0] - rgb[:, :, 2]

    paint = _smoothstep(sat, 0.045, 0.135) * _smoothstep(blue, 0.0, 0.035)
    lamp = _smoothstep(sat, 0.06, 0.16) * _smoothstep(red, 0.01, 0.05)
    # ガラスは明度だけでは灰色の樹脂と区別が付かない。無彩色で明るすぎない、
    # までをテクスチャで見て、ベルトラインより上かどうかは位置で足す(GATES)
    glassish = (_smoothstep(0.10 - sat, 0.0, 0.02)
                * _smoothstep(0.42 - lum, 0.0, 0.06))
    rubber = (_smoothstep(0.10 - sat, 0.0, 0.02)
              * _smoothstep(0.045 - lum, 0.0, 0.015))
    return {'paint': paint, 'glass': glassish, 'lamp': lamp, 'rubber': rubber}


# 位置で絞る条件。テクスチャだけでは決まらない部位に使う。
# 座標は最終メッシュ(長手Y・上Z・原点は接地面)。
Z_BELT = 1.00


def _gate_glass(co):
    """ベルトラインより上だけをガラスとみなす。下の灰色樹脂を巻き込まない。"""
    return _smoothstep(co[:, 2], Z_BELT - 0.03, Z_BELT + 0.03)


GATES = {'glass': _gate_glass}


def _sample(mask, uv):
    """UV配列(N,2)でマスクを引く。テクセル中心の最近傍。"""
    H, W = mask.shape
    xs = np.clip((uv[:, 0] % 1.0 * W).astype(np.int32), 0, W - 1)
    ys = np.clip((uv[:, 1] % 1.0 * H).astype(np.int32), 0, H - 1)
    return mask[ys, xs]


def _vertex_values(bm, uv_layer, mask, gate=None):
    """頂点ごとのマスク値。

    UVの継ぎ目では1頂点が複数のUVを持つ。面ごとに値が違うと、辺を共有する
    2面で切る位置がずれて隙間が開く。頂点あたり1つの値に均しておく。
    """
    bm.verts.ensure_lookup_table()
    nv = len(bm.verts)
    uvs = []
    idx = []
    for f in bm.faces:
        for l in f.loops:
            uvs.append(l[uv_layer].uv)
            idx.append(l.vert.index)
    uvs = np.array([[u[0], u[1]] for u in uvs], dtype=np.float64)
    idx = np.array(idx, dtype=np.int64)
    vals = _sample(mask, uvs)
    acc = np.zeros(nv)
    cnt = np.zeros(nv)
    np.add.at(acc, idx, vals)
    np.add.at(cnt, idx, 1.0)
    out = acc / np.maximum(cnt, 1.0)
    if gate is not None:
        co = np.array([[v.co[0], v.co[1], v.co[2]] for v in bm.verts])
        out = out * gate(co)
    return out


def cut_along(bm, uv_layer, mask, level=0.5, gate=None):
    """マスクの等値線に沿ってメッシュを切る。

    切った後の頂点ごとのフィールド値を返す。等値線上の頂点はちょうど
    level を持つので、面がどちら側かを後から厳密に判定できる。
    """
    val = _vertex_values(bm, uv_layer, mask, gate)
    bm.verts.ensure_lookup_table()

    # 1) 等値線が頂点のすぐ近くを通る辺は、その頂点を境界とみなす。
    #    無理に分割すると細長い面ができる。
    for e in bm.edges:
        a, b = e.verts
        va, vb = val[a.index], val[b.index]
        if (va >= level) == (vb >= level) or va == vb:
            continue
        t = (level - va) / (vb - va)
        if t < EPS_SNAP:
            val[a.index] = level
        elif t > 1.0 - EPS_SNAP:
            val[b.index] = level

    # 2) 符号が厳密に分かれる辺だけ分割する
    marks = []
    for e in bm.edges:
        a, b = e.verts
        va, vb = val[a.index], val[b.index]
        if (va - level) * (vb - level) >= 0.0:
            continue
        marks.append((e, a, float((level - va) / (vb - va))))

    field = {v: float(val[v.index]) for v in bm.verts}
    for e, a, t in marks:
        try:
            _, nv = bmesh.utils.edge_split(e, a, t)
        except (ValueError, ReferenceError):
            continue
        field[nv] = level     # 新しい頂点は等値線そのもの

    # 3) 境界の頂点2つを結んで面を割る
    bm.faces.ensure_lookup_table()
    split = 0
    for f in list(bm.faces):
        on = [v for v in f.verts if field.get(v, 0.0) == level]
        if len(on) != 2:
            continue
        try:
            bmesh.utils.face_split(f, on[0], on[1])
            split += 1
        except (ValueError, ReferenceError):
            continue
    return len(marks), split, field


def face_side(f, field, level=0.5):
    """面が等値線のどちら側にあるか。境界上の頂点は無視する。"""
    vals = [field.get(v, 0.0) for v in f.verts]
    inner = [x for x in vals if x != level]
    if not inner:
        return None
    return sum(1 for x in inner if x > level) * 2 >= len(inner)


def assign_regions(ob, masks, order=None, materials=None):
    """境界で切ってから、面ごとに部位を決めてマテリアルを割り当てる。

    先に切った境界を後の切り込みが壊さないよう、部位は順に処理する。
    面の所属は、切った直後のフィールドで決めて面へ書き込む。
    """
    order = order or [r[0] for r in REGIONS]
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv_layer = bm.loops.layers.uv.active
    tag = bm.faces.layers.int.get('region') or bm.faces.layers.int.new('region')
    n0 = len(bm.faces)
    for f in bm.faces:
        f[tag] = -1
    for gi, key in enumerate(order):
        if key not in masks:
            continue
        cut, split, field = cut_along(bm, uv_layer, masks[key],
                                      gate=GATES.get(key))
        bm.faces.ensure_lookup_table()
        hit = 0
        for f in bm.faces:
            if f[tag] >= 0:
                continue        # 先に決まった部位が優先
            if face_side(f, field):
                f[tag] = gi
                hit += 1
        _log(f"  {key:7s}: 辺{cut}本を分割 / 面{split}枚を分断 -> "
             f"{hit}面が該当 (総面数 {len(bm.faces)})")
    for f in bm.faces:
        if f[tag] < 0:
            f[tag] = len(order)     # どれでもない = その他トリム
    idx = np.array([f[tag] for f in bm.faces], dtype=np.int32)
    bm.to_mesh(me)
    bm.free()
    if materials:
        me.materials.clear()
        for m in materials:
            me.materials.append(m)
        me.polygons.foreach_set("material_index",
                                np.clip(idx, 0, len(materials) - 1))
        me.update()
    _log(f"境界の切り出し: {n0} -> {len(me.polygons)} 面 "
         f"(+{len(me.polygons) - n0})")
    return idx
