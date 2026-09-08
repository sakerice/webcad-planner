"""【この方式は採用しない。記録として残す】

車体を1枚の滑らかな面として張り直す方式。6周ぶんのループを回した末に、
「風船みたいになって波打っている」という指摘で破棄した。

  張り直し 23,583面 : 元からのズレ 中央1.93 / p95 21.05 / 最大164.72 mm
                      稜線(二面角>30°の総延長) 13.8 m
  元メッシュ         : 581 m
  Decimate 45,999面 : 元からのズレ 中央0.44 / p95 1.20 / 最大2.71 mm / 稜線 648 m

つまり同じ予算なら、素直に間引いたほうが桁違いに忠実。
車体は1枚の滑らかな面ではなく、稜線と見切りで区切られたパネルの集合なので、
単一の制御網で近似すると制御点間隔(4.3mに64x96で約67mm)より細かい造形が
原理的に全部落ちる。細かくすればノイズが戻り、粗くすれば風船になる。

なぜ6周も気づかなかったか: 品質の物差しに「隣接面の法線角度」を使っていた。
この指標は完全な楕円体が満点になるので、詰めるほど風船へ最適化される。
形の忠実度は必ず「元データからの距離」と「稜線の残存量」で押さえること。

現行の方針は tools/blender/car_meshy_reduce.py(Decimate + Shrinkwrap +
法線転写)。波打ちの正体はノイズではなく面数不足で、6万→9万で見切りが戻り、
18万でほぼ元と同一になる。

【当時の記録（要点のみ。詳細な周回記録は破棄時に整理した）】

  * 元メッシュの頂点ノイズを疑って平滑化を試したが、いずれも失敗した。
    Taubin は必要な 0.034mm に対し 1.147→0.379mm までしか落ちず、
    バイラテラル法線フィルタは発散(隣接面角度 中央 3.95°→5.93°)、
    Blender の Laplacian は形を 43mm 動かしただけでノイズは減らなかった。
    そもそも元はクリアだった(200k の Decimate で最大ズレ 0.82mm)ので、
    この診断自体が誤りだった。
  * 断面サンプリングは前後端で断面がスパインを囲まずレイが外れる。
    断面ごとに中心を取り直す sample_sections() で解消(外れ 1.18%→0.14%)。
  * 極座標での復元は破綻する(隣接面角度 p99=143°)。fit_surface_xyz() で
    3D座標のまま最小二乗当てはめする方式なら通る。
  * 最後に Decimate で軽くするのは駄目(隣接面角度 1.74°→5.78°)。
    軽くするなら制御点数を減らす。
  * 灯火・グリルの輪郭はベイクのマスクからでは出ない。実寸から比率で
    置き直す必要がある(front_bumper_outlines / rear_lamp_outlines)。
  * UVの継ぎ目をまたぐ面は UV bbox がアトラスの端から端まで伸びる。
    bbox でテクスチャを塗ると無関係な場所まで塗られ「白い破れ」になる。
  * 面マスクでテクスチャを塗り分けると境界が面の目(約5cm)に沿って鋸歯に
    なる。texel_coord_map() で座標をアトラスへ焼き、テクセル単位で切る。
  * 角柱ブーリアンは面が回り込む場所(バンパーのコーナー、リア)で切り口が
    裂ける。build_surface_lens() で面に沿って板を張るほうが確実。
  * matp() は同名マテリアルを作り直す。2度呼ぶと先に割り当てたスロットが
    空になり、そのパーツが真っ白で出る。
"""


import bpy
import bmesh
import math
import os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

# ── 設定 ────────────────────────────────────────────────────
SRC_OBJ = "Meshy_Blue Hatchback Blueprint_mesh_node.001"  # テクスチャなし版
REF_NAME = "rs_ref"          # 参照(車体シェル)
REF_WHEELS = "rs_wheel"      # 参照(ホイール系)
WORK = "rs_body"             # 張り直した車体

TARGET_LEN = 4.30            # 全長[m]
NS, NR = 72, 72              # 長手方向の断面数 / 断面まわりの分割数

INIT_SIGMA = 3.0             # 下地を作るときの平滑化
FIT_ITERS = 26               # 交互反復の回数
FIT_W = 0.85                 # 1回あたり元形状へ寄せる割合
FIT_SIGMA = 1.25             # 反復中の平滑化(小さいほど形に忠実・面は荒れる)
FINAL_SIGMA = 1.0            # 最後にかける仕上げの平滑化

ARCH_MARGIN = 1.12           # ホイール半径の何倍まで「寄せない」ことにするか
OUT_DIR = "/private/tmp/claude-501/-Users-nariiwa-Projects-webcad-planner/3a2c4a7a-9949-42d5-89bd-7b225863f4e3/scratchpad"


def _log(*a):
    print("[car_resurface]", *a)


def _select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    objs = list(objs)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def _co(ob):
    a = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def stage_reference():
    """Meshyの形状を実寸・長手方向Xで用意し、車体シェルとホイールに分ける。"""
    for ob in list(bpy.data.objects):
        if ob.name.startswith(REF_NAME) or ob.name.startswith(REF_WHEELS):
            bpy.data.objects.remove(ob, do_unlink=True)

    src = bpy.data.objects[SRC_OBJ]
    d = src.copy()
    d.data = src.data.copy()
    d.name = REF_NAME
    bpy.context.scene.collection.objects.link(d)
    d.rotation_mode = 'XYZ'
    d.rotation_euler = (0, 0, 0)
    s = TARGET_LEN / max(src.dimensions)
    d.scale = (s, s, s)
    d.location = (0, 0, 0)
    _select_only([d])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.mesh.separate(type='LOOSE')

    parts = [o for o in bpy.data.objects if o.name.startswith(REF_NAME)]
    parts.sort(key=lambda o: -len(o.data.polygons))
    shell, wheels = parts[0], parts[1:]
    shell.name = REF_NAME
    for i, w in enumerate(wheels):
        w.name = f"{REF_WHEELS}{i}"

    # 接地させる(全体の最低点をZ=0へ)
    zmin = min(float(_co(o)[:, 2].min()) for o in [shell] + wheels)
    for o in [shell] + wheels:
        o.location.z -= zmin
        _select_only([o])
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        o.hide_render = True

    _log(f"reference shell {len(shell.data.polygons)} polys, wheels {len(wheels)}")
    return shell, wheels


def wheel_disks(wheels):
    """各ホイールの中心と半径。アーチの切り欠きとフィット除外に使う。"""
    seen = []
    for w in wheels:
        c = _co(w)
        lo, hi = c.min(axis=0), c.max(axis=0)
        ctr = (lo + hi) / 2.0
        rad = float(max(hi[0] - lo[0], hi[2] - lo[2]) / 2.0)
        for s in seen:
            if abs(s['c'][0] - ctr[0]) < 0.15 and abs(s['c'][1] - ctr[1]) < 0.15:
                s['r'] = max(s['r'], rad)
                break
        else:
            seen.append({'c': ctr, 'r': rad})
    for s in seen:
        _log(f"  wheel center {tuple(round(float(v),3) for v in s['c'])} r={s['r']:.3f}")
    return seen


# ── グリッド上の平滑化 ────────────────────────────────────────
def _gauss(sig):
    k = int(max(1, round(sig * 3)))
    x = np.arange(-k, k + 1)
    g = np.exp(-0.5 * (x / sig) ** 2)
    return g / g.sum()


def _conv_axis(A, g, axis, wrap):
    k = (len(g) - 1) // 2
    n = A.shape[axis]
    if wrap:
        pad = np.concatenate([np.take(A, range(n - k, n), axis=axis), A,
                              np.take(A, range(0, k), axis=axis)], axis=axis)
    else:
        first = np.take(A, [0], axis=axis)
        last = np.take(A, [n - 1], axis=axis)
        pad = np.concatenate([np.repeat(first, k, axis=axis), A,
                              np.repeat(last, k, axis=axis)], axis=axis)
    return np.apply_along_axis(lambda v: np.convolve(v, g, mode='valid'), axis, pad)


def grid_smooth(P, sig_i, sig_j=None):
    """(NS, NR, 3) の格子を、断面方向(j)は巡回・長手方向(i)は端固定でぼかす。

    長手方向と断面方向で強さを変えられる。稜線は車の長手方向に走るので、
    長手方向を強め・断面方向を弱めにすると、稜線を残したままノイズだけ落ちる。
    """
    sig_j = sig_i if sig_j is None else sig_j
    out = P
    if sig_j > 0:
        out = _conv_axis(out, _gauss(sig_j), axis=1, wrap=True)
    if sig_i > 0:
        out = _conv_axis(out, _gauss(sig_i), axis=0, wrap=False)
    return out


def stage_init_grid(shell):
    """断面レイキャストで下地の四角グリッドを作る。"""
    c = _co(shell)
    lo, hi = c.min(axis=0), c.max(axis=0)
    zc = float(lo[2] + (hi[2] - lo[2]) * 0.45)
    xs = np.linspace(float(lo[0]) + 0.005, float(hi[0]) - 0.005, NS)
    ang = np.arange(NR) * 2.0 * math.pi / NR
    R = 8.0
    r = np.full((NS, NR), np.nan)
    for i, x in enumerate(xs):
        base = Vector((float(x), 0.0, zc))
        for j in range(NR):
            d = Vector((0.0, math.cos(ang[j]), math.sin(ang[j])))
            ok, loc, nor, fi = shell.ray_cast(base + d * R, -d, distance=R * 2)
            if ok:
                r[i, j] = (base - loc).length
    # 欠損を角度方向に補間
    idx = np.arange(NR)
    for i in range(NS):
        row = r[i]
        bad = np.isnan(row)
        if bad.all():
            row[:] = 0.4
            continue
        good = ~bad
        ext = np.concatenate([idx[good] - NR, idx[good], idx[good] + NR])
        val = np.concatenate([row[good]] * 3)
        row[bad] = np.interp(idx[bad], ext, val)

    P = np.empty((NS, NR, 3))
    P[:, :, 0] = xs[:, None]
    P[:, :, 1] = r * np.cos(ang)[None, :]
    P[:, :, 2] = zc + r * np.sin(ang)[None, :]
    P = grid_smooth(P, INIT_SIGMA, INIT_SIGMA)
    _log(f"init grid {NS}x{NR}, spine z={zc:.3f}")
    return P


def stage_fit(P, shell, disks, iters=FIT_ITERS, w=FIT_W, sigma=FIT_SIGMA,
              final_sigma=FINAL_SIGMA, sigma_j=None, final_sigma_j=None):
    """「元形状へ寄せる → 平滑化」を交互に反復して面を整える。"""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(shell, dg)

    # ホイールアーチの内側は寄せない(下地の面で跨ぐ)。あとでブーリアンで切る。
    mask = np.ones((NS, NR))
    for d in disks:
        dx = P[:, :, 0] - d['c'][0]
        dz = P[:, :, 2] - d['c'][2]
        near = np.sqrt(dx ** 2 + dz ** 2) < d['r'] * ARCH_MARGIN
        mask[near] = 0.0
    _log(f"  arch mask: {int((mask == 0).sum())}/{mask.size} points held back")

    for it in range(iters):
        flat = P.reshape(-1, 3)
        tgt = np.empty_like(flat)
        for n in range(len(flat)):
            loc, nor, fi, dist = bvh.find_nearest(Vector(flat[n].tolist()))
            tgt[n] = flat[n] if loc is None else np.array(loc)
        tgt = tgt.reshape(NS, NR, 3)
        P = P + (tgt - P) * (w * mask)[:, :, None]
        P = grid_smooth(P, sigma, sigma_j)
    if final_sigma:
        P = grid_smooth(P, final_sigma, final_sigma_j)

    flat = P.reshape(-1, 3)
    dev = []
    for n in range(0, len(flat), 7):
        loc, nor, fi, dist = bvh.find_nearest(Vector(flat[n].tolist()))
        if loc is not None:
            dev.append(dist)
    dev = np.array(dev)
    _log(f"fit done: 元形状との距離 平均 {dev.mean()*1000:.1f}mm "
         f"中央 {np.median(dev)*1000:.1f}mm p95 {np.percentile(dev,95)*1000:.1f}mm")
    return P


def build_mesh(P, name=WORK):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    verts = [(float(P[i, j, 0]), float(P[i, j, 1]), float(P[i, j, 2]))
             for i in range(NS) for j in range(NR)]
    faces = [(i * NR + j, i * NR + (j + 1) % NR,
              (i + 1) * NR + (j + 1) % NR, (i + 1) * NR + j)
             for i in range(NS - 1) for j in range(NR)]
    faces.append(tuple(range(NR - 1, -1, -1)))
    faces.append(tuple(range((NS - 1) * NR, NS * NR)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    _select_only([ob])
    bpy.ops.object.shade_smooth()
    _log(f"built {name}: {len(me.polygons)} quads")
    return ob


# ── ゼブラ検査 ──────────────────────────────────────────────
def zebra_setup(scale=7.0):
    sc = bpy.context.scene
    w = sc.world or bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_WORLD':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_WORLD'][0]
    bg = nt.nodes.new('ShaderNodeBackground')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = scale
    wave.inputs['Distortion'].default_value = 0.0
    wave.inputs['Detail'].default_value = 0.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.02, 0.02, 0.02, 1)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Generated'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

    m = bpy.data.materials.get('rs_chrome') or bpy.data.materials.new('rs_chrome')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.02
    return m


