"""車のパーツを寸法から新規に組む。

参考モデル(Meshy)は見て寸法を読むためだけに使う。ここには参考モデルを
サンプリングするコードは無く、入力は人が読める寸法だけ。

境界は「面を消して作る」のではなく「輪郭を描いて面を張る」。
面を消す方式だと境界が既存の三角形の辺に沿うしかなく、必ず階段になる。
輪郭から張れば、境界は最初からエッジになる。

座標系は最終と同じ(長手+Y / 上+Z / 接地面 z=0)。
ホイールの軸は車幅方向なので X。
"""
import bpy
import bmesh
import math
import numpy as np


def _log(*a):
    print("[car_parts]", *a)


def _select_only(ob):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def _replace(name):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)


def _mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def revolve(profile, name, segments=72, close_caps=False, smooth=True):
    """(r, x) の折れ線を X 軸まわりに回した面を作る。

    profile: [(半径, 軸方向位置), ...] 軸に沿って並べる
    """
    P = np.asarray(profile, dtype=np.float64)
    n = len(P)
    th = np.linspace(0.0, 2.0 * np.pi, segments, endpoint=False)
    verts = []
    for r, x in P:
        for t in th:
            verts.append((x, r * math.cos(t), r * math.sin(t)))
    faces = []
    for i in range(n - 1):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    ob = _mesh_object(name, verts, faces)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def _smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def grid_surface(name, rows, close_v=False, smooth=True, x_of_r=None):
    """(半径, 角度) で並べた頂点の格子から面を張る。

    rows: [[(r, angle), ...], ...] 内側から外側へ。各行の点数は同じ。
    ホイールの軸は X なので、頂点は (0, r cos a, r sin a) に置く。

    「面を消して穴を開ける」のではなく「必要なところにだけ面を張る」。
    開口の縁は最初からこの面の境界なので、階段にならない。
    """
    verts, faces = [], []
    n = len(rows[0])
    for row in rows:
        for r, a in row:
            x = x_of_r(r) if x_of_r else 0.0
            verts.append((x, r * math.cos(a), r * math.sin(a)))
    for i in range(len(rows) - 1):
        for j in range(n - 1 + (1 if close_v else 0)):
            a0 = i * n + j
            a1 = i * n + (j + 1) % n
            faces.append((a0, a1, a1 + n, a0 + n))
    ob = _mesh_object(name, verts, faces)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def solidify(ob, thickness, offset=0.0, bevel=0.0, bevel_segments=2):
    _select_only(ob)
    m = ob.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    bpy.ops.object.modifier_apply(modifier=m.name)
    if bevel > 0.0:
        b = ob.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = bevel_segments
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(35.0)
        bpy.ops.object.modifier_apply(modifier=b.name)
    return ob


def auto_smooth(ob, angle=34.0):
    """角度でスムーズ/フラットを分ける。全面スムーズだと平らな面まで
    丸く陰影が付いて、ドーナツのように見える。"""
    _select_only(ob)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except AttributeError:
        bpy.ops.object.shade_smooth()
    return ob


def _lerp(a, b, t):
    return a + (b - a) * t


def spoke_face(name, geo, n_spokes, n_r=12, n_v=12):
    """V字スポークの面を張る。

    1本のスポーク(腕 + 2本の脚)は**1つのメッシュ**にする。
    別メッシュにすると、接合部でベベルが両側から入って溝になり、
    ブレードが途中で分断されて見える。

    ハブの円板 → 腕 → 2本に割れた脚 → 外周リングの順に格子を作る。
    脚の内端は腕の外端の頂点をそのまま使うので継ぎ目は開かない。
    脚と脚の間が開口になる。開口の縁は最初からこの面の境界。
    """
    g = geo
    step = 2.0 * math.pi / n_spokes
    xr = g['x_of_r']
    objs = []

    ring = [[(g['r_hub'] * k / 3.0 if k else 1e-4,
              2.0 * math.pi * j / 48) for j in range(48)] for k in (0, 3)]
    objs.append(grid_surface(f'{name}_hub', ring, close_v=True, x_of_r=xr))

    outer = [[(r, 2.0 * math.pi * j / 96) for j in range(96)]
             for r in (g['r_ring'], g['r_face'])]
    objs.append(grid_surface(f'{name}_ring', outer, close_v=True, x_of_r=xr))

    half = n_v // 2
    for i in range(n_spokes):
        th = i * step
        verts, faces = [], []

        def put(row, channel=True):
            """1行分の頂点を置く。

            幅方向の位置に応じて軸方向へ凹ませ、ブレードに彫りを付ける。
            参考のブレードは平板ではなく、中央に沿って凹んだ溝がある。
            """
            base = len(verts)
            n = max(len(row) - 1, 1)
            for j, (r, a) in enumerate(row):
                sfac = 2.0 * j / n - 1.0          # -1..+1
                d = (g['channel'] * (1.0 - sfac * sfac)
                     if channel else 0.0)
                verts.append((xr(r) - d, r * math.cos(a), r * math.sin(a)))
            return list(range(base, base + len(row)))

        # 腕: ハブから分岐点まで
        idx_rows = []
        for k in range(n_r + 1):
            t = k / n_r
            r = _lerp(g['r_hub'], g['r_fork'], t)
            w = math.radians(_lerp(g['arm_deg_hub'], g['arm_deg_fork'], t))
            idx_rows.append(put([(r, th - w + 2 * w * j / n_v)
                                 for j in range(n_v + 1)]))
        for a, b in zip(idx_rows, idx_rows[1:]):
            faces += [(a[j], a[j + 1], b[j + 1], b[j]) for j in range(n_v)]

        # 脚: 分岐点から外周リングまで。腕の外端をそのまま内端に使う
        fork = idx_rows[-1]
        for sign, start in ((-1, fork[:half + 1]), (+1, fork[half:])):
            rows = [start]
            for k in range(1, n_r + 1):
                u = k / n_r
                t = u ** 0.6
                r = _lerp(g['r_fork'], g['r_ring'], u)
                # フィレットは外縁だけ。溝側に入れると溝がリム際で閉じる
                fil = math.radians(g['fillet_deg']) * (u ** 3)
                # 溝側にもフィレット。片側だけだと窓の隅が三角に尖る
                fin = math.radians(g['fillet_deg'] * 0.8) * (1.0 - u) ** 2
                inner = th + sign * (math.radians(
                    _lerp(0.0, g['gap_deg'], t)) + fin)
                outer_a = th + sign * (math.radians(
                    _lerp(g['arm_deg_fork'], g['leg_deg_out'], t)) + fil)
                lo_a, hi_a = ((outer_a, inner) if sign < 0 else (inner, outer_a))
                rows.append(put([(r, _lerp(lo_a, hi_a, j / half))
                                 for j in range(half + 1)]))
            for a, b in zip(rows, rows[1:]):
                faces += [(a[j], a[j + 1], b[j + 1], b[j]) for j in range(half)]

        ob = _mesh_object(f'{name}_spoke{i}', verts, faces)
        for pl in ob.data.polygons:
            pl.use_smooth = True
        objs.append(ob)
    return objs


# ── ホイール ────────────────────────────────────────────────
# 参考モデルの三面図を見て読んだ寸法。すべて人が言葉にできる値。
WHEEL = dict(
    tyre_od=0.645,        # タイヤ外径
    tyre_width=0.255,     # タイヤ幅
    rim_od=0.487,         # リム径(外径の約75%)。3/4で並べて読み直した値。
                          # 大きすぎるとサイドウォールが薄くなり、
                          # タイヤが平たい帯に見える
    rim_width=0.215,      # リムの見付け幅
    shoulder=0.030,       # トレッドのショルダーの丸み
    sidewall_bulge=0.011, # サイドウォールの膨らみ
    n_spokes=5,           # V字スポークの本数
    # ブレードの半角はハブ→リムで単調に「減らす」。参考は窓がリム側で
    # 広くハブ側で尖る形。逆にすると窓が外で細る扇になる。
    # 途中で増減が反転すると縁がS字を描いてねじれて見えるので単調に。
    # 参考のスポークはハブ側で広く、分岐して2本の脚がV字に開く。
    # 脚と脚の間にも三角の窓ができる。gap を細くすると、10本の細い羽根が
    # 等間隔に並んだ扇車にしか見えない。実際そうなった
    arm_deg_hub=32.0,     # ハブでの腕の半角
    arm_deg_fork=22.0,    # 分岐点での腕の半角
    gap_deg=2.2,          # 脚と脚の間(片側)。V字の細い窓
    leg_deg_out=24.0,     # リム側でのブレード外縁の半角。隣との間が大きな窓
    fillet_deg=2.0,       # リムとの取り合いの丸み
    face_dish=0.011,      # スポーク面の落ち込み
    face_thick=0.015,     # スポークの厚み
    hub_od=0.092,         # センターキャップ径
    channel=0.0045,       # ブレードに沿った彫りの深さ
    disc_od=0.185,        # ブレーキローター径
)