def zebra_render(objs, fn, cam_pos=(0.0, -13.0, 2.0), tgt=(0, 0, 0.85),
                 res=(1600, 560)):
    """指定オブジェクトだけを鏡面にしてゼブラ撮影する。"""
    sc = bpy.context.scene
    chrome = zebra_setup()
    cam = bpy.data.objects.get('rs_cam')
    if not cam:
        cam = bpy.data.objects.new('rs_cam', bpy.data.cameras.new('rs_cam'))
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 55
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    # 検査は必ず複製に対して行う。元オブジェクトのマテリアルと位置を
    # 書き換えてしまうと、あとの工程(書き出しなど)を静かに壊す。
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_zb_'):
            bpy.data.objects.remove(o, do_unlink=True)
    xs = np.linspace(-2.6, 2.6, len(objs)) if len(objs) > 1 else [0.0]
    for n, (src, x) in enumerate(zip(objs, xs)):
        o = src.copy()
        o.data = src.data.copy()
        o.name = f'rs_zb_{n}'
        bpy.context.scene.collection.objects.link(o)
        o.hide_render = False
        c = _co(o)
        ctr = (c.min(axis=0) + c.max(axis=0)) / 2
        o.location = (float(x - ctr[0]), float(-ctr[1]), float(-c[:, 2].min()))
        o.data.materials.clear()
        o.data.materials.append(chrome)
    try:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    cam.location = Vector(cam_pos)
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT_DIR, fn)
    bpy.ops.render.render(write_still=True)
    return os.path.join(OUT_DIR, fn + '.png')


# ── 高密度メッシュへの特徴保存デノイズ ──────────────────────────
def _tri_arrays(me):
    """メッシュを numpy 配列(頂点座標・三角形の頂点index)にする。

    四角面が混ざっていても扱えるよう、扇状に三角形へ割ってから返す。
    """
    V = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    tris = []
    for p in me.polygons:
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    return V, np.array(tris, dtype=np.int64)


def _face_adjacency(F):
    """辺を共有する面のペアから、面ごとの隣接面(最大3)を作る。"""
    nf = len(F)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=0)
    e = np.sort(e, axis=1)
    fid = np.tile(np.arange(nf), 3)
    order = np.lexsort((e[:, 1], e[:, 0]))
    e, fid = e[order], fid[order]
    same = (e[1:, 0] == e[:-1, 0]) & (e[1:, 1] == e[:-1, 1])
    a, b = fid[:-1][same], fid[1:][same]
    nbr = np.full((nf, 3), -1, dtype=np.int64)
    cnt = np.zeros(nf, dtype=np.int64)
    for x, y in ((a, b), (b, a)):
        for k in range(3):
            sel = cnt[x] == k
            nbr[x[sel], k] = y[sel]
            cnt[x[sel]] += 1
    return nbr


def mesh_angle_stats(ob, label=""):
    """隣接面の法線角度の分布。面の荒れ具合を数値で見るための指標。

    滑らかな車のボディなら、5mm刻みの隣接面の角度差は1°を大きく下回る。
    Meshyの生出力は中央値4°・p90で25°あり、面がノイズそのものになっている。
    """
    V, F = _tri_arrays(ob.data)
    nbr = _face_adjacency(F)
    p0, p1, p2 = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-14)
    ang = []
    for k in range(3):
        m = nbr[:, k] >= 0
        d = (n[m] * n[nbr[m, k]]).sum(axis=1).clip(-1, 1)
        ang.append(np.degrees(np.arccos(d)))
    ang = np.concatenate(ang)
    st = {p: float(np.percentile(ang, p)) for p in (50, 75, 90, 95, 99)}
    _log(f"{label} 隣接面角度 中央 {st[50]:.2f}° p75 {st[75]:.2f}° "
         f"p90 {st[90]:.2f}° p95 {st[95]:.2f}° p99 {st[99]:.2f}°")
    return st


def _vert_adjacency(V, F):
    """頂点ごとの近傍頂点の和と個数を出すための辺リスト。"""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=0)
    e = np.sort(e, axis=1)
    e = np.unique(e, axis=0)
    return e


def taubin_smooth(ob, iters=12, lam=0.55, mu=-0.58):
    """Taubin平滑化(収縮しないラプラシアン平滑化)。

    λで縮めてμで戻す2段構えなので、普通のラプラシアン平滑化と違って
    体積が痩せない。高周波のうねりだけ落ち、窓の落ち込みやアーチのような
    数cmスケールの造形は残る。
    """
    me = ob.data
    V, F = _tri_arrays(me)
    V0 = V.copy()
    e = _vert_adjacency(V, F)
    nv = len(V)
    deg = np.zeros(nv)
    np.add.at(deg, e[:, 0], 1.0)
    np.add.at(deg, e[:, 1], 1.0)
    deg = np.maximum(deg, 1.0)

    def lap(V):
        acc = np.zeros_like(V)
        np.add.at(acc, e[:, 0], V[e[:, 1]])
        np.add.at(acc, e[:, 1], V[e[:, 0]])
        return acc / deg[:, None] - V

    for _ in range(iters):
        V += lam * lap(V)
        V += mu * lap(V)

    moved = np.linalg.norm(V - V0, axis=1)
    me.vertices.foreach_set("co", V.reshape(-1))
    me.update()
    _log(f"taubin: 動いた量 平均 {moved.mean()*1000:.2f}mm "
         f"p95 {np.percentile(moved,95)*1000:.2f}mm 最大 {moved.max()*1000:.1f}mm")
    return ob


# ── 少数制御点による最小二乗近似(手で作り直すのに近い作り方) ──────────
def _bspline_basis_periodic(n_ctrl, t):
    """周期3次Bスプラインの基底行列。t は 0..n_ctrl の実数(巡回)。"""
    t = np.asarray(t, dtype=np.float64) % n_ctrl
    i0 = np.floor(t).astype(np.int64)
    u = t - i0
    u2, u3 = u * u, u * u * u
    b = np.stack([(1 - 3 * u + 3 * u2 - u3) / 6.0,
                  (4 - 6 * u2 + 3 * u3) / 6.0,
                  (1 + 3 * u + 3 * u2 - 3 * u3) / 6.0,
                  u3 / 6.0], axis=1)
    M = np.zeros((len(t), n_ctrl))
    for k in range(4):
        M[np.arange(len(t)), (i0 - 1 + k) % n_ctrl] += b[:, k]
    return M


def _bspline_basis_open(n_ctrl, t):
    """端を固定した3次Bスプラインの基底行列(端の制御点を3重にする)。"""
    t = np.clip(np.asarray(t, dtype=np.float64), 0, n_ctrl - 1 - 1e-9)
    i0 = np.floor(t).astype(np.int64)
    u = t - i0
    u2, u3 = u * u, u * u * u
    b = np.stack([(1 - 3 * u + 3 * u2 - u3) / 6.0,
                  (4 - 6 * u2 + 3 * u3) / 6.0,
                  (1 + 3 * u + 3 * u2 - 3 * u3) / 6.0,
                  u3 / 6.0], axis=1)
    M = np.zeros((len(t), n_ctrl))
    for k in range(4):
        idx = np.clip(i0 - 1 + k, 0, n_ctrl - 1)
        M[np.arange(len(t)), idx] += b[:, k]
    return M


def sample_sections(shell, ns=200, nr=288, slab=0.030):
    """断面をレイキャストで採る。中心(スパイン)は断面ごとに取り直す。

    車の前後端では断面が細く、固定のスパインを囲まない。そこへ外から
    レイを飛ばすと大半が外れ、欠損を角度方向に補間した結果が暴走して
    ノーズに薄いヒレが生える。断面ごとに、その位置の参照頂点の中央値を
    中心にすれば、常に断面の内側から飛ばせる。
    """
    V = _co(shell)
    lo, hi = V.min(axis=0), V.max(axis=0)
    xs = np.linspace(float(lo[0]) + 0.004, float(hi[0]) - 0.004, ns)
    ang = np.arange(nr) * 2.0 * math.pi / nr
    cen = np.zeros((ns, 2))
    for i, x in enumerate(xs):
        m = np.abs(V[:, 0] - x) < slab
        if m.sum() < 8:
            m = np.abs(V[:, 0] - x) < slab * 4
        cen[i] = (np.median(V[m, 1]), np.median(V[m, 2])) if m.any() else (0.0, 0.5)
    # 中心線は滑らかにしておく(断面ごとの中央値はがたつく)
    cen = _conv_axis(cen[:, None, :], _gauss(2.5), axis=0, wrap=False)[:, 0, :]

    R = 8.0
    r = np.full((ns, nr), np.nan)
    for i, x in enumerate(xs):
        base = Vector((float(x), float(cen[i, 0]), float(cen[i, 1])))
        for j in range(nr):
            d = Vector((0.0, math.cos(ang[j]), math.sin(ang[j])))
            ok, loc, nor, fi = shell.ray_cast(base + d * R, -d, distance=R * 2)
            if ok:
                r[i, j] = (base - loc).length
    miss = int(np.isnan(r).sum())
    idx = np.arange(nr)
    for i in range(ns):
        row = r[i]
        bad = np.isnan(row)
        if bad.all():
            row[:] = 0.05
            continue
        good = ~bad
        ext = np.concatenate([idx[good] - nr, idx[good], idx[good] + nr])
        val = np.concatenate([row[good]] * 3)
        row[bad] = np.interp(idx[bad], ext, val)
    _log(f"sections {ns}x{nr}, ray miss {miss} ({miss/(ns*nr)*100:.2f}%)")
    return xs, cen, r


def fit_control_net(r, xs, cen, n_around, n_along, lam=2e-3):
    """レイキャストの断面データを、少数の制御点へ最小二乗で当てはめる。

    平滑化(ガウシアン)ではなく近似にするのが要点。平滑化は凸な形を平均へ
    引っぱるので曲率が痩せる(=デザインが溶ける)が、少数基底での最小二乗
    近似は痩せない。制御点が粗い時点でノイズは通れなくなる。

    lam は2階差分に対する正則化。制御点の並び自体を滑らかに保つ。
    """
    NSl, NRl = r.shape
    ang = np.arange(NRl) * 2.0 * np.pi / NRl
    # 断面(周方向)を先に当てはめる
    Ba = _bspline_basis_periodic(n_around, np.arange(NRl) * n_around / NRl)
    D = np.zeros((n_around, n_around))
    for i in range(n_around):
        D[i, i] = -2.0
        D[i, (i - 1) % n_around] = 1.0
        D[i, (i + 1) % n_around] = 1.0
    A = Ba.T @ Ba + lam * NRl * (D.T @ D)
    Rc = np.linalg.solve(A, Ba.T @ r.T).T          # (NS, n_around)

    # 長手方向も当てはめる
    Bx = _bspline_basis_open(n_along, np.linspace(0, n_along - 1, NSl))
    D2 = np.zeros((n_along, n_along))
    for i in range(1, n_along - 1):
        D2[i, i] = -2.0
        D2[i, i - 1] = 1.0
        D2[i, i + 1] = 1.0
    A2 = Bx.T @ Bx + lam * NSl * (D2.T @ D2)
    Rn = np.linalg.solve(A2, Bx.T @ Rc)            # (n_along, n_around)
    Xn = np.linalg.solve(A2, Bx.T @ xs[:, None])[:, 0]
    Cn = np.linalg.solve(A2, Bx.T @ np.asarray(cen))   # 中心線も同じ基底で当てはめる

    ang_c = np.arange(n_around) * 2.0 * np.pi / n_around
    P = np.empty((n_along, n_around, 3))
    P[:, :, 0] = Xn[:, None]
    P[:, :, 1] = Cn[:, 0:1] + Rn * np.cos(ang_c)[None, :]
    P[:, :, 2] = Cn[:, 1:2] + Rn * np.sin(ang_c)[None, :]
    return P


def build_cage(P, name, subsurf=2):
    """制御点から四角ケージを作り、Catmull-Clark で細分割する。"""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    ns, nr = P.shape[0], P.shape[1]
    verts = [(float(P[i, j, 0]), float(P[i, j, 1]), float(P[i, j, 2]))
             for i in range(ns) for j in range(nr)]
    faces = [(i * nr + j, i * nr + (j + 1) % nr,
              (i + 1) * nr + (j + 1) % nr, (i + 1) * nr + j)
             for i in range(ns - 1) for j in range(nr)]
    faces.append(tuple(range(nr - 1, -1, -1)))
    faces.append(tuple(range((ns - 1) * nr, ns * nr)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    _select_only([ob])
    if subsurf:
        m = ob.modifiers.new("sub", 'SUBSURF')
        m.levels = subsurf
        m.render_levels = subsurf
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.shade_smooth()
    _log(f"{name}: cage {ns}x{nr} -> {len(ob.data.polygons)} faces")
    return ob


# ── 仕上げ工程 ──────────────────────────────────────────────
WHEEL_R = 0.346          # 参照から測ったタイヤ半径[m]
ARCH_R = 0.404           # ホイールアーチ開口の半径[m](タイヤ+約6cm)
ARCH_BEVEL = 0.010       # アーチ縁の面取り[m]


def cut_wheel_arches(ob, disks, arch_r=ARCH_R, bevel=ARCH_BEVEL):
    """ボディにホイールアーチを切り欠き、縁に面取りを入れる。

    アーチは実車でも折れ(ハードエッジ)なので、ブーリアンで落として細い
    面取りを入れるのが正しい。周囲の面は乱れないことを検証済み。
    """
    # 幅方向は貫通させるので、左右輪は1本の円柱で足りる。
    # 4輪ぶん作ると同じ位置に2本重なり、EXACTブーリアンが破綻する。
    axles = []
    for d in disks:
        for a in axles:
            if abs(a[0] - float(d['c'][0])) < 0.20:
                break
        else:
            axles.append((float(d['c'][0]), float(d['c'][2])))
    cutters = []
    for ax, az in axles:
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=96, radius=arch_r, depth=2.8,
            location=(ax, 0.0, az), rotation=(math.radians(90), 0, 0))
        c = bpy.context.object
        c.name = 'rs_cutter'
        cutters.append(c)
    _log(f"  axles: {[(round(a,3), round(z,3)) for a, z in axles]}")
    _select_only(cutters)
    if len(cutters) > 1:
        bpy.ops.object.join()
    cutter = bpy.context.view_layer.objects.active
    cutter.name = 'rs_cutter'

    _select_only([ob])
    b = ob.modifiers.new("arch", 'BOOLEAN')
    b.object = cutter
    b.operation = 'DIFFERENCE'
    b.solver = 'EXACT'
    bpy.ops.object.modifier_apply(modifier=b.name)
    bv = ob.modifiers.new("archbev", 'BEVEL')
    bv.width = bevel
    bv.segments = 2
    bv.limit_method = 'ANGLE'
    bv.angle_limit = math.radians(30)
    bpy.ops.object.modifier_apply(modifier=bv.name)
    bpy.ops.object.shade_smooth()
    bpy.data.objects.remove(cutter, do_unlink=True)
    _log(f"arches cut (r={arch_r}): {len(ob.data.polygons)} faces")
    return ob


# ── マテリアルの塗り分け ────────────────────────────────────────
TEXTURED_SRC = "Meshy_Blue Hatchback Blueprint_mesh_node"   # UV+テクスチャ付きの方

MATERIALS = [
    ('CarBody',      (0.88, 0.89, 0.90), 0.28, 0.12, 0.55),
    ('CarGlass',     (0.040, 0.045, 0.055), 0.08, 0.30, 0.0),
    ('CarTrim',      (0.050, 0.050, 0.058), 0.55, 0.0, 0.0),
    ('CarTire',      (0.030, 0.030, 0.035), 0.95, 0.0, 0.0),
    ('CarRim',       (0.46, 0.47, 0.49), 0.32, 0.55, 0.0),
    ('CarHeadlight', (0.72, 0.75, 0.80), 0.12, 0.10, 0.35),
    ('CarTaillight', (0.34, 0.028, 0.032), 0.16, 0.05, 0.35),
    ('CarChrome',    (0.78, 0.79, 0.81), 0.22, 0.60, 0.0),
]
(CLASS_BODY, CLASS_GLASS, CLASS_TRIM, CLASS_TIRE,
 CLASS_RIM, CLASS_HEAD, CLASS_TAIL, CLASS_CHROME) = range(8)


def matp(name, color, rough, metal, coat):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    for s, v in (('Coat Weight', coat), ('Coat Roughness', 0.10)):
        if s in b.inputs:
            b.inputs[s].default_value = v
    return m


def make_textured_ref():
    """テクスチャ付きの元モデルを、参照(rs_ref)と同じ位置・寸法で用意する。

    張り直したボディは形しか持っていない。どこが塗装でどこがガラスかは
    テクスチャ付きの方だけが知っているので、最近傍でその情報を借りる。
    """
    name = 'rs_texref'
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    src = bpy.data.objects[TEXTURED_SRC]
    d = src.copy()
    d.data = src.data.copy()
    d.name = name
    bpy.context.scene.collection.objects.link(d)
    d.rotation_mode = 'XYZ'
    d.rotation_euler = (0, 0, 0)
    s = TARGET_LEN / max(src.dimensions)
    d.scale = (s, s, s)
    d.location = (0, 0, 0)
    _select_only([d])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    c = _co(d)
    d.location.z -= float(c[:, 2].min())
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    d.hide_render = True
    ref = bpy.data.objects[REF_NAME]
    cr = _co(ref)
    _log(f"texref bbox {tuple(round(float(v),3) for v in _co(d).min(axis=0))} "
         f"/ ref bbox {tuple(round(float(v),3) for v in cr.min(axis=0))}")
    return d


def classify_from_texture(body, texref):
    """テクスチャ付き参照から、面ごとのマテリアル種別を借りてくる。

    ボディ各面の重心について最近傍の参照面を引き、その位置のUVから
    ベースカラーを読む。塗装だけが青、赤はテール、暗部はガラス/樹脂、
    明部はメッキ/ヘッドライト。
    """
    img = bpy.data.images['base_color']
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)[:, :, :3]

    me = texref.data
    uvl = me.uv_layers[0].data
    loops = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loops)
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    uvl.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    V = _co(texref)

    bvh = BVHTree.FromObject(texref, bpy.context.evaluated_depsgraph_get())
    bm = me.polygons

    ctr = np.empty(len(body.data.polygons) * 3, dtype=np.float64)
    body.data.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)

    cols = np.zeros((len(ctr), 3), dtype=np.float64)
    for i, c in enumerate(ctr):
        loc, nor, fi, dist = bvh.find_nearest(Vector(c.tolist()))
        if loc is None:
            continue
        p = bm[fi]
        ls = p.loop_start
        vs = [loops[ls + k] for k in range(p.loop_total)]
        # 重心座標でUVを補間する(三角形前提。四角なら最初の3頂点で近似)
        a, b, cc = V[vs[0]], V[vs[1]], V[vs[2]]
        n = np.cross(b - a, cc - a)
        area = np.dot(n, n)
        L = np.array(loc)
        if area < 1e-20:
            w = np.array([1.0, 0.0, 0.0])
        else:
            w = np.array([
                np.dot(np.cross(b - L, cc - L), n),
                np.dot(np.cross(cc - L, a - L), n),
                np.dot(np.cross(a - L, b - L), n)]) / area
        t = w[0] * uv[ls] + w[1] * uv[ls + 1] + w[2] * uv[ls + 2]
        x = int(np.clip(t[0] % 1.0 * W, 0, W - 1))
        y = int(np.clip(t[1] % 1.0 * H, 0, H - 1))
        cols[i] = px[y, x]

    lum = cols[:, 0] * 0.2126 + cols[:, 1] * 0.7152 + cols[:, 2] * 0.0722
    sat = cols.max(axis=1) - cols.min(axis=1)
    cls = np.full(len(ctr), CLASS_TRIM, dtype=np.int32)
    cls[(sat > 0.10) & (cols[:, 2] > cols[:, 0])] = CLASS_BODY
    cls[(sat > 0.10) & (cols[:, 0] > cols[:, 2])] = CLASS_TAIL
    achrom = sat <= 0.10
    cls[achrom & (lum >= 0.45)] = CLASS_CHROME
    cls[achrom & (lum < 0.16)] = CLASS_TRIM
    return cls, ctr


def split_glass(body, cls, ctr, min_area=0.05, min_z=0.80):
    """暗部のうち、ベルトラインより上の大きな塊を窓ガラスにする。

    細いモール・グリル・バンパー下部・アーチのクラッディングはトリムのまま。
    """
    me = body.data
    nf = len(me.polygons)
    area = np.empty(nf, dtype=np.float64)
    me.polygons.foreach_get("area", area)

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[] for _ in range(nf)]
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            nbrs[lf[0].index].append(lf[1].index)
            nbrs[lf[1].index].append(lf[0].index)
    bm.free()

    dark = cls == CLASS_TRIM
    seen = np.zeros(nf, dtype=bool)
    n_glass = 0
    for s in range(nf):
        if seen[s] or not dark[s]:
            continue
        stack = [s]
        seen[s] = True
        comp = []
        while stack:
            i = stack.pop()
            comp.append(i)
            for j in nbrs[i]:
                if not seen[j] and dark[j]:
                    seen[j] = True
                    stack.append(j)
        idx = np.array(comp, dtype=np.int64)
        if area[idx].sum() >= min_area and ctr[idx, 2].mean() >= min_z:
            cls[idx] = CLASS_GLASS
            n_glass += len(idx)
    _log(f"glass: {n_glass} faces")
    return cls


def assign_materials(body, cls):
    me = body.data
    me.materials.clear()
    for n, c, r, mt, co in MATERIALS:
        me.materials.append(matp(n, c, r, mt, co))
    me.polygons.foreach_set("material_index", cls.astype(np.int32))
    me.update()
    names = [m[0] for m in MATERIALS]
    cnt = {names[i]: int((cls == i).sum()) for i in range(len(names)) if (cls == i).any()}
    _log(f"materials: {cnt}")
    return body


def inset_glass(body, cls, depth=0.010):
    """ガラス面を内側へ少し落とし込み、窓としての段差を作る。

    ガラスだけに接している頂点を法線方向へ引っ込める。境界の頂点は動かさない
    ので、窓枠のところに段差が立つ。
    """
    me = body.data
    nv = len(me.vertices)
    glass_only = np.ones(nv, dtype=bool)
    touched = np.zeros(nv, dtype=bool)
    for p, c in zip(me.polygons, cls):
        for v in p.vertices:
            touched[v] = True
            if c != CLASS_GLASS:
                glass_only[v] = False
    sel = glass_only & touched
    V = _co(body)
    N = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get("normal", N)
    N = N.reshape(-1, 3)
    V[sel] -= N[sel] * depth
    me.vertices.foreach_set("co", V.reshape(-1))
    me.update()
    _log(f"glass inset: {int(sel.sum())} verts by {depth*1000:.0f}mm")
    return body


def fit_surface_xyz(S, n_around, n_along, lam=8e-4):
    """サンプル点(ns, nr, 3)を、少数の制御点へ最小二乗で当てはめる。

    半径 r(x,θ) を当てはめてから極座標で戻す方式だと、断面ごとに中心を
    動かしたときに復元が破綻する(隣接面角度の中央値が0.80°→2.56°に悪化した)。
    3D座標のまま当てはめれば、そういう座標系の取り方に依存しない。

    平滑化ではなく近似にするのが要点。平滑化は凸な形を平均へ引っぱるので
    曲率が痩せるが、少数基底での最小二乗近似は痩せない。
    """
    ns, nr = S.shape[0], S.shape[1]
    Ba = _bspline_basis_periodic(n_around, np.arange(nr) * n_around / nr)
    D = np.zeros((n_around, n_around))
    for i in range(n_around):
        D[i, i] = -2.0
        D[i, (i - 1) % n_around] = 1.0
        D[i, (i + 1) % n_around] = 1.0
    A = Ba.T @ Ba + lam * nr * (D.T @ D)

    Bx = _bspline_basis_open(n_along, np.linspace(0, n_along - 1, ns))
    D2 = np.zeros((n_along, n_along))
    for i in range(1, n_along - 1):
        D2[i, i] = -2.0
        D2[i, i - 1] = 1.0
        D2[i, i + 1] = 1.0
    A2 = Bx.T @ Bx + lam * ns * (D2.T @ D2)

    P = np.empty((n_along, n_around, 3))
    for c in range(3):
        Rc = np.linalg.solve(A, Ba.T @ S[:, :, c].T).T      # (ns, n_around)
        P[:, :, c] = np.linalg.solve(A2, Bx.T @ Rc)
    return P


def sections_to_xyz(xs, cen, r):
    """レイキャスト結果を3D座標の格子に直す。"""
    ns, nr = r.shape
    ang = np.arange(nr) * 2.0 * math.pi / nr
    S = np.empty((ns, nr, 3))
    S[:, :, 0] = xs[:, None]
    S[:, :, 1] = cen[:, 0:1] + r * np.cos(ang)[None, :]
    S[:, :, 2] = cen[:, 1:2] + r * np.sin(ang)[None, :]
    return S


def build_cage_uv(P, name, subsurf=1, cap_band=0.085, cap_r=0.035):
    """制御点から四角ケージを作り、UVを付けて細分割する。

    本体は格子座標そのままのUV(島が1つ)。前後の端は n-gon のキャップに
    なるが、そこへ格子と同じUVを与えると1本の線に潰れてしまい、
    ベイクしたテクスチャが放射状に伸びる。キャップは扇状に三角形へ割って、
    アトラスの上下に空けた帯へ円板として展開する。
    """
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    ns, nr = P.shape[0], P.shape[1]
    verts = [(float(P[i, j, 0]), float(P[i, j, 1]), float(P[i, j, 2]))
             for i in range(ns) for j in range(nr)]
    v_lo, v_hi = cap_band, 1.0 - cap_band
    faces, uvs = [], []
    for i in range(ns - 1):
        for j in range(nr):
            j2 = (j + 1) % nr
            faces.append((i * nr + j, i * nr + j2, (i + 1) * nr + j2, (i + 1) * nr + j))
            u0, u1 = j / nr, (j + 1) / nr
            v0 = v_lo + (v_hi - v_lo) * i / (ns - 1)
            v1 = v_lo + (v_hi - v_lo) * (i + 1) / (ns - 1)
            uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    # キャップ: 中心頂点を足して扇状に割り、円板としてUVを与える
    for end_i, vc, rev in ((0, cap_band * 0.5, True),
                           (ns - 1, 1.0 - cap_band * 0.5, False)):
        ring = [end_i * nr + j for j in range(nr)]
        cpos = P[end_i].mean(axis=0)
        verts.append((float(cpos[0]), float(cpos[1]), float(cpos[2])))
        ci = len(verts) - 1
        for j in range(nr):
            j2 = (j + 1) % nr
            a, b = (ring[j2], ring[j]) if rev else (ring[j], ring[j2])
            faces.append((ci, a, b))
            ta = 2.0 * math.pi * (j2 if rev else j) / nr
            tb = 2.0 * math.pi * (j if rev else j2) / nr
            uvs.append([(0.5, vc),
                        (0.5 + cap_r * math.cos(ta), vc + cap_r * math.sin(ta)),
                        (0.5 + cap_r * math.cos(tb), vc + cap_r * math.sin(tb))])

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uvl = me.uv_layers.new(name='UVMap')
    for f, quv in zip(me.polygons, uvs):
        for n in range(f.loop_total):
            uvl.data[f.loop_start + n].uv = quv[n]
    me.update()

    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    _select_only([ob])
    if subsurf:
        m = ob.modifiers.new("sub", 'SUBSURF')
        m.levels = subsurf
        m.render_levels = subsurf
        m.uv_smooth = 'PRESERVE_BOUNDARIES'
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.shade_smooth()
    _log(f"{name}: cage {ns}x{nr} -> {len(ob.data.polygons)} faces (UV付き)")
    return ob