def build_wheel(name='wh', p=None, segments=72):
    """タイヤ+リム+スポーク面+センターキャップ+ローターを組む。

    それぞれ独立したパーツとして作るので、マテリアルの境界は
    もともとメッシュの境界になっている。
    """
    p = dict(WHEEL, **(p or {}))
    for o in list(bpy.data.objects):
        if o.name.startswith(name + '_'):
            bpy.data.objects.remove(o, do_unlink=True)
    R = p['tyre_od'] / 2.0
    Rr = p['rim_od'] / 2.0
    hw = p['tyre_width'] / 2.0
    hrw = p['rim_width'] / 2.0
    sh = p['shoulder']
    bul = p['sidewall_bulge']
    parts = []

    # タイヤ: 断面を1本描いて回す。トレッドは中央がわずかに高い
    # サイドウォールは外へ張り、トレッドは中央がわずかに高い冠状にする。
    # 直線的な断面だと、3/4から見たときに平たい帯に見える
    tyre = [
        (Rr, -hrw), (Rr + 0.016, -hrw - 0.008),
        (Rr + 0.038 + bul, -hw + 0.006), (R - sh - 0.010 + bul, -hw),
        (R - sh, -hw + 0.004), (R - sh * 0.34, -hw * 0.86),
        (R - 0.003, -hw * 0.58), (R, -hw * 0.30),
        (R, hw * 0.30), (R - 0.003, hw * 0.58),
        (R - sh * 0.34, hw * 0.86), (R - sh, hw - 0.004),
        (R - sh - 0.010 + bul, hw), (Rr + 0.038 + bul, hw - 0.006),
        (Rr + 0.016, hrw + 0.008), (Rr, hrw),
    ]
    parts.append(revolve(tyre, f'{name}_tyre', segments))

    # リムのバレルとフランジ
    barrel = [
        (Rr, hrw), (Rr - 0.012, hrw - 0.006), (Rr - 0.015, hrw - 0.028),
        (Rr - 0.015, -hrw + 0.045), (Rr - 0.010, -hrw + 0.018),
        (Rr, -hrw + 0.005), (Rr, -hrw),
    ]
    parts.append(revolve(barrel, f'{name}_rim', segments))

    # スポーク面。皿状の落ち込みは半径の関数で入れる
    r_face = Rr - 0.015
    x_face = hrw - 0.014
    dishd = p['face_dish']

    def x_of_r(r):
        t = np.clip(r / r_face, 0.0, 1.0)
        return x_face - dishd * (1.0 - t ** 2.2)

    geo = dict(r_hub=r_face * 0.200, r_fork=r_face * 0.62,
               r_ring=r_face * 0.925, r_face=r_face,
               arm_deg_hub=p['arm_deg_hub'], arm_deg_fork=p['arm_deg_fork'],
               gap_deg=p['gap_deg'], leg_deg_out=p['leg_deg_out'],
               fillet_deg=p['fillet_deg'], channel=p['channel'],
               x_of_r=x_of_r)
    face_parts = spoke_face(name, geo, p['n_spokes'])
    for o in face_parts:
        solidify(o, p['face_thick'], offset=-1.0, bevel=0.0035)
    parts += face_parts

    # センターキャップ
    hr = p['hub_od'] / 2.0
    x0 = x_of_r(0.0)
    cap = [(0.0, x0 + 0.020), (hr * 0.42, x0 + 0.018), (hr * 0.74, x0 + 0.011),
           (hr * 0.93, x0 + 0.001), (hr, x0 - 0.008), (hr, x0 - 0.024)]
    parts.append(revolve(cap, f'{name}_cap', segments))

    # ブレーキローター(スポークの隙間から見える)
    dr = p['disc_od'] / 2.0
    xd = -0.080
    disc = [(dr * 0.20, xd + 0.016), (dr * 0.20, xd), (dr, xd),
            (dr, xd + 0.012), (dr * 0.20, xd + 0.012)]
    parts.append(revolve(disc, f'{name}_disc', segments))

    for o in parts:
        auto_smooth(o)
    _log(f"{name}: {len(parts)}パーツ / "
         f"{sum(len(o.data.polygons) for o in parts)}面")
    return parts