def bake_base_color(body, texref, size=1024, name='rs_baked'):
    """テクスチャ付き参照の見た目を、張り直したボディのUVへ焼き付ける。"""
    sc = bpy.context.scene
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True)

    m = bpy.data.materials.get('rs_bake_target')
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new('rs_bake_target')
    m.use_nodes = True
    tn = m.node_tree.nodes.new('ShaderNodeTexImage')
    tn.image = img
    m.node_tree.nodes.active = tn
    body.data.materials.clear()
    body.data.materials.append(m)

    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.cycles.bake_type = 'DIFFUSE'
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True
    sc.render.bake.use_selected_to_active = True
    # 張り直した面は元形状から平均14mm・p95で46mm離れる。レイが届かないと
    # その部分が真っ黒に焼けるので、余裕を大きく取る。
    sc.render.bake.use_cage = False
    sc.render.bake.cage_extrusion = 0.25
    sc.render.bake.max_ray_distance = 0.0   # 0 = 無制限
    sc.render.bake.margin = 16

    bpy.ops.object.select_all(action='DESELECT')
    texref.hide_viewport = False
    texref.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type='DIFFUSE')
    img.pack()
    _log(f"baked {size}x{size} -> {name}")
    return img


def fill_bake_holes(img, iters=24):
    """ベイクで焼けなかった穴(真っ黒/透明)を、周囲の色で埋める。

    レイが届かなかった箇所は黒く残る。そのまま使うとボディに黒い染みが出る。
    """
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(H, W, 4)
    rgb = a[:, :, :3]
    hole = (a[:, :, 3] < 0.5) | (rgb.max(axis=2) < 0.004)
    n0 = int(hole.sum())
    for _ in range(iters):
        if not hole.any():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros((H, W))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1),
                       (1, 1), (1, -1), (-1, 1), (-1, -1)):
            s_rgb = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            s_ok = ~np.roll(np.roll(hole, dy, axis=0), dx, axis=1)
            acc += s_rgb * s_ok[:, :, None]
            cnt += s_ok
        fillable = hole & (cnt > 0)
        rgb[fillable] = (acc[fillable] / cnt[fillable][:, None])
        a[:, :, 3][fillable] = 1.0
        hole = hole & ~fillable
    img.pixels.foreach_set(a.reshape(-1))
    img.pack()
    _log(f"bake holes filled: {n0} -> {int(hole.sum())} texels")
    return img


def despeckle_bake(img, k=2, passes=2):
    """ベイクしたテクスチャにメディアンフィルタをかける。

    張り直した面は元形状から数mmずれるので、黒いトリムのような色境界の
    上でサンプル点が行き来し、ふちが1テクセル単位でギザつく(モデル上では
    毛羽立って見える)。メディアンは平坦部のごま塩だけ消してエッジは残す。
    """
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(H, W, 4)
    rgb = a[:, :, :3]
    n = (2 * k + 1) ** 2
    for _ in range(passes):
        stack = np.empty((n, H, W, 3), dtype=np.float32)
        t = 0
        for dy in range(-k, k + 1):
            for dx in range(-k, k + 1):
                stack[t] = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
                t += 1
        rgb = np.median(stack, axis=0)
    a[:, :, :3] = rgb
    img.pixels.foreach_set(a.reshape(-1))
    img.pack()
    _log(f"despeckle: median {2*k+1}x{2*k+1} x{passes}")
    return img


def _bake_labels(rgb, sat_th=0.10):
    """テクセルを 塗装/赤灯/暗部/明部/中間 に分ける。"""
    lum = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    sat = rgb.max(axis=-1) - rgb.min(axis=-1)
    lab = np.full(rgb.shape[:2], 4, dtype=np.int8)      # 4: 中間
    lab[(sat <= sat_th) & (lum >= 0.45)] = 3            # 3: 明部(メッキ/灯火)
    lab[(sat <= sat_th) & (lum < 0.16)] = 2             # 2: 暗部(黒トリム/窓)
    lab[(sat > sat_th) & (rgb[..., 0] > rgb[..., 2])] = 1   # 1: 赤(テール)
    lab[(sat > sat_th) & (rgb[..., 2] > rgb[..., 0])] = 0   # 0: 塗装
    return lab


def clean_bake_regions(img, k=3, label_passes=2, color_passes=2,
                       flat_dark=(0.045, 0.045, 0.052)):
    """領域の境界をくっきりさせる。

    黒いトリムや灯火のふちが1テクセル単位でギザつくと、モデル上では
    毛羽立って見える。まずラベル(塗装/黒/赤/明部)をメディアンで整えて
    境界を滑らかにし、色は「同じラベルの近傍だけ」で平均する。
    こうすると境界は鋭いまま、領域の内側だけがきれいになる。
    """
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(H, W, 4)
    rgb = a[:, :, :3].astype(np.float32)
    lab = _bake_labels(rgb)

    offs = [(dy, dx) for dy in range(-k, k + 1) for dx in range(-k, k + 1)]
    for _ in range(label_passes):
        stack = np.stack([np.roll(np.roll(lab, dy, 0), dx, 1) for dy, dx in offs])
        # 最頻値(ラベルは5種類なので数え上げでよい)
        counts = np.stack([(stack == v).sum(axis=0) for v in range(5)])
        lab = counts.argmax(axis=0).astype(np.int8)

    for _ in range(color_passes):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(rgb.shape[:2], dtype=np.float32)
        for dy, dx in offs:
            same = (np.roll(np.roll(lab, dy, 0), dx, 1) == lab)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * same[:, :, None]
            cnt += same
        rgb = acc / np.maximum(cnt, 1.0)[:, :, None]

    # 黒トリム(ロッカー・アーチのクラッディング・窓枠)は実車ではほぼ均一な
    # つや消し黒。元テクスチャは階調を持っていてふちが甘くなるので、平坦に
    # 置き換えてエッジを立てる。灯火とメッキは内部の造形を残したいので触らない。
    if flat_dark is not None:
        rgb[lab == 2] = np.array(flat_dark, dtype=np.float32)

    a[:, :, :3] = rgb
    img.pixels.foreach_set(a.reshape(-1))
    img.pack()
    _log(f"clean regions: label median {2*k+1}^2 x{label_passes}, "
         f"同ラベル平均 x{color_passes}")
    return img


def setup_materials_from_bake(body, baked, sat_th=0.10, dilate=1):
    """ベイクしたテクスチャから CarBody / CarDetail の2マテリアルを作る。

    car_meshy_reduce.py と同じ方式。塗装部分を白へ置換したテクスチャを
    両方のマテリアルで共有し、アプリ側は CarBody の色だけ差し替える。
    見た目の境界はテクスチャ(ピクセル単位)が持つので、ポリゴンの割り当てが
    多少ずれてもふちがギザつかない。
    """
    W, H = baked.size
    px = np.empty(W * H * 4, dtype=np.float32)
    baked.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    sat = rgb.max(axis=1) - rgb.min(axis=1)
    paint = (sat > sat_th) & (rgb[:, 2] > rgb[:, 0])
    rgb[paint] = 1.0
    neutral = bpy.data.images.get('rs_baked_neutral')
    if neutral:
        bpy.data.images.remove(neutral)
    neutral = bpy.data.images.new('rs_baked_neutral', W, H, alpha=True)
    neutral.colorspace_settings.name = baked.colorspace_settings.name
    neutral.pixels.foreach_set(px.reshape(-1))
    neutral.pack()
    _log(f"neutralized {int(paint.sum())}/{len(paint)} texels")

    def mk(name, coat):
        m = bpy.data.materials.get(name)
        if m:
            bpy.data.materials.remove(m)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = neutral
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.30
        b.inputs['Metallic'].default_value = 0.12
        for s, v in (('Coat Weight', coat), ('Coat Roughness', 0.10)):
            if s in b.inputs:
                b.inputs[s].default_value = v
        return m

    # 2つのマテリアルは「色変更が効くか」だけが違う。光沢まで変えると、
    # 境界で面ごとに艶が交互になり、アーチやロッカーのふちが毛羽立って見える。
    me = body.data
    me.materials.clear()
    me.materials.append(mk('CarBody', 0.45))
    me.materials.append(mk('CarDetail', 0.45))

    # 面ごとに塗装かどうかを判定(UV重心のベイク色で)
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    nf = len(me.polygons)
    ls = np.empty(nf, dtype=np.int32)
    lt = np.empty(nf, dtype=np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    maxt = int(lt.max())
    ctr = sum(uv[ls + np.minimum(k, lt - 1)] for k in range(maxt)) / maxt
    src = np.empty(W * H * 4, dtype=np.float32)
    baked.pixels.foreach_get(src)
    src = src.reshape(H, W, 4)[:, :, :3]
    xs = np.clip((ctr[:, 0] % 1.0 * W).astype(np.int32), 0, W - 1)
    ys = np.clip((ctr[:, 1] % 1.0 * H).astype(np.int32), 0, H - 1)
    c = src[ys, xs]
    s = c.max(axis=1) - c.min(axis=1)
    flags = (s > sat_th) & (c[:, 2] > c[:, 0])

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[] for _ in range(nf)]
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            nbrs[lf[0].index].append(lf[1].index)
            nbrs[lf[1].index].append(lf[0].index)
    bm.free()
    for _ in range(dilate):
        nxt = flags.copy()
        for i, nb in enumerate(nbrs):
            if not flags[i] and any(flags[j] for j in nb):
                nxt[i] = True
        flags = nxt

    me.polygons.foreach_set("material_index", np.where(flags, 0, 1).astype(np.int32))
    me.update()
    _log(f"CarBody {int(flags.sum())} / CarDetail {int((~flags).sum())} faces")
    return body


# ── ホイール ────────────────────────────────────────────────
def _revolve(profile, segs, name, axis_y=True):
    """(r, y) の断面をY軸まわりに回転させて四角メッシュを作る。"""
    n = len(profile)
    verts, faces = [], []
    for s in range(segs):
        a = 2.0 * math.pi * s / segs
        ca, sa = math.cos(a), math.sin(a)
        for (r, y) in profile:
            verts.append((r * ca, y, r * sa))
    for s in range(segs):
        s2 = (s + 1) % segs
        for k in range(n - 1):
            faces.append((s * n + k, s2 * n + k, s2 * n + k + 1, s * n + k + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _spoke_face(name, n_spokes, r_hub, r_in, r_out, y_face, dish,
                w_in, w_out, segs_hub=32):
    """スポーク面を直接メッシュとして組む。

    ブーリアンで穴を開けるとリムごと消える事故が起きるので、最初から
    「ハブ + スポーク + 外周リング」だけを張って、間は面を作らない。
    """
    verts, faces = [], []

    def yz(r):
        return y_face - dish * (r / max(r_out, 1e-6)) ** 2

    # ハブ(中心の円盤)
    c0 = len(verts)
    verts.append((0.0, y_face, 0.0))
    for k in range(segs_hub):
        a = 2.0 * math.pi * k / segs_hub
        verts.append((r_hub * math.cos(a), yz(r_hub), r_hub * math.sin(a)))
    for k in range(segs_hub):
        faces.append((c0, c0 + 1 + k, c0 + 1 + (k + 1) % segs_hub))

    # 外周リング
    ring_a = len(verts)
    for k in range(segs_hub):
        a = 2.0 * math.pi * k / segs_hub
        verts.append((r_out * math.cos(a), yz(r_out), r_out * math.sin(a)))
    ring_b = len(verts)
    for k in range(segs_hub):
        a = 2.0 * math.pi * k / segs_hub
        verts.append(((r_out + 0.016) * math.cos(a), yz(r_out) - 0.004,
                      (r_out + 0.016) * math.sin(a)))
    for k in range(segs_hub):
        k2 = (k + 1) % segs_hub
        faces.append((ring_a + k, ring_b + k, ring_b + k2, ring_a + k2))

    # スポーク(内側の弧 → 外側の弧)
    steps = 4
    for si in range(n_spokes):
        a0 = 2.0 * math.pi * si / n_spokes
        base = len(verts)
        for t in range(steps + 1):
            u = t / steps
            r = r_hub + (r_out - r_hub) * u
            hwid = (w_in + (w_out - w_in) * u) * math.pi / n_spokes
            for sgn in (-1, 1):
                a = a0 + sgn * hwid
                verts.append((r * math.cos(a), yz(r), r * math.sin(a)))
        for t in range(steps):
            i0 = base + t * 2
            faces.append((i0, i0 + 1, i0 + 3, i0 + 2))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    _select_only([ob])
    sol = ob.modifiers.new("sol", 'SOLIDIFY')
    sol.thickness = 0.016
    sol.offset = -1.0
    bpy.ops.object.modifier_apply(modifier=sol.name)
    bv = ob.modifiers.new("bev", 'BEVEL')
    bv.width = 0.0035
    bv.segments = 2
    bv.limit_method = 'ANGLE'
    bv.angle_limit = math.radians(35)
    bpy.ops.object.modifier_apply(modifier=bv.name)
    bpy.ops.object.shade_smooth()
    return ob


def build_wheel(name, r_out=0.346, r_rim=0.248, width=0.205, segs=32,
                n_spokes=10):
    """タイヤ + リム(バレル + スポーク面)を組む。

    参照三面図に合わせて10本スポークのアルミホイールにする。
    断面回転で作るので面はなめらか。スポークは面を張らない隙間として作る。
    """
    hw = width / 2.0
    fil = 0.030
    prof = [
        (r_rim, -hw + 0.010),
        (r_rim + 0.020, -hw),
        (r_out - fil, -hw),
        (r_out - fil * 0.25, -hw + fil * 0.45),
        (r_out, -hw + fil),
        (r_out, hw - fil),
        (r_out - fil * 0.25, hw - fil * 0.45),
        (r_out - fil, hw),
        (r_rim + 0.020, hw),
        (r_rim, hw - 0.010),
    ]
    tyre = _revolve(prof, segs, name + "_tyre")
    _select_only([tyre])
    bpy.ops.object.shade_smooth()

    # リムのバレル(タイヤの内側で見える筒)
    bprof = [
        (r_rim, hw - 0.012),
        (r_rim - 0.010, hw - 0.030),
        (r_rim - 0.014, 0.0),
        (r_rim - 0.010, -hw + 0.030),
        (r_rim, -hw + 0.012),
    ]
    barrel = _revolve(bprof, segs, name + "_barrel")
    _select_only([barrel])
    bpy.ops.object.shade_smooth()

    face = _spoke_face(name + "_face", n_spokes,
                       r_hub=0.036, r_in=0.050, r_out=r_rim - 0.014,
                       y_face=hw - 0.022, dish=0.026,
                       w_in=0.44, w_out=0.30)

    _select_only([barrel, face])
    bpy.ops.object.join()
    rim = bpy.context.view_layer.objects.active
    rim.name = name + "_rim"

    for ob_, name_, col_, rgh_, met_ in (
            (tyre, 'CarTire', (0.030, 0.030, 0.035), 0.95, 0.0),
            (rim, 'CarRim', (0.52, 0.53, 0.55), 0.28, 0.60)):
        ob_.data.materials.clear()
        ob_.data.polygons.foreach_set(
            "material_index", np.zeros(len(ob_.data.polygons), dtype=np.int32))
        ob_.data.materials.append(matp(name_, col_, rgh_, met_, 0.0))
        ob_.data.update()

    _select_only([tyre, rim])
    bpy.ops.object.join()
    w = bpy.context.view_layer.objects.active
    w.name = name
    _log(f"{name}: {len(w.data.polygons)} faces ({n_spokes}本スポーク)")
    return w


def place_wheels(disks, r_out=0.346):
    """4輪ぶん配置する。"""
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_w_'):
            bpy.data.objects.remove(o, do_unlink=True)
    base = build_wheel('rs_w_base', r_out=r_out)
    out = []
    for i, d in enumerate(disks):
        w = base.copy()
        w.data = base.data.copy()
        w.name = f'rs_w_{i}'
        bpy.context.scene.collection.objects.link(w)
        w.location = (float(d['c'][0]), float(d['c'][1]), float(d['c'][2]))
        if d['c'][1] < 0:
            w.scale = (1, -1, 1)   # 左右で向きを揃える
        out.append(w)
    bpy.data.objects.remove(base, do_unlink=True)
    return out


def export_glb(out_path, body_name='rs_car_body', wheel_prefix='rs_w_',
               target_tris=None):
    """ボディとホイールを結合し、既存 car_sedan.glb と同じ向き・実寸で書き出す。

    向き: glTF の -Z が車の前、+X が右、長手方向は Z。
    元データは前が Blender -X なので、Z軸まわり -90度で前を +Y へ向ける
    (glTF書き出しは (x,y,z)_blender -> (x,z,-y)_gltf)。
    """
    # 作業用オブジェクトは残す。結合は複製に対して行う。
    # 前回の書き出しで作った car_hb が残っていると、それがアクティブのまま
    # 隠れていて join が失敗する。毎回消してから作る。
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_out') or o.name.startswith('car_hb'):
            bpy.data.objects.remove(o, do_unlink=True)
    srcs = [bpy.data.objects[body_name]] + \
           [o for o in bpy.data.objects if o.name.startswith(wheel_prefix)] + \
           [o for o in bpy.data.objects if o.name.startswith('rs_p_')]
    copies = []
    for i, s in enumerate(srcs):
        d = s.copy()
        d.data = s.data.copy()
        d.name = f'rs_out{i}'
        bpy.context.scene.collection.objects.link(d)
        # 複製は非表示状態を引き継ぐことがある。隠れていると join が対象外にする。
        d.hide_viewport = False
        d.hide_render = False
        d.hide_set(False)
        copies.append(d)
    target_name = copies[0].name
    _select_only(copies)
    bpy.ops.object.join()
    # アクティブオブジェクトに頼らない。直前に消したオブジェクトの影響で
    # active が None になることがある。
    ob = bpy.data.objects.get(target_name) or bpy.context.view_layer.objects.active
    assert ob is not None, "join failed: no target object"
    ob.name = 'car_hb'
    ob.data.name = 'car_hb'

    ob.rotation_mode = 'XYZ'
    ob.rotation_euler = (0.0, 0.0, -math.pi / 2)
    _select_only([ob])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    c = _co(ob)
    ctr = (c.min(axis=0) + c.max(axis=0)) / 2
    ob.location = (float(-ctr[0]), float(-ctr[1]), float(-c[:, 2].min()))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    # ブーリアンの跡で空のマテリアルスロットが残ることがある
    _select_only([ob])
    bpy.ops.object.material_slot_remove_unused()

    # ※ 最後に間引くのは駄目。四角の規則格子を三角形に崩すと隣接面角度が
    #   1.74°→5.78°に悪化した。軽くしたいときは制御点(fit_surface_xyz の
    #   n_around / n_along)を減らすこと。
    if target_tris:
        tri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tri > target_tris:
            d = ob.modifiers.new("dec", 'DECIMATE')
            d.decimate_type = 'COLLAPSE'
            d.ratio = target_tris / tri
            d.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=d.name)
            _log(f"decimate: {tri} -> "
                 f"{sum(len(p.vertices)-2 for p in ob.data.polygons)} tri")

    c = _co(ob)
    size = c.max(axis=0) - c.min(axis=0)
    assert size[1] > size[0], f"long axis must be Blender +Y, got {size}"
    mats = [m.name for m in ob.data.materials if m]
    _log(f"export: {len(ob.data.polygons)} faces, size "
         f"{tuple(round(float(v),3) for v in size)}, mats {mats}")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
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
    _log(f"exported {out_path} {os.path.getsize(out_path)} bytes")
    return ob


# ── 三面図レンダー(参照との突き合わせ用) ─────────────────────────
def ortho_views(objs, fn, res=(1800, 620), pad=1.06, bg=(0.97, 0.97, 0.97)):
    """前・横・後を正射投影で1枚に並べて撮る。参照三面図と直接比較するため。"""
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_ov'):
            bpy.data.objects.remove(o, do_unlink=True)
    cam = bpy.data.objects.get('rs_ocam')
    if not cam:
        cam = bpy.data.objects.new('rs_ocam', bpy.data.cameras.new('rs_ocam'))
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    sc.camera = cam

    allco = np.concatenate([_co(o) + np.array(o.location) for o in objs], axis=0)
    lo, hi = allco.min(axis=0), allco.max(axis=0)
    ctr = (lo + hi) / 2.0
    size = hi - lo

    w = bpy.context.scene.world
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_WORLD':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_WORLD'][0]
    b = nt.nodes.new('ShaderNodeBackground')
    b.inputs[0].default_value = (*bg, 1.0)
    b.inputs[1].default_value = 1.0
    nt.links.new(b.outputs['Background'], out.inputs['Surface'])

    sun = bpy.data.objects.get('rs_osun')
    if not sun:
        sl = bpy.data.lights.new('rs_osun', 'SUN')
        sl.energy = 2.2
        sun = bpy.data.objects.new('rs_osun', sl)
        sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))

    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    for o in objs:
        o.hide_render = False

    # 作業シーンでは車の長手方向がX、前が -X。
    views = [
        ('front', (ctr[0] - 14.0, ctr[1], ctr[2]), max(size[1], size[2]), 'FRONT'),
        ('side',  (ctr[0], ctr[1] - 14.0, ctr[2]), max(size[0], size[2]), 'SIDE'),
        ('rear',  (ctr[0] + 14.0, ctr[1], ctr[2]), max(size[1], size[2]), 'REAR'),
    ]
    outs = []
    for key, pos, span, _ in views:
        cam.location = Vector(pos)
        cam.rotation_euler = (Vector(tuple(ctr)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.ortho_scale = float(span * pad)
        aspect = 1.0 if key != 'side' else 2.6
        sc.render.resolution_x = int(res[1] * aspect)
        sc.render.resolution_y = res[1]
        sc.render.filepath = os.path.join(OUT_DIR, f"{fn}_{key}")
        bpy.ops.render.render(write_still=True)
        outs.append(os.path.join(OUT_DIR, f"{fn}_{key}.png"))
    _log("ortho views: " + ", ".join(os.path.basename(o) for o in outs))
    return outs


# ── テクスチャの領域を幾何パーツへ起こす ──────────────────────────
def face_labels_from_bake(body, img, sat_th=0.10):
    """ボディの各面が、ベイクしたテクスチャ上でどの領域かを返す。

    0:塗装 1:赤(灯火) 2:暗部(黒トリム/窓) 3:明部(メッキ/灯火) 4:中間
    """
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)[:, :, :3]
    me = body.data
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    nf = len(me.polygons)
    ls = np.empty(nf, dtype=np.int32)
    lt = np.empty(nf, dtype=np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    maxt = int(lt.max())
    ctr = sum(uv[ls + np.minimum(k, lt - 1)] for k in range(maxt)) / maxt
    xs = np.clip((ctr[:, 0] % 1.0 * W).astype(np.int32), 0, W - 1)
    ys = np.clip((ctr[:, 1] % 1.0 * H).astype(np.int32), 0, H - 1)
    return _bake_labels(px[ys, xs][:, None, :], sat_th)[:, 0]


def smooth_face_mask(body, mask, passes=4):
    """面マスクを近傍の多数決でならす。ギザギザのままだと抽出したパーツが
    スパイクだらけになる。"""
    me = body.data
    nf = len(me.polygons)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[] for _ in range(nf)]
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            nbrs[lf[0].index].append(lf[1].index)
            nbrs[lf[1].index].append(lf[0].index)
    bm.free()
    m = mask.copy()
    for _ in range(passes):
        nxt = m.copy()
        for i, nb in enumerate(nbrs):
            if not nb:
                continue
            on = sum(1 for j in nb if m[j])
            if on > len(nb) / 2:
                nxt[i] = True
            elif on < len(nb) / 2:
                nxt[i] = False
        m = nxt
    return m


def extract_part(body, mask, name, offset, mat, thickness=0.004):
    """条件に合う面を複製し、外側へ持ち上げて独立パーツにする。

    黒いクラッディングや灯火は、実車では別部品として面から数mm出ている。
    テクスチャで色を塗るだけだとふちが甘く、平面にしか見えない。
    面を複製してオフセットすれば、シルエットに段差が出て部品として読める。
    """
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    if not mask.any():
        return None
    src = body.data
    bm = bmesh.new()
    bm.from_mesh(src)
    bm.faces.ensure_lookup_table()
    keep = [f for f in bm.faces if mask[f.index]]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not mask[f.index]], context='FACES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if len(me.polygons) == 0:
        bpy.data.meshes.remove(me)
        return None
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    _select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')

    # 境界の頂点はオフセットを0にして、内側へ向かって立ち上げる。
    # 一律に持ち上げると、ふちが元の面から剥がれてスパイクになる。
    bm2 = bmesh.new()
    bm2.from_mesh(me)
    bm2.verts.ensure_lookup_table()
    nv = len(bm2.verts)
    dist = np.full(nv, 10 ** 6, dtype=np.int32)
    frontier = [v.index for v in bm2.verts
                if any(e.is_boundary for e in v.link_edges)]
    for i in frontier:
        dist[i] = 0
    adj = [[e.other_vert(v).index for e in v.link_edges] for v in bm2.verts]
    bm2.free()
    d = 0
    while frontier and d < 6:
        nxt = []
        for i in frontier:
            for j in adj[i]:
                if dist[j] > d + 1:
                    dist[j] = d + 1
                    nxt.append(j)
        frontier = nxt
        d += 1
    scale = np.clip(dist / 2.0, 0.0, 1.0)

    V = _co(ob)
    N = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("normal", N)
    N = N.reshape(-1, 3)
    V += N * (offset * scale[:, None])
    me.vertices.foreach_set("co", V.reshape(-1))
    me.update()

    sol = ob.modifiers.new("sol", 'SOLIDIFY')
    sol.thickness = thickness
    sol.offset = -1.0
    bpy.ops.object.modifier_apply(modifier=sol.name)
    bpy.ops.object.shade_smooth()
    ob.data.materials.clear()
    ob.data.polygons.foreach_set(
        "material_index", np.zeros(len(ob.data.polygons), dtype=np.int32))
    ob.data.materials.append(mat)
    ob.data.update()
    _log(f"{name}: {len(ob.data.polygons)} faces (offset {offset*1000:.0f}mm)")
    return ob


def build_detail_parts(body, img, z_clad=0.60):
    """黒クラッディング(ロッカー/アーチ)を別パーツとして起こす。"""
    lab = face_labels_from_bake(body, img)
    me = body.data
    nf = len(me.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)

    parts = []
    clad = smooth_face_mask(
        body, (lab == 2) & (ctr[:, 2] < z_clad)
        & (ctr[:, 0] > -1.55) & (ctr[:, 0] < 1.68), passes=6)
    parts.append(extract_part(
        body, clad, 'rs_p_clad', 0.007,
        matp('CarTrim', (0.048, 0.048, 0.055), 0.62, 0.0, 0.0), 0.006))

    # ライト類は build_lamp_parts() のブーリアン切り込みに一本化した。
    # ここで重ねて作ると、明るいレンズが上に乗って造形が見えなくなる。

    return [p for p in parts if p]