# ── ボディ ──────────────────────────────────────────────────
# キャラクターラインを先に引き、その間を帯(パネル)として張る。
#
# 車体を1枚の滑らかな面として近似すると、稜線が全部消えて風船になる。
# 実車の面は稜線で区切られたパネルの集まりなので、そのとおりに作る。
# 帯の境界がそのままキャラクターラインのエッジになる。
#
# 数値は参考モデルの三面図を見て読んだもの。長手+Y(フロントが-Y)、
# 上+Z、接地面z=0、左右はX。ここでは +X 側の半分だけ定義して鏡像を取る。
# 各行は (y, 半幅x, 高さz)。
BODY_LINES = {
    # 屋根の中心線(x=0)。ノーズ→ボンネット→ルーフ→テールゲート
    # ボンネットは参考より最大19cm低かった。ノーズからカウルまで
    # ひと続きに上がる線に引き直した。テールは逆に高すぎて箱に見えた
    'crown': [
        (-2.075, 0.000, 0.810), (-2.010, 0.000, 0.850), (-1.880, 0.000, 0.925),
        (-1.550, 0.000, 1.030), (-1.150, 0.000, 1.150), (-0.820, 0.000, 1.265),
        (-0.620, 0.000, 1.360), (-0.300, 0.000, 1.485), (0.050, 0.000, 1.553),
        (0.420, 0.000, 1.576), (0.850, 0.000, 1.573), (1.220, 0.000, 1.550),
        (1.560, 0.000, 1.495), (1.760, 0.000, 1.400), (1.820, 0.000, 1.300),
        (1.870, 0.000, 1.270), (1.950, 0.000, 1.152), (2.020, 0.000, 1.040),
    ],
    # ルーフレール。参考のルーフは天面がほぼ平らで、rail はクラウンの
    # 16mm 下にある。絞りはすべてピラー側で起きる。ドーム状に落とすと
    # 上に向かって尖り、z=1.52 で 17cm 細くなった
    'rail': [
        (-2.065, 0.360, 0.796), (-2.005, 0.460, 0.828), (-1.950, 0.507, 0.860),
        (-1.880, 0.541, 0.900), (-1.850, 0.556, 0.909), (-1.750, 0.573, 0.939),
        (-1.650, 0.586, 0.970), (-1.550, 0.592, 1.000), (-1.150, 0.572, 1.120),
        (-0.820, 0.585, 1.228), (-0.620, 0.590, 1.310), (-0.300, 0.592, 1.469),
        (0.050, 0.596, 1.537), (0.420, 0.598, 1.560), (0.850, 0.596, 1.557),
        (1.220, 0.578, 1.534), (1.560, 0.540, 1.479), (1.760, 0.505, 1.384),
        (1.820, 0.492, 1.284), (1.870, 0.478, 1.254), (1.950, 0.442, 1.136),
        (2.015, 0.386, 1.010),
    ],
    # ベルトライン(窓の下端)。ボンネットを上げた分、カウルも一緒に上げる。
    # ここを据え置くとフロントガラスがボンネットより下から始まる
    'belt': [
        (-2.050, 0.550, 0.735), (-1.995, 0.597, 0.755), (-1.950, 0.646, 0.775),
        (-1.880, 0.690, 0.805), (-1.850, 0.708, 0.816), (-1.750, 0.729, 0.852),
        (-1.650, 0.746, 0.889), (-1.550, 0.754, 0.925), (-1.150, 0.790, 1.062),
        (-0.820, 0.775, 1.145), (-0.620, 0.765, 1.150), (-0.300, 0.760, 1.150),
        (0.050, 0.758, 1.148), (0.420, 0.758, 1.156), (0.850, 0.756, 1.200),
        (1.220, 0.715, 1.262), (1.560, 0.706, 1.300), (1.780, 0.726, 1.300),
        (1.960, 0.790, 1.120), (2.030, 0.710, 1.020), (2.075, 0.610, 0.955),
    ],
    # キャラクターライン。ドアハンドルの少し下を通り、後ろへ向かって上がる。
    # 参考の側面にある強い稜線。ここで面が折れることで平板に見えなくなる
    'crease': [
        (-2.030, 0.660, 0.559), (-1.975, 0.713, 0.577), (-1.950, 0.745, 0.586),
        (-1.880, 0.795, 0.613), (-1.850, 0.817, 0.622), (-1.750, 0.841, 0.653),
        (-1.650, 0.860, 0.684), (-1.550, 0.869, 0.715), (-1.150, 0.876, 0.821),
        (-0.820, 0.880, 0.885), (-0.480, 0.874, 0.888), (-0.120, 0.874, 0.890),
        (0.350, 0.875, 0.900), (0.800, 0.876, 0.915), (1.150, 0.873, 0.930),
        (1.450, 0.868, 0.940), (1.650, 0.865, 0.944), (1.700, 0.860, 0.945),
        (1.750, 0.850, 0.941), (1.850, 0.824, 0.934), (1.900, 0.807, 0.930),
        (1.950, 0.785, 0.919), (2.040, 0.681, 0.900), (2.120, 0.610, 0.860),
    ],
    # 最大幅の線(ウエスト)。参考の平面形は前輪から後輪までほぼ一定幅で、
    # 車軸の上で膨らませていない。膨らませると正規化で胴が細り、
    # 上から見て 7cm 狭くなっていた
    'waist': [
        (-2.020, 0.685, 0.440), (-1.970, 0.745, 0.460), (-1.950, 0.771, 0.467),
        (-1.880, 0.823, 0.492), (-1.850, 0.846, 0.500), (-1.750, 0.871, 0.525),
        (-1.650, 0.891, 0.550), (-1.550, 0.901, 0.575), (-1.150, 0.910, 0.645),
        (-0.820, 0.906, 0.690), (-0.480, 0.905, 0.715), (-0.120, 0.905, 0.727),
        (0.350, 0.907, 0.732), (0.800, 0.909, 0.735), (1.150, 0.910, 0.735),
        (1.450, 0.910, 0.730), (1.650, 0.896, 0.722), (1.700, 0.891, 0.720),
        (1.750, 0.881, 0.716), (1.850, 0.853, 0.709), (1.900, 0.836, 0.706),
        (1.950, 0.813, 0.699), (2.040, 0.706, 0.685), (2.125, 0.620, 0.640),
    ],
    # ロッカー(サイドシル)。この線をホイールアーチに沿わせる
    'rocker': [
        (-2.020, 0.676, 0.290), (-1.970, 0.728, 0.272), (-1.950, 0.754, 0.269),
        (-1.880, 0.805, 0.258), (-1.850, 0.827, 0.257), (-1.750, 0.851, 0.255),
        (-1.650, 0.870, 0.252), (-1.550, 0.880, 0.250), (-1.150, 0.888, 0.246),
        (-0.820, 0.886, 0.244), (-0.480, 0.885, 0.244), (-0.120, 0.885, 0.244),
        (0.350, 0.885, 0.244), (0.800, 0.886, 0.245), (1.150, 0.888, 0.247),
        (1.450, 0.890, 0.249), (1.650, 0.875, 0.259), (1.700, 0.870, 0.262),
        (1.750, 0.861, 0.272), (1.850, 0.834, 0.291), (1.900, 0.817, 0.300),
        (1.950, 0.795, 0.319), (1.980, 0.782, 0.330), (2.040, 0.620, 0.360),
    ],
    # 床下の見切り。前後端は中心へ寄せて閉じる
    'under': [
        (-2.000, 0.570, 0.155), (-1.950, 0.677, 0.130), (-1.950, 0.677, 0.130),
        (-1.880, 0.723, 0.128), (-1.850, 0.743, 0.133), (-1.750, 0.764, 0.148),
        (-1.650, 0.782, 0.164), (-1.550, 0.791, 0.180), (-1.150, 0.795, 0.200),
        (-0.820, 0.795, 0.202), (-0.480, 0.795, 0.203), (-0.120, 0.795, 0.203),
        (0.350, 0.795, 0.203), (0.800, 0.795, 0.202), (1.150, 0.795, 0.201),
        (1.450, 0.793, 0.198), (1.650, 0.786, 0.187), (1.700, 0.782, 0.184),
        (1.750, 0.773, 0.197), (1.850, 0.749, 0.224), (1.880, 0.740, 0.232),
        (1.950, 0.714, 0.290), (1.950, 0.714, 0.290), (2.000, 0.570, 0.340),
    ],
}
# 帯(パネル)。内側から外側へ、稜線でエッジになる。
# 最後の値は帯の膨らみ[m]。稜線どうしを直線で結ぶと面が平らになり、
# 車体が多面体のように見える。実車のパネルは稜線の間で張っているので、
# 断面の法線方向へ膨らませる。
# 膨らみは「実在する稜線」で挟まれた帯にだけ与える。hood/bumper/lip は
# 稜線と稜線の間を埋めるために計算で作った線で、実車には無い。そこに
# 膨らみを与えると、両側の帯が互いに逆向きの接線で合わさり、参考には
# 無い筋が側面に何本も出る。3/4 で見て初めて分かった
BODY_BANDS = [
    # ルーフは負の膨らみ。参考の天面は頂点から 15mm 下がった高さで
    # 半幅0.287 しかない。正の膨らみだと平らな台地になり 0.47 まで広がる
    ('roof_in',  'crown',  'hood',   8, -0.010),
    ('roof_out', 'hood',   'rail',   8, -0.010),
    ('pillar',   'rail',   'belt',   9, 0.006),
    ('shoulder', 'belt',   'crease', 8, 0.016),
    ('flank',    'crease', 'waist',  6, 0.014),
    ('side_up',  'waist',  'bumper', 6, 0.008),
    ('side_lo',  'bumper', 'lip',    4, 0.004),
    ('side_lip', 'lip',    'rocker', 4, 0.004),
    ('sill',     'rocker', 'under',  3, 0.005),
]
# 膨らみを効かせる長手の範囲 {帯: (満額になる y, 0 になる y)}。
# ルーフの負の膨らみは屋根だけに要る。帯は全長に走っているので、
# 指定しないとボンネットまでドーム状になり、縦の隆起が2本出る
BULGE_SPAN = {'roof_in': (-0.35, -1.10), 'roof_out': (-0.35, -1.10)}

# 窓。帯を y 方向と帯の中の行で区切り、その区画だけ内側へ落として
# 別パーツにする。区切りの位置がそのままエッジになる。
# (band, 名前, y開始, y終了, 落とし込み[m], 行の開始比, 行の終了比)
# 行の比は帯の内側(0.0)から外側(1.0)。サイド窓は上半分だけを使う。
WINDOWS_ = None
# 1枚の窓を帯ごとに別々の範囲で切ると、1つの開口ではなく入れ子の段差に
# なる。上から見ると「く」の字の溝が何本も並んで見えた。窓をまたぐ帯は
# y の範囲・行の範囲・|x| の範囲をすべて揃えること。ピラーの太さは
# 「窓と窓の y の間隔」で作る
WINDOWS = [
    ('roof_in',  'windscreen', -0.980, -0.420, 0.008, 0.00, 1.00, 0.00, 1.00),
    ('roof_out', 'windscreen', -0.980, -0.420, 0.008, 0.00, 1.00, 0.00, 1.00),
    ('pillar',   'windscreen', -0.980, -0.420, 0.008, 0.00, 1.00, 0.00, 1.00),
    ('roof_in',  'backlight',   1.560,  1.985, 0.008, 0.00, 1.00, 0.00, 1.00),
    ('roof_out', 'backlight',   1.560,  1.985, 0.008, 0.00, 1.00, 0.00, 1.00),
    ('pillar',   'backlight',   1.700,  1.985, 0.008, 0.00, 1.00, 0.00, 1.00),
    ('pillar',   'side_front', -0.285,  0.400, 0.010, 0.00, 1.00, 0.00, 1.00),
    ('pillar',   'side_rear',   0.470,  1.020, 0.010, 0.00, 1.00, 0.00, 1.00),
]