def _white_uv(img, sat_th=0.10):
    """テクスチャ上で「塗装(白に置換済み)」の内側にあるUVを1点返す。

    追加パーツ(ドアハンドル等)にこのUVを与えると、CarBody マテリアルの
    テクスチャを踏んでも白になり、アプリのボディ色変更がそのまま効く。
    """
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(H, W, 4)[:, :, :3]
    white = (a.min(axis=2) > 0.92)
    # 境界から遠い点を選ぶ(縁を踏むと色が混ざる)
    best, bx, by = -1, 0, 0
    step = max(1, W // 128)
    for y in range(step, H - step, step):
        for x in range(step, W - step, step):
            if not white[y, x]:
                continue
            r = 1
            while r < 40 and white[max(y - r, 0):y + r + 1, max(x - r, 0):x + r + 1].all():
                r += 1
            if r > best:
                best, bx, by = r, x, y
    _log(f"white UV: ({bx/W:.3f}, {by/H:.3f}) 余白 {best}px")
    return (bx / W, by / H)


def add_door_handles(body, img, xs=(-0.36, 0.50), z=0.98,
                     length=0.125, height=0.030, out=0.022):
    """ドアハンドルを実測位置に足す。

    参照三面図にはあるが、Meshyの形状には彫り込みしか無く、張り直しで
    消えている。ボディ表面へレイを飛ばして位置と法線を取り、そこへ
    角の丸い箱を置く。UVは塗装部分の白い場所に固定するので、
    アプリのボディ色変更がハンドルにも効く。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_p_handle'):
            bpy.data.objects.remove(o, do_unlink=True)
    u, v = _white_uv(img)
    made = []
    for xi, x in enumerate(xs):
        for side in (-1, 1):
            org = Vector((float(x), side * 3.0, float(z)))
            ok, loc, nor, fi = body.ray_cast(org, Vector((0, -side, 0)), distance=6.0)
            if not ok:
                _log(f"  handle miss at x={x} side={side}")
                continue
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            c = bpy.context.object
            c.name = f'rs_p_handle{xi}{"L" if side < 0 else "R"}'
            c.scale = (length, out, height)
            c.location = loc + Vector(nor) * (out * 0.35)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            bv = c.modifiers.new("b", 'BEVEL')
            bv.width = 0.010
            bv.segments = 3
            bpy.ops.object.modifier_apply(modifier=bv.name)
            bpy.ops.object.shade_smooth()
            me = c.data
            uvl = me.uv_layers.new(name='UVMap')
            for lp in uvl.data:
                lp.uv = (u, v)
            me.materials.clear()
            me.materials.append(bpy.data.materials['CarBody'])
            made.append(c)
    _log(f"door handles: {len(made)}")
    return made


def _label_uv(img, label, sat_th=0.10):
    """指定ラベルの内側にあるUVを1点返す(凹み側面など、UVを持たない面用)。"""
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(H, W, 4)[:, :, :3]
    lab = _bake_labels(a, sat_th)
    ok = lab == label
    best, bx, by = -1, W // 2, H // 2
    step = max(1, W // 128)
    for y in range(step, H - step, step):
        for x in range(step, W - step, step):
            if not ok[y, x]:
                continue
            r = 1
            while r < 30 and ok[max(y - r, 0):y + r + 1, max(x - r, 0):x + r + 1].all():
                r += 1
            if r > best:
                best, bx, by = r, x, y
    return (bx / W, by / H)


def recess_regions(body, groups, wall_uv):
    """複数の領域をまとめて凹ませ、側壁を作る。

    ライトやグリルは実車では奥まっている。テクスチャで黒く塗るだけだと
    平面にしか見えないので段差を作る。inset_region は側壁まで張るので
    ふちが甘くならない。
    ※ 1つ凹ませるたびに面が増えてインデックスがずれるので、必ず1回の
      bmeshセッションで全部処理すること(面参照はセッション中は生きている)。
    """
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    done = []
    for mask, depth in groups:
        bm.faces.ensure_lookup_table()   # 凹ませるたびに面が増えるので毎回張り直す
        sel = [bm.faces[i] for i in np.nonzero(mask)[0] if i < len(bm.faces)]
        sel = [f for f in sel if f.is_valid]
        if not sel:
            done.append(0)
            continue
        res = bmesh.ops.inset_region(bm, faces=sel, thickness=0.0,
                                     depth=-abs(depth), use_even_offset=True,
                                     use_boundary=True)
        if uvl is not None:
            for f in res.get('faces', []):
                for l in f.loops:
                    l[uvl].uv = wall_uv
        done.append(len(sel))
    bm.to_mesh(me)
    bm.free()
    me.update()
    return done


def lamp_outlines(body, img):
    """ヘッドライト・テールランプ・グリルを、凹み + レンズとして造形する。

    参照三面図では、これらは面から奥まった別部品として明確に立体になって
    いる。ベイクしたテクスチャの領域を手掛かりに位置を取り、
      1. レンズになる面を先に複製しておく
      2. ボディ側をその形に凹ませる(側壁ができる)
      3. レンズを元の高さに戻して置く
    という順で組む。
    """
    lab = face_labels_from_bake(body, img)
    me = body.data
    nf = len(me.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)

    # 位置はテクスチャから借り、形はパラメトリックな輪郭で描き直す。
    # 参照三面図の「細く鋭いシグネチャ」「明確な開口」は、マスクを
    # ならしたり凸包を取ったりでは出せなかった。
    # ヘッドライトは明部ラベルだけだと下部のメッキを拾ってしまう。
    # 位置(前端・ベルトライン下・左右)で切り出してから形をあてはめる。
    head_raw = smooth_face_mask(
        body, (ctr[:, 0] < -1.42) & (ctr[:, 2] > 0.70) & (ctr[:, 2] < 0.98)
        & (np.abs(ctr[:, 1]) > 0.25) & (np.abs(ctr[:, 1]) < 0.94)
        & (lab != 0), passes=2)
    outs_head = parametric_outlines(body, head_raw, 'lens', scale=(1.06, 0.60))
    outs_tail = rear_lamp_outlines(body)
    outs_grille, outs_intake = front_bumper_outlines(body)

    # 形が決まったらいったん返す。この後でベイクを整えてから切る。
    # (テールまわりの赤いにじみを消すには、外形を拾ったあとで
    #  塗り潰す必要がある)
    return {'head': outs_head, 'tail': outs_tail,
            'grille': outs_grille, 'intake': outs_intake}


def cut_lamp_openings(body, outs):
    """lamp_outlines が返した外形で、実際に開口を切ってレンズを置く。"""
    outs_head, outs_tail = outs['head'], outs['tail']
    outs_grille, outs_intake = outs['grille'], outs['intake']
    made = []
    # ヘッドライトのレンズは実車では暗いガラス。明るい灰色にすると
    # ボディに溶けて造形が見えなくなる。
    made += cut_openings(body, outs_head, 0.016,
                         matp('CarHeadlight', (0.085, 0.095, 0.115), 0.05, 0.20, 0.85),
                         'rs_p_head', front=True)
    made += build_surface_lens(body, outs_tail, 'rs_p_tail',
                               matp('CarTaillight', (0.34, 0.022, 0.026),
                                    0.09, 0.05, 0.75), front=False)
    # matp は同名マテリアルを作り直す。グリルとインテークで2度呼ぶと、
    # 先に割り当てたスロットが空になって白く出るので、1度だけ作って使い回す。
    m_grille = matp('CarGrille', (0.034, 0.034, 0.040), 0.55, 0.0, 0.0)
    made += cut_openings(body, outs_grille, 0.026, m_grille,
                         'rs_p_grille', front=True, align=True)
    # コーナーインテークは面が回り込むので、角柱では切り口が裂ける。
    # テールと同じく、面に沿って張った暗い板にする。
    made += build_surface_lens(body, outs_intake, 'rs_p_intake', m_grille,
                               front=True, lift=0.002, thickness=0.016,
                               align=True)
    return made


def _unused_recess_specs(body, lab, ctr, dark_uv):
    """面選択で凹ませる旧方式。輪郭が階段状になるため使っていない。"""
    specs = []
    return []


def _convex_hull_2d(pts):
    """Andrewのmonotone chain。scipy無しで凸包を出す。"""
    p = pts[np.lexsort((pts[:, 1], pts[:, 0]))]
    def half(ps):
        out = []
        for q in ps:
            while len(out) >= 2:
                a, b = out[-2], out[-1]
                if (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) <= 0:
                    out.pop()
                else:
                    break
            out.append(q)
        return out
    lower = half(p)
    upper = half(p[::-1])
    return np.array(lower[:-1] + upper[:-1])


def _inside_hull(hull, pts, pad=0.0):
    """凸包の内側(padぶん外へ広げる)にあるか。"""
    c = hull.mean(axis=0)
    ok = np.ones(len(pts), dtype=bool)
    n = len(hull)
    for i in range(n):
        a, b = hull[i], hull[(i + 1) % n]
        e = b - a
        nor = np.array([-e[1], e[0]])
        L = np.linalg.norm(nor)
        if L < 1e-12:
            continue
        nor = nor / L
        if np.dot(nor, c - a) < 0:
            nor = -nor
        ok &= ((pts - a) @ nor) >= -pad
    return ok


def convexify_mask(body, mask, plane=(1, 2), pad=0.004, min_faces=8):
    """マスクの連結成分ごとに、投影面での凸包へ置き換えて輪郭を整える。

    テクスチャから起こしたマスクは輪郭がギザつく。ライトやグリルは実車では
    輪郭がなめらかな部品なので、凸包で取り直すと一気に部品らしくなる。
    """
    me = body.data
    nf = len(me.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[] for _ in range(nf)]
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            nbrs[lf[0].index].append(lf[1].index)
            nbrs[lf[1].index].append(lf[0].index)
    bm.free()

    out = np.zeros(nf, dtype=bool)
    seen = np.zeros(nf, dtype=bool)
    lo, hi = ctr[mask][:, 0].min() - 0.05, ctr[mask][:, 0].max() + 0.05
    n_comp = 0
    for s in range(nf):
        if seen[s] or not mask[s]:
            continue
        stack, comp = [s], []
        seen[s] = True
        while stack:
            i = stack.pop()
            comp.append(i)
            for j in nbrs[i]:
                if not seen[j] and mask[j]:
                    seen[j] = True
                    stack.append(j)
        if len(comp) < min_faces:
            continue
        idx = np.array(comp, dtype=np.int64)
        p2 = ctr[idx][:, plane]
        hull = _convex_hull_2d(p2)
        if len(hull) < 3:
            out[idx] = True
            continue
        cand = (ctr[:, 0] > lo) & (ctr[:, 0] < hi)
        inside = np.zeros(nf, dtype=bool)
        inside[cand] = _inside_hull(hull, ctr[cand][:, plane], pad)
        out |= inside
        n_comp += 1
    _log(f"  convexify: {n_comp}成分 -> {int(out.sum())}面")
    return out


# ── パラメトリックな輪郭で灯火・開口を作り直す ───────────────────
def _pca_frame(pts):
    """点群の主軸(長手方向)と中心を返す。"""
    c = pts.mean(axis=0)
    q = pts - c
    cov = q.T @ q / max(len(q) - 1, 1)
    w, v = np.linalg.eigh(cov)
    order = np.argsort(w)[::-1]
    e1, e2 = v[:, order[0]], v[:, order[1]]
    u = q @ e1
    t = q @ e2
    return c, e1, e2, (u.min(), u.max()), (t.min(), t.max())


def _outline_lens(L, W, n=48, fullness=0.35):
    """細長いレンズ形。両端が尖り、中央がふくらむ。ヘッドライト/テール用。"""
    us = np.linspace(-1, 1, n)
    top = [(u * L / 2, (W / 2) * max(0.0, 1 - u * u) ** fullness) for u in us]
    bot = [(u * L / 2, -(W / 2) * max(0.0, 1 - u * u) ** fullness) for u in us[::-1]]
    return np.array(top + bot)


def _outline_round_rect(L, W, r=0.35, n=10):
    """角の丸い長方形。グリル/インテーク用。"""
    rr = min(L, W) * r / 2
    pts = []
    for cx, cy, a0 in ((L / 2 - rr, W / 2 - rr, 0.0),
                       (-L / 2 + rr, W / 2 - rr, math.pi / 2),
                       (-L / 2 + rr, -W / 2 + rr, math.pi),
                       (L / 2 - rr, -W / 2 + rr, 1.5 * math.pi)):
        for k in range(n + 1):
            a = a0 + math.pi / 2 * k / n
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return np.array(pts)


def _outline_trapezoid(L, W, taper=0.62, r=0.18, n=6):
    """下辺が狭い台形。フロントのコーナーインテーク用。"""
    hw = W / 2.0
    hl = L / 2.0
    pts = [(-hl, hw), (hl, hw), (hl * taper, -hw), (-hl * taper, -hw)]
    # 角を少し丸める
    out = []
    m = len(pts)
    rr = min(L, W) * r
    for i in range(m):
        a = np.array(pts[i - 1], dtype=float)
        b = np.array(pts[i], dtype=float)
        c = np.array(pts[(i + 1) % m], dtype=float)
        e0 = (a - b) / max(np.linalg.norm(a - b), 1e-9)
        e1 = (c - b) / max(np.linalg.norm(c - b), 1e-9)
        p0, p1 = b + e0 * rr, b + e1 * rr
        for k in range(n + 1):
            t = k / n
            out.append(tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t ** 2 * p1))
    return np.array(out)


def _poly_contains(poly, pts):
    """多角形の内外判定(交差数)。"""
    n = len(poly)
    inside = np.zeros(len(pts), dtype=bool)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        cond = ((a[1] > pts[:, 1]) != (b[1] > pts[:, 1]))
        with np.errstate(divide='ignore', invalid='ignore'):
            xint = (b[0] - a[0]) * (pts[:, 1] - a[1]) / (b[1] - a[1] + 1e-30) + a[0]
        inside ^= cond & (pts[:, 0] < xint)
    return inside


def parametric_mask(body, mask, shape='lens', plane=(1, 2), scale=(1.0, 1.0),
                    min_faces=8, x_pad=0.06, symmetric=True, center_tol=0.12):
    """マスクの連結成分ごとに、位置と向きだけ borrow して形をきれいに描き直す。

    テクスチャから起こしたマスクは位置は正しいが輪郭が甘い。成分ごとに
    主軸と広がりを測り、そこへレンズ形や角丸長方形をあてはめる。
    こうすると「参照三面図にある部品の形」を、実データの位置に置ける。
    """
    me = body.data
    nf = len(me.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[] for _ in range(nf)]
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            nbrs[lf[0].index].append(lf[1].index)
            nbrs[lf[1].index].append(lf[0].index)
    bm.free()

    # 車は左右対称。左右がつながって1成分に見えることがあるので、
    # 探索の時点で片側ずつに分けておく(中央にまたがる部品は除く)。
    side = np.sign(ctr[:, 1])
    out = np.zeros(nf, dtype=bool)
    seen = np.zeros(nf, dtype=bool)
    n_comp = 0
    for s in range(nf):
        if seen[s] or not mask[s]:
            continue
        stack, comp = [s], []
        seen[s] = True
        while stack:
            i = stack.pop()
            comp.append(i)
            for j in nbrs[i]:
                if not seen[j] and mask[j] and (
                        not symmetric or side[j] == side[i]
                        or abs(ctr[j, 1]) < center_tol):
                    seen[j] = True
                    stack.append(j)
        if len(comp) < min_faces:
            continue
        idx = np.array(comp, dtype=np.int64)
        # 対称化: 右側(y>0)の成分だけ形を決め、左へはミラーで写す
        cy = ctr[idx][:, 1].mean()
        if symmetric and cy < -center_tol:
            continue
        p2 = ctr[idx][:, plane]
        c, e1, e2, (u0, u1), (t0, t1) = _pca_frame(p2)
        L = (u1 - u0) * scale[0]
        W = (t1 - t0) * scale[1]
        poly = (_outline_lens(L, W) if shape == 'lens'
                else _outline_round_rect(L, W))
        xlo = ctr[idx][:, 0].min() - x_pad
        xhi = ctr[idx][:, 0].max() + x_pad
        cand = (ctr[:, 0] > xlo) & (ctr[:, 0] < xhi)
        polys = [(c, e1, e2)]
        if symmetric and abs(cy) > center_tol:
            m = np.array([-1.0, 1.0])          # y を反転(planeは(y,z))
            polys.append((c * m, e1 * m, e2 * m))
        hit = np.zeros(nf, dtype=bool)
        for cc, a1, a2 in polys:
            world = cc + poly[:, 0:1] * a1 + poly[:, 1:2] * a2
            h = np.zeros(nf, dtype=bool)
            h[cand] = _poly_contains(world, ctr[cand][:, plane])
            hit |= h
        out |= hit
        n_comp += 1
        _log(f"    成分{n_comp}: 中心({c[0]:+.3f},{c[1]:.3f}) 長さ{L*1000:.0f}mm "
             f"幅{W*1000:.0f}mm -> {int(hit.sum())}面")
    _log(f"  parametric[{shape}]: {n_comp}成分 -> {int(out.sum())}面")
    return out


# ── 外形をブーリアンで切り込む(輪郭を階段状にしない) ─────────────
def _boxblur(a, r):
    """積分画像による箱ぼかし。UV上のしきい値境界をなめらかにする。"""
    pad = np.pad(a.astype(np.float64), [(r + 1, r + 1), (r + 1, r + 1)]
                 + [(0, 0)] * (a.ndim - 2), mode='edge')
    c = pad.cumsum(axis=0).cumsum(axis=1)
    H, W = a.shape[:2]
    y0, y1 = 0, 2 * r + 1
    x0, x1 = 0, 2 * r + 1
    out = (c[y1:y1 + H, x1:x1 + W] - c[y0:y0 + H, x1:x1 + W]
           - c[y1:y1 + H, x0:x0 + W] + c[y0:y0 + H, x0:x0 + W])
    return out / ((2 * r + 1) ** 2)


def texel_coord_map(body, W, H, r=14):
    """UVアトラス上の各テクセルに、対応する車体座標(x,y,z)を焼く。

    面マスクで塗り分けると、境界が面の目(約5cm)に沿って鋸歯になる。
    参照三面図のベルトラインや下端の見切りは一本の滑らかな線なので、
    座標そのものをテクスチャに焼いて、テクセル単位でしきい値を切る。
    """
    uv = body.data.uv_layers.active.data
    acc = np.zeros((H, W, 3), dtype=np.float64)
    cnt = np.zeros((H, W), dtype=np.float64)
    nf = len(body.data.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    body.data.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)
    for pl in body.data.polygons:
        us = [uv[li].uv for li in pl.loop_indices]
        uu = [a[0] for a in us]
        vv = [a[1] for a in us]
        # UVの継ぎ目をまたぐ面はbboxがアトラス端まで伸びる。無関係な場所を
        # 塗り潰してしまうので飛ばす(格子1マスは 1/96 x 1/64 程度)。
        if max(uu) - min(uu) > 0.05 or max(vv) - min(vv) > 0.05:
            continue
        u0 = max(0, int(np.floor(min(uu) * W)))
        u1 = min(W, int(np.ceil(max(uu) * W)))
        v0 = max(0, int(np.floor(min(vv) * H)))
        v1 = min(H, int(np.ceil(max(vv) * H)))
        if u1 <= u0 or v1 <= v0:
            continue
        acc[v0:v1, u0:u1] += ctr[pl.index]
        cnt[v0:v1, u0:u1] += 1.0
    num = _boxblur(acc, r)
    den = _boxblur(cnt, r)
    C = num / np.maximum(den, 1e-9)[:, :, None]
    return C, den > 1e-6


def flatten_texels(img, sel, mode='paint', th=0.36, dark=(0.045, 0.045, 0.052)):
    """テクスチャの一部を平らな色で塗る。

    もとのモデルはフロント/リア下部にメッシュグリルや影を持っていて、
    ベイクすると中間調のムラとして残る。参照三面図にそんなムラは無い。
    ここは造形ではなく色の問題なので、UV上で塗り潰して片付ける。

    mode='paint' 塗装色 / 'dark' 指定色 / 'glass' 周りのガラス色
    """
    if not sel.any():
        return
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)
    rgb = px[:, :, :3]
    if mode == 'paint':
        sat = rgb.max(axis=2) - rgb.min(axis=2)
        pm = (sat > 0.10) & (rgb[:, :, 2] > rgb[:, :, 0])
        col = (np.median(rgb[pm], axis=0) if pm.any()
               else np.float32([0.20, 0.28, 0.55]))
    elif mode == 'glass':
        # 決め打ちの色で塗ると、塗った範囲の境界が線として見えてしまう。
        # 周りのガラスそのものの色を使う。
        d = (rgb.mean(axis=2) < th) & sel
        col = (np.median(rgb[d], axis=0) if d.sum() > 64
               else np.float32([0.105, 0.115, 0.128]))
    else:
        col = np.array(dark, dtype=np.float32)
    rgb[sel] = col
    img.pixels.foreach_set(px.reshape(-1))
    img.update()
    _log(f"  ベイク塗り[{mode}]: {int(sel.sum())} texel "
         f"({col[0]:.3f}, {col[1]:.3f}, {col[2]:.3f})")


def build_surface_lens(body, outlines, name, mat, front=True,
                       lift=0.005, thickness=0.011, nr=5, align=False,
                       clamp=0.030):
    """外形の内側を、車体の面に沿って張った板として作る。

    ブーリアンで穴を開ける方式は、面が回り込むリアでは切り口が裂けて
    使えなかった。アーチトリムと同じく、実際にレイキャストして面に
    沿わせれば、外形どおりの縁が確実に出る。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith(name):
            bpy.data.objects.remove(o, do_unlink=True)
    d0 = Vector((1.0, 0.0, 0.0)) if front else Vector((-1.0, 0.0, 0.0))
    made = []
    for k, (poly, xr) in enumerate(outlines):
        c = poly.mean(axis=0)
        px0 = float(xr[0] if front else xr[1])
        d = d0
        n_ctr = -d0
        hit, loc_c, nor_c, _ = body.ray_cast(
            Vector((px0 - d0.x * 3.0, float(c[0]), float(c[1]))), d0)
        if hit:
            n_ctr = nor_c.normalized()
            if align:
                # バンパーのコーナーのように面が回り込む場所では、X方向へ
                # 落とすと外側の点が別の面を掴んで形が崩れる。
                d = -n_ctr
        c_base = Vector((px0, float(c[0]), float(c[1])))
        t_ctr = (loc_c - c_base).dot(d) if hit else 0.0
        rings = []
        ok = True
        for j in range(nr):
            t = (j + 1) / nr
            ring = []
            for p in poly:
                q = c + (p - c) * t
                base = Vector((px0, float(q[0]), float(q[1])))
                h2, loc, nor, _ = body.ray_cast(base - d * 3.0, d)
                if not h2:
                    # 外形の端が車体からわずかにはみ出すことがある。
                    # そこで諦めず、最近傍の面へ落として続ける。
                    h2, loc, nor, _ = body.closest_point_on_mesh(base)
                    if not h2:
                        ok = False
                        break
                # 深さが中心から大きく外れる点は、回り込んだ別の面を
                # 掴んでいる。そのまま使うと形が裂けるので押さえ込む。
                dep = (loc - base).dot(d)
                dep = min(max(dep, t_ctr - clamp), t_ctr + clamp)
                ring.append(base + d * dep + n_ctr * lift)
            if not ok:
                break
            rings.append(ring)
        if not ok or len(rings) < 2:
            _log(f"  {name}{k}: 面が拾えない")
            continue
        n = len(poly)
        verts = [tuple(np.append(c, 0.0)[:3])]  # 仮。直後に中心を入れ直す
        # 中心は最内リングの平均
        verts[0] = tuple(np.mean([[v.x, v.y, v.z] for v in rings[0]], axis=0))
        for ring in rings:
            verts += [tuple(v) for v in ring]
        faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
        for j in range(len(rings) - 1):
            a = 1 + j * n
            b = 1 + (j + 1) * n
            faces += [(a + i, b + i, b + (i + 1) % n, a + (i + 1) % n)
                      for i in range(n)]
        me = bpy.data.meshes.new(f'{name}{k}')
        me.from_pydata(verts, [], faces)
        me.validate()
        ob = bpy.data.objects.new(f'{name}{k}', me)
        bpy.context.scene.collection.objects.link(ob)
        _select_only([ob])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=1e-5)
        bpy.ops.object.mode_set(mode='OBJECT')
        sol = ob.modifiers.new('s', 'SOLIDIFY')
        sol.thickness = thickness
        sol.offset = -1.0
        bpy.ops.object.modifier_apply(modifier=sol.name)
        for pl in ob.data.polygons:
            pl.use_smooth = True
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        made.append(ob)
        _log(f"  {name}{k}: {len(ob.data.polygons)}面 (面沿い)")
    return made


def build_arch_trim(body, disks, width=0.062, lift=0.008,
                    a0=6.0, a1=174.0, ns=64, nr=4):
    """ホイールアーチに沿った黒トリムを、掃引したバンドとして作る。

    面マスクから抜くとふちが面の目(約5cm)に沿って鋸歯になる。
    アーチは真円なので、円弧上を実際にレイキャストして帯を張れば
    参照写真どおりの、くっきりした縁が出る。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_p_arch'):
            bpy.data.objects.remove(o, do_unlink=True)
    made = []
    axles = sorted({round(d['c'][0], 3) for d in disks})
    zc = float(np.mean([d['c'][2] for d in disks]))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for ai, cx in enumerate(axles):
        for si, sgn in enumerate((-1.0, 1.0)):
            runs, cols = [], []
            for k in range(ns + 1):
                th = np.radians(a0 + (a1 - a0) * k / ns)
                col = []
                for j in range(nr):
                    r = ARCH_R + 0.003 + (width - 0.003) * j / (nr - 1)
                    x = cx + r * np.cos(th)
                    z = zc + r * np.sin(th)
                    hit, loc, nor, _ = body.ray_cast(
                        Vector((x, sgn * 3.0, z)), Vector((0, -sgn, 0)))
                    if not hit:
                        col = None
                        break
                    col.append(loc + nor * lift)
                if col is None:
                    # レイが外れた列で帯を切る。捨てずに区間として貯める。
                    if len(cols) >= 6:
                        runs.append(cols)
                    cols = []
                else:
                    cols.append(col)
            if len(cols) >= 6:
                runs.append(cols)
            for ri, run in enumerate(runs):
                nm = f'rs_p_arch{ai}{si}_{ri}'
                me = bpy.data.meshes.new(nm)
                verts = [tuple(v) for c in run for v in c]
                faces = [(a * nr + b, a * nr + b + 1,
                          (a + 1) * nr + b + 1, (a + 1) * nr + b)
                         for a in range(len(run) - 1) for b in range(nr - 1)]
                me.from_pydata(verts, [], faces)
                me.validate()
                ob = bpy.data.objects.new(nm, me)
                bpy.context.scene.collection.objects.link(ob)
                sol = ob.modifiers.new('s', 'SOLIDIFY')
                sol.thickness = 0.007
                sol.offset = 0.0
                _select_only([ob])
                bpy.ops.object.modifier_apply(modifier=sol.name)
                for pl in ob.data.polygons:
                    pl.use_smooth = True
                ob.data.materials.append(bpy.data.materials['CarTrim'])
                made.append(ob)
    _log(f"  アーチトリム: {len(made)}枚")
    return made


def rear_lamp_outlines(body, z_ctr=0.97, hy=0.42, hz=0.135, frac=0.70):
    """テールランプの外形を寸法で決めて返す。

    ベイクの赤ラベルから拾うと、クォーターパネルに散った小さな赤を
    掴んでしまい、参照三面図の横長ランプにならなかった。
    リア面の実寸から比率で置く。
    """
    co = np.empty(len(body.data.vertices) * 3, dtype=np.float64)
    body.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    x_rear = float(co[:, 0].max())
    band = co[(co[:, 0] > x_rear - 0.45)
              & (co[:, 2] > z_ctr - 0.12) & (co[:, 2] < z_ctr + 0.12)]
    hw = float(np.abs(band[:, 1]).max()) if len(band) else 0.82
    xr = (x_rear - 0.02, x_rear)
    poly = _outline_lens(hy, hz, n=28)
    outs = []
    for sgn in (-1.0, 1.0):
        outs.append((np.column_stack(
            [poly[:, 0] + sgn * hw * frac, poly[:, 1] + z_ctr]), xr))
    _log(f"  リアランプ: 半幅 {hw:.3f} -> |y|={hw*frac:.3f}")
    return outs


def front_bumper_outlines(body):
    """フロントの開口(中央グリル+コーナーインテーク)を寸法で決めて返す。

    検出した成分の形をそのまま使うと、左右で大きさが揃わず輪郭も崩れる。
    参照三面図では明確な横長グリルと台形のコーナーインテークなので、
    バンパー面の実寸から比率で置いたほうが実車に近づく。
    """
    co = np.empty(len(body.data.vertices) * 3, dtype=np.float64)
    body.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    x_front = float(co[:, 0].min())
    band = co[(co[:, 0] < x_front + 0.30) & (co[:, 2] > 0.40) & (co[:, 2] < 0.72)]
    hw = float(np.abs(band[:, 1]).max()) if len(band) else 0.86
    xr = (x_front, x_front + 0.02)
    # 中央グリル: 幅は車体の約72%、下端寄り
    g = _outline_round_rect(hw * 1.06, 0.20, r=0.30)
    mid = [(np.column_stack([g[:, 0], g[:, 1] + 0.505]), xr)]
    # コーナーインテーク: 左右対称の台形
    t = _outline_trapezoid(0.235, 0.285, taper=0.55)
    corner = [(np.column_stack(
        [t[:, 0] + sgn * hw * 0.765, t[:, 1] + 0.520]), xr)
        for sgn in (-1.0, 1.0)]
    _log(f"  フロント開口: 中央1 + コーナー2 (半幅 {hw:.3f})")
    return mid, corner


def parametric_outlines(body, mask, shape='lens', scale=(1.0, 1.0),
                        min_faces=8, symmetric=True, center_tol=0.12):
    """マスクの連結成分から、(y,z)平面のパラメトリック外形を作って返す。

    面を選ぶのではなく外形そのものを返す。この外形から角柱を作って
    ブーリアンで切れば、輪郭がメッシュの目に沿って階段状になるのを避けられる。
    """
    me = body.data
    nf = len(me.polygons)
    ctr = np.empty(nf * 3, dtype=np.float64)
    me.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[] for _ in range(nf)]
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            nbrs[lf[0].index].append(lf[1].index)
            nbrs[lf[1].index].append(lf[0].index)
    bm.free()

    side = np.sign(ctr[:, 1])
    seen = np.zeros(nf, dtype=bool)
    outs = []
    for s in range(nf):
        if seen[s] or not mask[s]:
            continue
        stack, comp = [s], []
        seen[s] = True
        while stack:
            i = stack.pop()
            comp.append(i)
            for j in nbrs[i]:
                if not seen[j] and mask[j] and (
                        not symmetric or side[j] == side[i]
                        or abs(ctr[j, 1]) < center_tol):
                    seen[j] = True
                    stack.append(j)
        if len(comp) < min_faces:
            continue
        idx = np.array(comp, dtype=np.int64)
        cy = ctr[idx][:, 1].mean()
        if symmetric and cy < -center_tol:
            continue
        p2 = ctr[idx][:, (1, 2)]
        c, e1, e2, (u0, u1), (t0, t1) = _pca_frame(p2)
        L = (u1 - u0) * scale[0]
        W = (t1 - t0) * scale[1]
        sh = shape
        if shape == 'grille':
            # 中央のグリルは角丸長方形、左右のコーナーインテークは台形
            sh = 'rect' if abs(cy) < 0.42 else 'trap'
        poly = (_outline_lens(L, W) if sh == 'lens'
                else _outline_trapezoid(L, W) if sh == 'trap'
                else _outline_round_rect(L, W))
        xr = (float(ctr[idx][:, 0].min()), float(ctr[idx][:, 0].max()))
        world = c + poly[:, 0:1] * e1 + poly[:, 1:2] * e2
        outs.append((world, xr))
        if symmetric and abs(cy) > center_tol:
            m = np.array([-1.0, 1.0])
            outs.append(((c * m) + poly[:, 0:1] * (e1 * m) + poly[:, 1:2] * (e2 * m), xr))
    _log(f"  outlines[{shape}]: {len(outs)}本")
    return outs


def _prism(poly2d, x0, x1, name):
    """(y,z)の多角形をX方向へ押し出した角柱を作る。"""
    n = len(poly2d)
    verts = [(x0, float(p[0]), float(p[1])) for p in poly2d] + \
            [(x1, float(p[0]), float(p[1])) for p in poly2d]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cut_openings(body, outlines, depth, mat, name, front=True,
                 wall_uv=(0.5, 0.5), align=False):
    """外形の角柱で車体を貫通させ、奥へ引っ込めたレンズで塞ぐ。

    面を選んで凹ませる方式だと、輪郭がメッシュの目(約5cm)に沿って
    階段状になる。角柱でブーリアンすれば、外形どおりの鋭いふちが出る。

    align=True にすると、角柱の軸を開口中心の面法線に合わせる。
    バンパーのコーナーのように面が回り込む場所では、X方向へまっすぐ
    抜くと回り込んだ裏側まで切ってしまい、開口が裂けた形になる。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith(name):
            bpy.data.objects.remove(o, do_unlink=True)
    made = []
    for k, (poly, (xlo, xhi)) in enumerate(outlines):
        pad = 0.20
        x0, x1 = (xlo - pad, xhi + pad)
        pr = _prism(poly, x0, x1, f'{name}_cut{k}')
        nvec = Vector((-1.0, 0.0, 0.0)) if front else Vector((1.0, 0.0, 0.0))
        if align:
            cy = float(np.mean(poly[:, 0]))
            cz = float(np.mean(poly[:, 1]))
            org = Vector((xlo - 0.6, cy, cz)) if front else Vector((xhi + 0.6, cy, cz))
            hit, loc, nor, _ = body.ray_cast(org, -nvec)
            if hit:
                nvec = nor.normalized()
                c = Vector((loc.x, cy, cz))
                ref = Vector((1.0, 0.0, 0.0)) if front else Vector((-1.0, 0.0, 0.0))
                q = ref.rotation_difference(-nvec)
                pr.matrix_world = (Matrix.Translation(c) @ q.to_matrix().to_4x4()
                                   @ Matrix.Translation(-c))

        # レンズ: 車体と角柱の共通部分を取り、奥へずらす
        plug = body.copy()
        plug.data = body.data.copy()
        plug.name = f'{name}{k}'
        bpy.context.scene.collection.objects.link(plug)
        _select_only([plug])
        b = plug.modifiers.new("i", 'BOOLEAN')
        b.object = pr
        b.operation = 'INTERSECT'
        b.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier=b.name)
        if len(plug.data.polygons) == 0:
            bpy.data.objects.remove(plug, do_unlink=True)
            bpy.data.objects.remove(pr, do_unlink=True)
            continue
        plug.location += -nvec * depth
        _select_only([plug])
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        plug.data.materials.clear()
        plug.data.polygons.foreach_set(
            "material_index", np.zeros(len(plug.data.polygons), dtype=np.int32))
        plug.data.materials.append(mat)
        plug.data.update()
        bpy.ops.object.shade_smooth()

        # 車体側に穴を開ける
        _select_only([body])
        b2 = body.modifiers.new("d", 'BOOLEAN')
        b2.object = pr
        b2.operation = 'DIFFERENCE'
        b2.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier=b2.name)
        bpy.data.objects.remove(pr, do_unlink=True)
        made.append(plug)
        _log(f"  {name}{k}: レンズ {len(plug.data.polygons)}面 / 奥行 {depth*1000:.0f}mm")
    return made