# 灯火とグリル開口。窓と同じ仕組みで、帯の区画を切り出して内外へ落とす。
# 落とし込みが正なら奥へ、負なら手前へ出る。
# (band, 名前, y開始, y終了, 落とし込み[m], 行開始, 行終了, |x|開始, |x|終了)
# |x| はその断面の最大半幅に対する比。前面と側面を分けるのに要る。
# これが無いと、灯火が断面を一周して側面まで回り込む。
FEATURES = [
    ('shoulder', 'headlight', -1.995, -1.770, 0.013, 0.25, 0.63, 0.42, 1.00),
    # ボンネットの見切りはフェンダーの上面を長手に走る。前面の抜きだけ
    # では左右へつながらない
    ('shoulder', 'hshut', -1.995, -1.030, 0.010, 0.00, 0.15, 0.00, 1.00),
    # ドアハンドルの取り付き。参考は指を掛ける彫りがある
    ('shoulder', 'grip_f', -0.415, -0.245, 0.012, 0.66, 0.86, 0.55, 1.00),
    ('shoulder', 'grip_r',  0.615,  0.785, 0.012, 0.66, 0.86, 0.55, 1.00),
    # 灯火の内側。もう一段奥へ落としてリフレクターの抑揚を出す
    ('shoulder', 'lamp_in',  -1.985, -1.800, 0.026, 0.38, 0.50, 0.50, 1.00),
    ('shoulder', 'taillight',  1.860,  2.010, 0.013, 0.25, 0.75, 0.42, 1.00),
    ('shoulder', 'tlamp_in',   1.875,  1.995, 0.024, 0.38, 0.62, 0.52, 1.00),
    # フロントの開口とヘッドランプは前面(_nose_cap)側に移した。帯の前端は
    # コーナーで終わっているので、ここに前面の抜きを置くと薄片になる
    ('sill',     'diffuser',   1.930,  2.030, 0.020, 0.05, 0.95, 0.00, 0.88),
    # リアバンパー下部の段。ディフューザーの左右に彫りを入れる
    ('side_lip', 'rdiff_l',    1.900,  2.020, 0.018, 0.10, 0.80, 0.30, 0.86),
]
# 【使わない】行方向に細い溝を入れて長手の稜線を作る方式。
# 帯の行数が6〜7しかないため、行1本ぶんの幅(帯の1/6)が最小の溝になり、
# ボンネットに太い帯が走ってしまう。長手の稜線が要るときは、
# BODY_LINES に稜線を1本足して帯を分割すること(flank と同じやり方)。

# ドア・ボンネット・テールゲートの見切り線。細い区間を凹ませて溝にする。
# 切り込みではなく「一段凹んだ細い帯」なので、縁は最初からエッジ。
# 実車のパネル隙間は 3〜5mm。深さ 12mm の溝にすると、3/4 で見たときに
# 線が主張しすぎて参考の静かな面と印象が変わる。幅は列の間隔(4.3m/160
# ≒27mm)より少し広く取り、必ず1列は拾えるようにしたうえで、浅くする
SHUT_W = 0.028          # 溝の幅[m](既定)
SHUT_D = 0.005          # 溝の深さ[m](既定)
# 線ごとの太さ・深さ。参考はボンネットが細く、ハッチが太い
SHUT_SIZE = {'hood': (0.026, 0.004), 'hatch': (0.030, 0.006),
             'bmp_f': (0.026, 0.004), 'bmp_r': (0.026, 0.004)}
SHUT_LINES = [
    ('door_f', -0.760, ('shoulder', 'flank', 'side_up', 'side_lo')),
    ('door_m',  0.440, ('shoulder', 'flank', 'side_up', 'side_lo')),
    ('door_r',  1.120, ('shoulder', 'flank', 'side_up', 'side_lo')),
    ('hood',   -1.030, ('shoulder', 'flank')),
    # バンパーとフェンダーの見切り。参考は前後とも明確に分かれている
    # 参考のバンパー見切りは斜めだが、溝は一定の y でしか置けない。
    # 上下の帯で y をずらして段にしてみたが、斜めには見えず「ずれた
    # 2本」になり、後輪アーチとも重なった。1本のまっすぐな線に戻す
    ('bmp_f',  -1.700, ('shoulder', 'flank', 'side_up', 'side_lo',
                        'side_lip')),
    ('bmp_r',   1.905, ('shoulder', 'flank', 'side_up', 'side_lo',
                        'side_lip')),
    ('hatch',   1.560, ('shoulder', 'flank', 'side_up', 'side_lo', 'side_lip')),
]


def _shut_features():
    """見切り線を FEATURES と同じ形の指定に展開する。"""
    out = []
    for nm, y, bands in SHUT_LINES:
        w, d = SHUT_SIZE.get(nm, (SHUT_W, SHUT_D))
        for b in bands:
            out.append((b, f'shut_{nm}', y - w / 2, y + w / 2,
                        d, 0.00, 1.00, 0.00, 1.00))
    return out

# 取り付け部品。位置は三面図から読んだ値
# スポイラーはルーフの後端(リアガラスの上端の後ろ)に置く。
# ルーフの途中に置くと、板を屋根に貼っただけに見える
SPOILER = dict(y=1.930, drop=0.038, chord=0.140, thick=0.020, span=0.54)
# 参考の全幅(ミラー込み)は2.045m、車体幅は1.820m。差の半分がミラーの
# 張り出しなので、ステーを伸ばしてそこへ合わせる
# ミラーが付く位置(y=-0.56)の車体半幅は0.8205で、最大半幅0.910より狭い。
# 参考の全幅2.045(半幅1.0225)へ届かせるには、ここから0.202出す必要がある。
# ステーと筐体で分担する。ステーだけ伸ばすと棒の先の玉に見える
# z=1.10 まで上げるとベルトラインより上=ガラス面に付き、宙に浮いた。
# ステーは車体からミラーまでの距離。belt を絞ったぶんだけ伸ばす
MIRROR = dict(y=-0.600, z=1.110, size=(0.126, 0.235, 0.120), stalk=0.160)
HANDLES = [(-0.330, 0.960), (0.700, 0.985)]   # (y, z)
HANDLE_SIZE = (0.030, 0.185, 0.042)
# グリルの横桟。参考の開口には水平のバーが並ぶ
SLATS = dict(n=9, y=-2.126, z0=0.352, z1=0.446, half=0.400,
             thick=0.009, depth=0.018)
# ホイールアーチ。参考の車軸位置とタイヤ外径から決めた開口
# track_half: 車軸の左右位置。タイヤの外端(track_half + タイヤ幅の半分)が
# アーチの縁より内側に入っていないと、側面図でタイヤが車体に被って見える。
# 実際に 0.773 では被った。実車もタイヤはフェンダーより数cm内側にある
ARCH = dict(y_front=-1.279, y_rear=1.430, z_axle=0.3225, radius=0.378,
            lip=0.055, track_half=0.770, lip_out=0.014,
            # 参考は後輪の上で肩がはっきり張る。前後で張り出し量を変える
            # 参考の平面形は車軸の上で張り出していない。張り出すと
            # HALF_WIDTH の正規化で胴が縮み、ドアが 7cm 細くなる。
            # タイヤ外端は 0.705+0.128=0.833 で、車体 0.910 の内側に入る
            flare=0.000, flare_rear=1.30, flare_span=0.86)
# アーチの上でフェンダーが持ち上がる量[m]。ロッカーを弧に乗せると、
# そのままでは waist(最大幅の線)より上に来て帯が上下逆になり、
# タイヤの上でつぶれた面ができる。上の稜線も一緒に押し上げて順序を保つ
FENDER_RISE = [('lip', 0.022), ('bumper', 0.045), ('waist', 0.078),
               ('crease', 0.150), ('belt', 0.200)]
# 前まわりを閉じる面。参考の前端は「幅のある面」で、舳先のようには尖っていない。
# 稜線を中心(x=0)へ収束させると、正面から見て真ん中に深い谷ができ、
# 側面から見ると低いくさびになる。実際にそうなった。
# そこで稜線はコーナーで終わらせ、そこから中心へ向かってこの面で閉じる。
# push は各稜線の端が中心線でどれだけ前に出るか[m]。
# 中心での傾きが0になる形で寄せるので、鏡像の合わせ目に折れは出ない。
# 参考のノーズ先端は z=0.60 より上には無い。belt まで前へ出すと
# 側面図で先端が 20cm 背高くなる
NOSE_PUSH = dict(crown=0.000, rail=-0.070, belt=-0.055, crease=-0.108,
                 bumper=-0.125, lip=-0.100, waist=-0.115, rocker=-0.060,
                 under=0.000)
# 前後面の抜き。位置は「稜線の名前 + 行のずれ」で書く。断面は帯の端の行を
# 並べたものなので、帯の行数を変えると通し番号がずれる。名前で引けばずれない。
# v は中心への寄り(0=コーナー, 1=中心線)、最後は面からの落とし込み[m]。
# ここも「面を張らない区間」なので、縁は最初からエッジになる
# 参考の前まわりは3要素しかない。細いランプ帯が横一文字に走り、その下に
# 大きな下部グリル、両端に縦のコーナーインテーク。ここに浅い抜きを
# 7つ重ねていたため、端が互いを削り合って崩れた帯の集まりになっていた
NOSE_HOLES = [
    ('nshut',   ('belt', 0),   ('belt', 1),    0.00, 1.00, 0.010),
    ('lamp',    ('belt', 2),   ('crease', -3), 0.00, 1.00, 0.020),
    ('grille',  ('waist', -3), ('rocker', 0),  0.30, 1.00, 0.032),
    ('curtain', ('waist', 1),  ('bumper', 4),  0.00, 0.15, 0.030),
]
# 後端も同じ考え方で閉じる。ハッチバックのテールゲートは幅のある
# ほぼ垂直な面で、点に収束しない
TAIL_PUSH = dict(crown=0.000, rail=0.030, belt=0.030, crease=0.006,
                 bumper=0.070, lip=0.040, waist=0.010, rocker=0.005,
                 under=-0.020)
TAIL_HOLES = [
    # テールゲートとバンパーの見切り。行1本ぶんの細い溝
    ('tshut',   ('belt', 0),  ('belt', 1),    0.00, 1.00, 0.010),
    ('bshut',   ('waist', 0), ('waist', 1),   0.00, 1.00, 0.008),
    ('tlamp',   ('belt', 2),  ('crease', -2), 0.00, 0.72, 0.018),
    ('tlampin', ('belt', 3),  ('belt', 6),    0.06, 0.62, 0.038),
    ('tbar',    ('belt', 3),  ('belt', 4),    0.74, 1.00, 0.012),
    ('tlow',    ('crease', -1), ('crease', 0), 0.00, 0.95, 0.014),
    ('tstep',   ('crease', 0), ('crease', 1),  0.07, 1.00, 0.010),
    ('plate',   ('crease', 1), ('crease', 5),  0.78, 1.00, 0.026),
    ('rvent',   ('waist', 2), ('bumper', 3),  0.42, 1.00, 0.022),
    ('rcut',    ('waist', 4), ('bumper', 1),  0.08, 0.28, 0.016),
]
# 前後面を上から見たときの角ばり具合。2で楕円、大きいほど角が立つ
# 上から見た角ばり具合。バンパーの高さでは丸く、見切りより上では角ばる
# 稜線の側で平面形の絞りを持たせたので、この指数が効くのは最後の 12cm
# だけになった。参考のノーズ先端は y=-2.14 でまだ半幅0.337 ある
SQUARE = dict(nose=3.8, tail=2.5)
SQUARE_LOW = dict(nose=2.1, tail=2.2)
# バンパー下端が中心へ向かって持ち上がる量[m]
LIFT = dict(nose=0.005, tail=0.034)
# 見切りの高さで、中央がわずかに下がる量[m]
DIP = dict(nose=0.018, tail=0.010)


def _hole_s(spec):
    """('稜線名', 行のずれ) を、帯の端を並べた断面上の位置(0..1)に直す。"""
    idx, cum = {BODY_BANDS[0][1]: 0}, 0
    for tag, aa, bb, nv, _ in BODY_BANDS:
        cum += nv
        idx[bb] = cum
    return (idx[spec[0]] + spec[1]) / cum


def _fill_push(src):
    """中間に作った稜線(hood/bumper/lip)の押し出し量を埋める。"""
    p = dict(src)
    p.setdefault('hood', (p['crown'] + p['rail']) * 0.5)
    p.setdefault('bumper', (p['waist'] + p['rocker']) * 0.5)
    p.setdefault('lip', (p['bumper'] + p['rocker']) * 0.5)
    return p


# 車体の最大半幅[m](ミラーを除く)。フェンダーを張り出した後、
# ここに合わせて全体を正規化する。参考の車体幅は1.820m
HALF_WIDTH = 0.910
ENDS = {'nose': _fill_push(NOSE_PUSH), 'tail': _fill_push(TAIL_PUSH)}