# ── ミラー・スポイラー・LEDシグネチャ ──────────────────────────
def add_mirrors(body, img, x_zone=(-1.05, -0.45), z_zone=(0.95, 1.25),
                size=(0.175, 0.085, 0.070)):
    """ドアミラーを別パーツとして置く。

    張り直した面ではミラーが潰れた膨らみになっている。参照三面図の
    ミラーはもっとコンパクトで角が立っているので、その位置に
    きちんとした筐体を被せる。鏡面は暗いガラスで、筐体はボディ色。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_p_mirror'):
            bpy.data.objects.remove(o, do_unlink=True)
    V = _co(body)
    zone = ((V[:, 0] > x_zone[0]) & (V[:, 0] < x_zone[1])
            & (V[:, 2] > z_zone[0]) & (V[:, 2] < z_zone[1]))
    if not zone.any():
        _log("  mirror: 位置が見つからない")
        return []
    u, v = _white_uv(img)
    made = []
    for side in (-1, 1):
        m = zone & (np.sign(V[:, 1]) == side)
        if not m.any():
            continue
        i = np.argmax(np.abs(V[m, 1]))
        p = V[m][i]
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        c = bpy.context.object
        c.name = f'rs_p_mirror{"L" if side < 0 else "R"}'
        c.scale = size
        c.location = (float(p[0]), float(p[1] + side * size[1] * 0.55),
                      float(p[2]))
        c.rotation_euler = (0, math.radians(-6), math.radians(side * 8))
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bv = c.modifiers.new("b", 'BEVEL')
        bv.width = 0.024
        bv.segments = 4
        bpy.ops.object.modifier_apply(modifier=bv.name)
        bpy.ops.object.shade_smooth()
        uvl = c.data.uv_layers.new(name='UVMap')
        for lp in uvl.data:
            lp.uv = (u, v)
        c.data.materials.clear()
        c.data.materials.append(bpy.data.materials['CarBody'])
        made.append(c)
        _log(f"  mirror {c.name}: ({p[0]:.2f}, {p[1]:.2f}, {p[2]:.2f})")
    return made


def add_spoiler(body, img, x_from=0.55, blade=(0.105, 0.022), tip_drop=0.042):
    """リアの屋根端にスポイラーを足す。

    参照三面図ではテールゲート上端にはっきり張り出しがある。
    屋根の後端ラインを拾って、その上に薄い板を渡す。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith('rs_p_spoiler'):
            bpy.data.objects.remove(o, do_unlink=True)
    V = _co(body)
    xmax = V[:, 0].max()
    # 屋根の後端: 一番後ろ寄りで、高いところにある稜線を横断面ごとに拾う
    ys = np.linspace(-0.62, 0.62, 21)
    pts = []
    for y in ys:
        m = (np.abs(V[:, 1] - y) < 0.05) & (V[:, 0] > xmax - 1.0) & (V[:, 2] > 1.15)
        if not m.any():
            continue
        # 「後ろかつ高い」角を拾う。max(x) だけだと傾いたリアガラスの
        # 途中を拾ってしまい、スポイラーがガラスを横切る。
        j = np.argmax(V[m][:, 0] * 0.8 + V[m][:, 2] * 1.6)
        pts.append(V[m][j])
    if len(pts) < 8:
        _log("  spoiler: 屋根後端が拾えない")
        return []
    pts = np.array(pts)
    u, v = _white_uv(img)
    n = len(pts)
    verts, faces = [], []
    # 中央ほど長く、端へ向かって短くする(実車のスポイラーの張り出し)
    span = max(abs(pts[:, 1]).max(), 1e-6)
    for k, p in enumerate(pts):
        taper = 1.0 - 0.45 * (abs(p[1]) / span) ** 2
        base = np.array([p[0], p[1], p[2]])
        tip = base + np.array([blade[0] * taper, 0.0, -tip_drop * taper])
        verts.append(tuple(base))
        verts.append(tuple(tip))
    for k in range(n - 1):
        a = 2 * k
        faces.append((a, a + 2, a + 3, a + 1))
    me = bpy.data.meshes.new('rs_p_spoiler')
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new('rs_p_spoiler', me)
    bpy.context.scene.collection.objects.link(ob)
    _select_only([ob])
    sol = ob.modifiers.new("sol", 'SOLIDIFY')
    sol.thickness = blade[1]
    sol.offset = 0.0
    bpy.ops.object.modifier_apply(modifier=sol.name)
    bv = ob.modifiers.new("b", 'BEVEL')
    bv.width = 0.008
    bv.segments = 2
    bpy.ops.object.modifier_apply(modifier=bv.name)
    bpy.ops.object.shade_smooth()
    uvl = ob.data.uv_layers.new(name='UVMap')
    for lp in uvl.data:
        lp.uv = (u, v)
    ob.data.materials.clear()
    ob.data.materials.append(bpy.data.materials['CarBody'])
    _log(f"  spoiler: {len(ob.data.polygons)}面 ({n}断面)")
    return [ob]


def add_led_signature(lens_objs, name='rs_p_led', shrink=(0.62, 0.30),
                      offset=0.006):
    """ヘッドライトのレンズ内に、細い発光の帯を入れる。

    参照三面図の顔つきはこのシグネチャで決まる。レンズ1枚だけだと
    のっぺりするので、内側にもう1枚細い明るい板を置く。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith(name):
            bpy.data.objects.remove(o, do_unlink=True)
    m = bpy.data.materials.get('CarLed')
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new('CarLed')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.92, 0.95, 1.0, 1.0)
    b.inputs['Roughness'].default_value = 0.20
    if 'Emission Color' in b.inputs:
        b.inputs['Emission Color'].default_value = (0.85, 0.92, 1.0, 1.0)
        b.inputs['Emission Strength'].default_value = 1.6

    made = []
    for k, src in enumerate(lens_objs):
        d = src.copy()
        d.data = src.data.copy()
        d.name = f'{name}{k}'
        bpy.context.scene.collection.objects.link(d)
        c = _co(d)
        ctr = (c.min(axis=0) + c.max(axis=0)) / 2
        s = np.array([1.0, shrink[0], shrink[1]])
        d.location = (0, 0, 0)
        V = (c - ctr) * s + ctr
        V[:, 0] -= offset
        d.data.vertices.foreach_set("co", V.reshape(-1))
        d.data.update()
        d.data.materials.clear()
        d.data.polygons.foreach_set(
            "material_index", np.zeros(len(d.data.polygons), dtype=np.int32))
        d.data.materials.append(m)
        _select_only([d])
        bpy.ops.object.shade_smooth()
        made.append(d)
    _log(f"  LEDシグネチャ: {len(made)}枚")
    return made