def _catmull(P, n):
    """制御点を通る滑らかな曲線を、y で等分した n 点で返す。Catmull-Rom。

    参考モデルをサンプリングするのではなく、手で置いた制御点を通す。

    y で等分することが要。以前はパラメータで等分していたが、稜線ごとに
    制御点の数が違う(クラウン18点/ウエスト24点)ため、同じ列番号でも
    稜線ごとに別の y に来て、帯が長手方向にせん断していた。列番号で
    位置を指定する窓や見切り線がそのぶん斜めになり、上から見ると
    参考には無い「く」の字の溝が何本も並んだ。
    """
    P = np.asarray(P, dtype=np.float64)
    m = len(P)
    ext = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    dense = max(n * 8, 2000)
    u = np.linspace(0.0, m - 1, dense)
    seg = np.clip(u.astype(np.int64), 0, m - 2)
    t = (u - seg)[:, None]
    p0, p1, p2, p3 = ext[seg], ext[seg + 1], ext[seg + 2], ext[seg + 3]
    t2, t3 = t * t, t * t * t
    C = 0.5 * ((2 * p1) + (-p0 + p2) * t
               + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
               + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    # y は単調。この曲線を y 一定間隔で読み直す
    yy = np.maximum.accumulate(C[:, 0])
    grid = np.linspace(P[0, 0], P[-1, 0], n)
    out = np.empty((n, 3), dtype=np.float64)
    out[:, 0] = grid
    for k in (1, 2):
        out[:, k] = np.interp(grid, yy, C[:, k])
    return out


def _apply_arches(curves):
    """ロッカーと床下の線をホイールアーチに沿わせ、フェンダーを張り出す。

    穴を開けるのではなく、車体の下端の線そのものをアーチの円弧に
    持ち上げる。開口の縁は最初からこの線=エッジになる。
    車軸の前後では車体を外へ張り出させる。張り出しが足りないと
    タイヤが車体からはみ出して見える。
    """
    a = ARCH
    for name, amp in (('belt', 0.35), ('crease', 0.78), ('waist', 1.00),
                      ('rocker', 1.00)):
        C = curves[name]
        y, x = C[:, 0], C[:, 1]
        for yc, mul in ((a['y_front'], 1.0), (a['y_rear'], a['flare_rear'])):
            t = np.clip(1.0 - np.abs(y - yc) / a['flare_span'], 0.0, 1.0)
            x += a['flare'] * amp * mul * (t * t * (3.0 - 2.0 * t))
    for name, inset in (('rocker', 0.0), ('under', a['lip'])):
        C = curves[name]
        y, x, z = C[:, 0], C[:, 1], C[:, 2]
        for yc in (a['y_front'], a['y_rear']):
            d = np.abs(y - yc)
            m = d < a['radius']
            if not m.any():
                continue
            arc = a['z_axle'] + np.sqrt(
                np.maximum(a['radius'] ** 2 - d[m] ** 2, 0.0))
            z[m] = np.maximum(z[m], arc)
            t = np.clip((arc - a['z_axle']) / a['radius'], 0.0, 1.0)
            x[m] = x[m] - inset * t
            # アーチの縁は外へ立てる。丸いままだとフェンダーが柔らかく、
            # 参考のような彫りの深いアーチにならない
            if name == 'rocker':
                x[m] = x[m] + a['lip_out'] * t
    # アーチに乗ったロッカーより上に、順に押し上げる
    zr = curves['rocker'][:, 2]
    for name, gap in FENDER_RISE:
        C = curves[name]
        C[:, 2] = np.maximum(C[:, 2], zr + gap)
    return curves


def _hood_crease(curves, y0=-2.00, y1=-0.86, rise=0.006):
    """ボンネットの折れを作るための稜線。

    crown と rail の中間に置き、ボンネットの区間だけ外へ持ち上げる。
    ここで帯が割れるので、参考のボンネットにある長手の稜線になる。
    区間の外では中間そのままなので、屋根には折れが出ない。

    行方向に細い溝を入れる方式では作れない。帯の行数が数本しかなく、
    行1本ぶん(帯の1/6)の太い帯になってしまうため。
    """
    A, B = curves['crown'], curves['rail']
    C = (A + B) * 0.5
    y = C[:, 0]
    t = np.clip((y - y0) / (y1 - y0), 0.0, 1.0)
    bump = np.where((y >= y0) & (y <= y1),
                    np.sin(np.pi * t) ** 0.7, 0.0)
    C[:, 2] += rise * bump
    return C


def _bumper_line(curves, front=(-2.150, -1.860), rear=(1.900, 2.150),
                 out=0.020, a='waist', b='rocker'):
    """前後バンパーの段を作るための稜線。

    waist と rocker の中間に置き、バンパーの区間だけ外へ張り出す。
    ここで帯が割れるので、参考のバンパーにある上下を分ける段になる。
    区間の外では中間そのままなので、ドア面に余計な折れは出ない。
    """
    A, B = curves[a], curves[b]
    C = (A + B) * 0.5
    y = C[:, 0]
    bmp = np.zeros(len(y))
    for y0, y1 in (front, rear):
        t = np.clip((y - y0) / (y1 - y0), 0.0, 1.0)
        m = (y >= min(y0, y1)) & (y <= max(y0, y1))
        bmp[m] = np.maximum(bmp[m], np.sin(np.pi * t[m]) ** 0.6)
    C[:, 1] += out * bmp
    return C


def _sharpen(curves, name='crease', out=0.016, y0=-1.55, y1=1.75, fade=0.35,
             axis=1):
    """キャラクターラインを稜として立てる。

    帯の境界はエッジになっているが、隣り合う帯の法線が近いと、
    見た目には「幅の広い緩い尾根」にしか見えない。線そのものを外へ
    出して、上下の面に角度差を付ける。

    区間の外へはなだらかに戻す。急に戻すとそこが折れになる。
    """
    C = curves[name]
    y = C[:, 0]
    t = np.clip((y - y0) / fade, 0.0, 1.0) * np.clip((y1 - y) / fade, 0.0, 1.0)
    C[:, axis] += out * (t * t * (3.0 - 2.0 * t))
    return curves


def _unused_blunt_ends(curves, span=0.13, power=4.0, front=False):
    """【未使用】前後端を、先端近くまで幅を保ってから急に閉じる形にする。

    幅を残しても、最後は中心へ収束させる以上どうしても舳先になる。
    正面から見ると中央に谷ができ、側面から見ると低いくさびになった。
    今は稜線をコーナーで終わらせ、_end_cap の面で閉じている。

    端へ向かって素直に細らせると舳先のように尖り、正面から見て
    下部に鋭いV字の折れが出る。実車のバンパーは幅のある面なので、
    最後の数cmで閉じる。
    """
    for name, C in curves.items():
        if name == 'crown':
            continue
        y, x = C[:, 0], C[:, 1]
        y0, y1 = y.min(), y.max()
        ends = ((y0, 1.0), (y1, -1.0)) if front else ((y1, -1.0),)
        for edge, sgn in ends:
            m = np.abs(y - edge) < span
            if not m.any():
                continue
            u = 1.0 - np.abs(y[m] - edge) / span      # 端で1
            ref = float(x[m][np.argmin(u)])            # span の内側端の幅
            x[m] = ref * (1.0 - u ** power)
    return curves


# 窓や灯火の隅を丸めたいが、面の張る/張らないで作る以上、丸みは帯の
# 行と y の刻みの階段になる。実際に 4.0 にすると窓の隅がギザギザになった。
# 曲がった縁が要るなら、面の選び方ではなくメッシュをその曲線で切るしかない。
# ここは角のままにしておく。
ROUND_N = 0.0
SQUARE_KEYS = ('shut_',)   # 溝は角のまま


def _round_n(name):
    return 0.0 if any(k in name for k in SQUARE_KEYS) else ROUND_N



def _in_zone(z, ym, rm, xf):
    """区画の内側か。7要素目があれば、隅を丸めた超楕円で判定する。

    矩形で切ると窓や灯火の隅が直角になり、参考のような大きな R が
    出ない。縁は面の境界のままなので、エッジであることは変わらない。
    """
    a, b, c, d, e, f = z[:6]
    if not (e <= xf <= f):
        return False
    n = z[6] if len(z) > 6 else 0.0
    if n <= 0.0:
        return a <= ym <= b and c <= rm <= d
    if b - a < 1e-9 or d - c < 1e-9:
        return a <= ym <= b and c <= rm <= d
    u = (2.0 * ym - (a + b)) / (b - a)
    v = (2.0 * rm - (c + d)) / (d - c)
    return abs(u) ** n + abs(v) ** n <= 1.0


def _band_object(name, rows, skip=None, keep=None, inset=0.0):
    """帯の格子から面を張る。

    skip: この y 区間には面を張らない(窓の抜き)
    keep: この y 区間だけ面を張る(窓そのもの)
    inset: 内側へ落とし込む量。ガラスをボディ面より一段下げる

    面を消して穴を開けるのではなく、張る区間を選ぶ。窓のふちは
    最初からこの面の境界になるので、階段にならない。
    """
    ny = len(rows[0])
    ys = rows[0][:, 0]
    V = []
    for row in rows:
        for y, x, z in row:
            V.append([x, y, z])
    V = np.array(V, dtype=np.float64)
    if inset:
        # 幅と高さを内側へ寄せる。ガラスは車体面より一段奥まっている
        sgn = np.sign(V[:, 0])
        sgn[sgn == 0] = 1.0
        V[:, 0] -= sgn * inset * np.minimum(np.abs(V[:, 0]) / 0.25, 1.0)
        V[:, 2] -= inset * 0.35
    nr = len(rows)
    # 列ごとの最大半幅。横方向の範囲はこれに対する比で指定する
    xmax = np.maximum(np.abs(np.array([r[:, 1] for r in rows])).max(axis=0),
                      1e-6)
    faces = []
    for i in range(nr - 1):
        rm = (i + 0.5) / (nr - 1)
        for j in range(ny - 1):
            ym = 0.5 * (ys[j] + ys[j + 1])
            xf = abs(0.5 * (rows[i][j, 1] + rows[i][j + 1, 1])) \
                / (0.5 * (xmax[j] + xmax[j + 1]))
            if keep is not None and not _in_zone(keep, ym, rm, xf):
                continue
            if skip and any(_in_zone(z, ym, rm, xf) for z in skip):
                continue
            a0 = i * ny + j
            faces.append((a0, a0 + 1, a0 + ny + 1, a0 + ny))
    ob = _mesh_object(name, [tuple(v) for v in V], faces)
    _select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    mir = ob.modifiers.new('mir', 'MIRROR')
    mir.use_axis = (True, False, False)
    mir.use_mirror_merge = True
    _select_only(ob)
    bpy.ops.object.modifier_apply(modifier=mir.name)
    for pl in ob.data.polygons:
        pl.use_smooth = True
    return ob


def _arc_even(e, n, w, h, dense=512):
    """超楕円を弧長で等分する角度列を返す。

    角度で等分すると、角ばった超楕円では中心寄りで幅が一気に詰まり、
    そこだけ大きな面になる(後面の隅に面が立った原因)。弧長で割ると
    行が均等に並ぶ。
    """
    t = np.linspace(0.0, math.pi * 0.5, dense)
    x = w * np.cos(t) ** e
    y = max(h, 1e-4) * np.sin(t) ** e
    d = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    if d[-1] < 1e-9:
        return list(np.linspace(0.0, math.pi * 0.5, n + 1))
    return list(np.interp(np.linspace(0.0, d[-1], n + 1), d, t))


def _end_cap(name, sec, pv, tag='nose', nv=24):
    """前後を面で閉じる。

    帯はコーナーで終わっている。sec はその端の断面そのもの(帯の端の
    行を順に拾ったもの)で、pv は各点を中心線でどれだけ前後へ出すか。
    境界が帯の端と同一の点列なので、継ぎ目に隙間もずれも出ない。

    稜線の端(10点)だけで組むと断面が粗く、後面が板のようになって
    へりに面が立った。帯の端を全部拾うと50点近くになり、これが消える。
    """
    holes_def = NOSE_HOLES if tag == 'nose' else TAIL_HOLES
    sec, pv = np.array(sec, dtype=np.float64), np.array(pv, dtype=np.float64)
    ns = len(sec)

    def rows_at(depth=0.0):
        # 上から見た輪郭を超楕円にする。幅を直線的に落とすと、コーナーで
        # 側面の帯と接線が合わずに角が立ち、面全体も一枚の板になる。
        # 超楕円なら v=0 で接線が長手方向、v=1 で横方向になるので、
        # 側面ともつながり、鏡像の合わせ目にも折れが出ない。
        # e が大きいほど角ばる(テールゲートは角ばり、ノーズは丸い)
        # バンパーの下端は中心へ向かって持ち上がる。z を動かさないと
        # 正面・背面から見て地面と平行な直線になり、板に見える
        w = np.clip((np.arange(ns) - _hole_s(('bumper', 0)) * (ns - 1))
                    / max((ns - 1) * (1.0 - _hole_s(('bumper', 0))), 1e-6),
                    0.0, 1.0)
        wb = np.clip((np.arange(ns) / max(ns - 1, 1)
                      - _hole_s(('crease', 0)))
                     / max(1.0 - _hole_s(('crease', 0)), 1e-6), 0.0, 1.0)
        # ボンネット/テールゲートの先端は、中央がわずかに下がる
        wd0 = 0.5 * (_hole_s(('belt', 0)) + _hole_s(('crease', 0)))
        wd = np.exp(-(((np.arange(ns) / max(ns - 1, 1))
                       - wd0) / 0.095) ** 2)
        # 断面の下側(バンパー)ほど丸く。一律だと隅が角張って見える
        ee = 2.0 / (SQUARE[tag] + (SQUARE_LOW[tag] - SQUARE[tag]) * wb)
        rows = []
        for th in _arc_even(2.0 / SQUARE[tag], nv,
                            float(np.abs(sec[:, 1]).max()),
                            float(np.abs(pv).max())):
            P = sec.copy()
            sn, cs = math.sin(th) ** ee, math.cos(th) ** ee
            P[:, 0] = sec[:, 0] + pv * sn + depth
            P[:, 1] = sec[:, 1] * cs
            P[:, 2] = (sec[:, 2] + LIFT[tag] * w * sn
                       - DIP[tag] * wd * sn)
            rows.append(P)
        return rows

    def build(nm, rows, keep=None, skip=()):
        V = [(x, y, z) for row in rows for y, x, z in row]
        faces = []
        for j in range(nv):
            vm = (j + 0.5) / nv
            for i in range(ns - 1):
                sm = (i + 0.5) / (ns - 1)
                if keep is not None:
                    a, b, c, d = keep
                    if not (a <= sm <= b and c <= vm <= d):
                        continue
                # keep のときも skip は効かせる。入れ子の抜き(ランプの
                # 内側など)が親の面と重なって、面が二重になるのを防ぐ
                if any(a <= sm <= b and c <= vm <= d
                       for a, b, c, d in skip):
                    continue
                a0 = j * ns + i
                q = (a0, a0 + 1, a0 + ns + 1, a0 + ns)
                faces.append(q if tag == 'nose' else q[::-1])
        ob = _mesh_object(nm, V, faces)
        _select_only(ob)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True,
                                  use_faces=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        mir = ob.modifiers.new('mir', 'MIRROR')
        mir.use_axis = (True, False, False)
        mir.use_mirror_merge = True
        _select_only(ob)
        bpy.ops.object.modifier_apply(modifier=mir.name)
        for pl in ob.data.polygons:
            pl.use_smooth = True
        return ob

    hs = [(h[0], _hole_s(h[1]), _hole_s(h[2]), h[3], h[4], h[5])
          for h in holes_def]
    holes = [(h[1], h[2], h[3], h[4]) for h in hs]
    sgn = 1.0 if tag == 'nose' else -1.0
    made = [build(f'{name}_{tag}', rows_at(), skip=holes)]
    for nm, s0, s1, v0, v1, depth in hs:
        # 自分より深い抜きは、この面からも外す
        inner = [(h[1], h[2], h[3], h[4]) for h in hs
                 if h[5] > depth and h[1] >= s0 and h[2] <= s1]
        made.append(build(f'{name}_{tag}_{nm}', rows_at(sgn * depth),
                          keep=(s0, s1, v0, v1), skip=inner))
    return made


def build_body(name='bd', n_y=160):
    """キャラクターラインの間を帯として張り、車体を組む。"""
    for o in list(bpy.data.objects):
        if o.name.startswith(name + '_'):
            bpy.data.objects.remove(o, do_unlink=True)
    band_rows = {}
    curves = {k: _catmull(v, n_y) for k, v in BODY_LINES.items()}
    # 中心線は厳密に x=0 に置く。わずかでもずれると鏡像の合わせ目に
    # 切れ込みが残る
    curves['crown'][:, 1] = 0.0
    curves['hood'] = _hood_crease(curves)
    curves['bumper'] = _bumper_line(curves)
    curves['lip'] = _bumper_line(curves, a='bumper', b='rocker',
                                 out=0.013)
    _sharpen(curves, y1=2.20)
    # ボンネットのフェンダー際。参考は平らな面と立った稜線で、
    # ドーム状にはなっていない
    _sharpen(curves, 'rail', out=0.0035, y0=-2.45, y1=-0.92,
             fade=0.45, axis=2)
    # サイドシルの段。参考は前後輪の間に明確な稜線がある
    _sharpen(curves, 'rocker', out=0.012, y0=-1.45, y1=1.80,
             fade=0.55)
    _apply_arches(curves)
    # フェンダーを張り出した分だけ太るので、最大半幅で正規化する
    peak = max(float(np.abs(curves[k][:, 1]).max())
               for k in ('belt', 'crease', 'waist', 'rocker'))
    if peak > 1e-6:
        k = HALF_WIDTH / peak
        for nm in ('rail', 'belt', 'crease', 'waist', 'bumper', 'lip',
                   'rocker', 'under'):
            curves[nm][:, 1] *= k
    objs = []
    ends = {'nose': [], 'tail': []}
    epush = {'nose': [], 'tail': []}
    for tag, a, b, nv, bulge in BODY_BANDS:
        A, B = curves[a], curves[b]
        # 断面内で A→B に垂直な向き。外向きになるよう符号を揃える
        dx, dz = B[:, 1] - A[:, 1], B[:, 2] - A[:, 2]
        ln = np.maximum(np.hypot(dx, dz), 1e-9)
        nx, nz = dz / ln, -dx / ln
        flip = np.where(nx < 0.0, -1.0, 1.0)
        nx, nz = nx * flip, nz * flip
        # 中心線(x=0)の近くでは膨らみを消す。ここで膨らませると鏡像の
        # 合わせ目が外へ張り出し、車体前後の中心に稜線の継ぎ目が出る
        near = np.minimum(np.abs(A[:, 1] + B[:, 1]) * 0.5 / 0.12, 1.0)
        span = BULGE_SPAN.get(tag)
        if span:
            u = np.clip((A[:, 0] - span[1]) / (span[0] - span[1]), 0.0, 1.0)
            near = near * (u * u * (3.0 - 2.0 * u))
        rows = []
        for j in range(nv + 1):
            t = j / nv
            P = (A * (1 - t) + B * t).copy()
            k = bulge * math.sin(math.pi * t) * near
            P[:, 1] += nx * k
            P[:, 2] += nz * k
            rows.append(P)
        wins = [w for w in WINDOWS + FEATURES + _shut_features()
                if w[0] == tag]
        zones = [(w[2], w[3], w[5], w[6], w[7], w[8], _round_n(w[1]))
                 for w in wins]
        objs.append(_band_object(f'{name}_{tag}', rows, skip=zones))
        for _, wname, y0, y1, inset, r0, r1, x0, x1 in wins:
            objs.append(_band_object(f'{name}_{tag}_{wname}', rows,
                                     keep=(y0, y1, r0, r1, x0, x1,
                                           _round_n(wname)),
                                     inset=inset))
        # 前後の面を閉じるための断面。帯の端の行をそのまま拾う
        for e, ei in (('nose', 0), ('tail', -1)):
            pa, pb = ENDS[e].get(a), ENDS[e].get(b)
            for j in range(1 if ends[e] else 0, nv + 1):
                ends[e].append(rows[j][ei])
                epush[e].append(pa + (pb - pa) * (j / nv))
    for e in ('nose', 'tail'):
        objs += _end_cap(name, ends[e], epush[e], e)
    objs += build_fittings(name + 'ft', curves)
    _log(f"{name}: {len(objs)}パーツ / "
         f"{sum(len(o.data.polygons) for o in objs)}面")
    return objs


def _unused_end_caps(name, curves, band_rows):
    """【未使用】前後端を別の面で閉じる方式。

    稜線の端を中心(x=0)へ収束させれば帯だけで閉じるので要らなくなった。
    別面で塞ぐと、帯の端と面の縁が中心でわずかにずれ、車体前端の下部に
    小さな膨らみが残る。

    帯は長手方向に張っているだけなので、そのままだと前後が開いたまま。
    端の断面を集めて、少し外へ出しながら中心へ絞って閉じる。
    ここも輪郭から面を張るので、縁はエッジのまま。
    """
    order = [b[1] for b in BODY_BANDS] + [BODY_BANDS[-1][2]]
    made = []
    for tag, idx, sgn in (('nose', 0, -1.0), ('tail', -1, 1.0)):
        sec = np.array([curves[k][idx] for k in order])   # (y, x, z)
        rows = []
        for t, push in ((0.0, 0.000), (0.45, 0.028), (0.78, 0.042),
                        (1.0, 0.048)):
            P = sec.copy()
            k = 1.0 - t
            # 絞るのは幅だけ。高さを縮めると中心が点に収束して、
            # 車体前端の中心に切れ込みが残る。鼻先は縦の稜線で閉じる
            P[:, 1] = P[:, 1] * (k ** 0.55)
            # 前へ出す量は断面の上下端で0、中ほどで最大にする。
            # 一律に出すと下端が唇のように飛び出して中心に切れ込みが残る
            j = np.arange(len(P)) / max(len(P) - 1, 1)
            P[:, 0] = P[:, 0] + sgn * push * np.sin(np.pi * j)
            rows.append(P)
        verts, faces = [], []
        n = len(sec)
        for P in rows:
            for y, x, z in P:
                verts.append((x, y, z))
        for i in range(len(rows) - 1):
            for j in range(n - 1):
                a = i * n + j
                faces.append((a, a + 1, a + n + 1, a + n))
        ob = _mesh_object(f'{name}_{tag}', verts, faces)
        mir = ob.modifiers.new('mir', 'MIRROR')
        mir.use_axis = (True, False, False)
        mir.use_mirror_merge = True
        _select_only(ob)
        bpy.ops.object.modifier_apply(modifier=mir.name)
        for pl in ob.data.polygons:
            pl.use_smooth = True
        made.append(ob)
    return made


def _curve_at(C, y):
    """稜線カーブ上の、指定した y での (半幅x, 高さz) を返す。"""
    i = int(np.argmin(np.abs(C[:, 0] - y)))
    return float(C[i, 1]), float(C[i, 2])


def _rounded_box(name, center, size, bevel=0.012, segments=3):
    """角を丸めた箱。ミラーの筐体やドアハンドルの土台に使う。"""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    _select_only(ob)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    b = ob.modifiers.new('bev', 'BEVEL')
    b.width = bevel
    b.segments = segments
    b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(40.0)
    bpy.ops.object.modifier_apply(modifier=b.name)
    auto_smooth(ob, 38.0)
    return ob


def _teardrop(name, center, size, ns=12, nring=24, square=3.0):
    """ドアミラーの筐体。前が細く、後ろが鏡面で終わる。

    断面を円にすると、正面から見て「棒の先の玉」になる。実際そうなった。
    断面を超楕円(角の丸い長方形)にし、後ろは絞らずに平らな面で閉じる。
    前後端は扇で塞ぐので、筒に見えることもない。
    """
    sx, sy, sz = size
    e = 2.0 / square
    verts, faces = [], []
    prof = []
    for i in range(ns + 1):
        t = i / ns
        # 前は細く、途中で開いて、後ろは鏡面の幅を保つ
        w = 0.34 + 0.66 * math.sin(math.pi * 0.5 * min(t / 0.72, 1.0))
        prof.append(w)
        yy = -sy * 0.5 + sy * t
        for j in range(nring):
            a = 2.0 * math.pi * j / nring
            c, sn = math.cos(a), math.sin(a)
            verts.append((center[0] + sx * 0.5 * w
                          * math.copysign(abs(c) ** e, c),
                          center[1] + yy,
                          center[2] + sz * 0.5 * w
                          * math.copysign(abs(sn) ** e, sn)))
    for i in range(ns):
        for j in range(nring):
            a0 = i * nring + j
            a1 = i * nring + (j + 1) % nring
            faces.append((a0, a1, a1 + nring, a0 + nring))
    # 前後の口を扇で塞ぐ
    for idx, y_end, flip in ((0, -sy * 0.5, True), (ns, sy * 0.5, False)):
        cix = len(verts)
        verts.append((center[0], center[1] + y_end, center[2]))
        for j in range(nring):
            a0 = idx * nring + j
            a1 = idx * nring + (j + 1) % nring
            faces.append((cix, a1, a0) if flip else (cix, a0, a1))
    ob = _mesh_object(name, verts, faces)
    auto_smooth(ob, 40.0)
    return ob


def build_fittings(name='ft', curves=None):
    """ミラーとドアハンドルを、車体の稜線から位置を取って置く。

    参考モデルは走査しない。自分で引いた稜線の上に、寸法どおり置く。
    """
    for o in list(bpy.data.objects):
        if o.name.startswith(name + '_'):
            bpy.data.objects.remove(o, do_unlink=True)
    made = []
    belt = curves['belt']
    waist = curves['waist']

    # ドアミラー: ベルトラインの少し上、車体の外へ張り出す
    mx, mz = _curve_at(belt, MIRROR['y'])
    sx, sy, sz = MIRROR['size']
    for sgn in (-1, 1):
        base = sgn * (mx - 0.030 + MIRROR['stalk'] * 0.5)
        st = _rounded_box(f'{name}_mstalk{"L" if sgn < 0 else "R"}',
                          (base, MIRROR['y'], MIRROR['z'] - 0.010),
                          (MIRROR['stalk'], 0.085, 0.062), bevel=0.014)
        made.append(st)
        hx = sgn * (mx - 0.030 + MIRROR['stalk'] + sx * 0.5)
        h = _teardrop(f'{name}_mirror{"L" if sgn < 0 else "R"}',
                      (hx, MIRROR['y'] - 0.020, MIRROR['z'] + 0.012),
                      (sx, sy, sz))
        made.append(h)

    # ドアハンドル: ウエストラインの上、面から少し浮かせる
    hxs, hys, hzs = HANDLE_SIZE
    for i, (hy, hz) in enumerate(HANDLES):
        wx, _ = _curve_at(waist, hy)
        for sgn in (-1, 1):
            ob = _rounded_box(
                f'{name}_handle{i}{"L" if sgn < 0 else "R"}',
                (sgn * (wx + hxs * 0.35), hy, hz), (hxs, hys, hzs),
                bevel=0.011, segments=3)
            made.append(ob)
    # グリルの横桟。開口の縁は超楕円で湾曲しているので、桟の幅を
    # 一定にすると上下の端で開口からはみ出す。高さごとに縁を引く
    sl = SLATS
    for k in range(sl['n']):
        z = sl['z0'] + (sl['z1'] - sl['z0']) * k / max(sl['n'] - 1, 1)
        # 開口の縁は上下で少し狭まる。端の桟を細めて収める
        t = abs(2.0 * k / max(sl['n'] - 1, 1) - 1.0)
        w = sl['half'] * (1.0 - 0.26 * t * t)
        ob = _rounded_box(f'{name}_slat{k}', (0.0, sl['y'], z),
                          (w * 2, sl['depth'], sl['thick']),
                          bevel=0.004, segments=2)
        made.append(ob)

    # リアスポイラー: ルーフ後端の稜線に沿って後ろへ張り出す板
    sp = SPOILER
    rail = curves['rail']
    i = int(np.argmin(np.abs(rail[:, 0] - sp['y'])))
    verts, faces = [], []
    n = 24
    for k in range(n + 1):
        u = k / n
        xx = (-sp['span'] + 2 * sp['span'] * u)
        taper = 1.0 - 0.72 * (abs(xx) / sp['span']) ** 2.5
        rx, ry, rz = rail[i, 1], rail[i, 0], rail[i, 2]
        x = xx * (rx / max(sp['span'], 1e-6)) if rx < sp['span'] else xx
        verts.append((x, ry, rz))
        verts.append((x, ry + sp['chord'] * taper,
                      rz - sp['drop'] * taper))
    for k in range(n):
        a = 2 * k
        faces.append((a, a + 2, a + 3, a + 1))
    sob = _mesh_object(f'{name}_spoiler', verts, faces)
    _select_only(sob)
    m = sob.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = sp['thick']
    m.offset = 0.0
    bpy.ops.object.modifier_apply(modifier=m.name)
    b = sob.modifiers.new('bev', 'BEVEL')
    b.width = 0.008
    b.segments = 2
    bpy.ops.object.modifier_apply(modifier=b.name)
    auto_smooth(sob, 38.0)
    made.append(sob)

    _log(f"{name}: {len(made)}個 / "
         f"{sum(len(o.data.polygons) for o in made)}面")
    return made
