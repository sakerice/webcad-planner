"""架空のコンパクトクロスオーバーを三面図から起こして GLB へ書き出す。

■ 手続き生成で車を質良く作る手順
    1. 三面図を数値で決める
       - 側面図: トップライン(ノーズ→ボンネット→フロントガラス→ルーフ→
                 テールゲート→リヤバンパー)と、ベルトライン(ショルダー)
       - 平面図: 半幅の変化(ノーズで絞り、キャビンで最大、テールで絞る)
       - 断面図: ロッカー→ショルダー→タンブルホーム→ルーフの断面形
    2. 各ステーション(長手方向の断面位置)で上の3つを引き、閉じたリングを作る
    3. リングを順に橋渡しして **1枚の連続面** にする
    4. キャラクターライン(ショルダー)には支持ループを寄せる

■ マテリアルの振り方 — ここが2度失敗した所
  1度目: ガラスを別メッシュで重ねた → 継ぎ目に段差が出て白い板が貫入した
  2度目: サブディビジョン後の面を **絶対座標の箱** で判定して振った
         → 境界が面の格子を斜めに横切り、ヘッドランプの縁が階段状にギザついた。
           さらに箱どうしが重なり、テールランプの赤がサイドガラスに乗った

  正しいのは3番目のやり方:
    **サブディビジョンをかける前の元の面に、格子の番号(ステーション i, リング j)
      で振る。** 面の境界が格子線そのものになるので、原理的にギザつかない。
      サブディビジョンは各面を4分割するだけでマテリアルを引き継ぐため、
      分割後も境界は元の格子線の上に乗ったまま滑らかな曲線になる。

  この方式には前提が要る: **意匠の境目は必ずステーション線として置くこと**。
  ピラーの前後端・ガラスの端・ランプの端の y をステーション表に入れておかないと、
  一番近いステーションに丸められて意匠がずれる。FEATURES の y はすべて
  STATION_Y に同じ値が入っている(検証は _check_feature_stations)。

■ 諸元(実在車種ではない。日本のコンパクトクロスオーバーの標準的な寸法)
  全長 4400 / 全幅(ボディ) 1800 / ドアミラー含む 1960 / 全高 1630
  ホイールベース 2660 / 前OH 900 / 後OH 840
  タイヤ 225/60R18 (直径727mm) / 最低地上高 190

■ 座標
  X=幅(±) Y=長さ(前が+) Z=高さ。原点は接地面の中心。
  glTF へは export_yup=True で書き出す。

■ 三面図の数値をどう決めたか(案を並べて比べた結果)
  codex に性格の違う三面図を3案引かせ、全部このスクリプトで組んでレンダし、
  自作の現行案と並べて比べた。分かったことは2つ。

  1. **三面図を入れ替えても、印象はほとんど変わらなかった。**
     「ルーフが別の箱に載って見える」「リヤ四半部が白い塊になる」は4案とも
     同じで、原因は断面(ring_points)と意匠の境目の方にあった。
     つまりボトルネックは三面図ではなかった
  2. ただしプロポーション自体は案C(ボンネット1150 / キャビン2890 /
     Aピラー60度)が最も現代的だった。自作案はボンネット1220・キャビン2830で、
     4案中いちばん間延びして見えた

  採用したのは 案C + 比較で見つかった修正:
  - Cピラーを 920mm → 480mm に短縮(リヤ四半部の白い塊の正体はこれ)
  - ショルダーからルーフ幅への絞りを1段から3段に分けた(ring_points)

  この比較は再現できる。案の数値表を JSON にして環境変数で差し替えられる:
    CAR_TABLES=<json> CAR_OUT=<glb> Blender --background ... car2_build.py

■ 実行
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/blender/car2_build.py
"""

import math
import os

import bpy
import bmesh
from mathutils import Vector, Matrix

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                   'assets', 'models', 'context', 'car_crossover.glb')

# 三面図の表を外から差し替えられるようにしておく。案を並べて比べるための口で、
# 通常はこのファイル内の既定値を使う。
#   CAR_TABLES=<json>  … TOP_LINE / BELT_LINE / PLAN_HW / PLAN_HW_ROOF /
#                        ROCKER_Z / STATION_Y を上書き
#   CAR_OUT=<glb>      … 書き出し先
_TABLES = {}
if os.environ.get('CAR_TABLES'):
    import json as _json
    with open(os.environ['CAR_TABLES'], encoding='utf-8') as _f:
        _TABLES = _json.load(_f)
    print('[car2] 三面図を %s から読み込み (%s)'
          % (os.path.basename(os.environ['CAR_TABLES']),
             _TABLES.get('name', '?')))
if os.environ.get('CAR_OUT'):
    OUT = os.environ['CAR_OUT']

L, W, H = 4.40, 1.80, 1.62
HW = W / 2
# ★ 書き出す GLB のバウンディングボックスは、カタログの car(w×d×h) と
#   **一致していなければならない**。アプリの makeGltfBoxFitClone は3軸を
#   独立に伸縮するため、比が違うとその軸だけ潰れる(幅だけ8%細い車になる)。
#   ドアミラーは全幅に含まれないが、bbox には含まれてしまう。そこで
#   ボディを 1690 に絞り、ミラー先端でちょうど 1800 に届くよう設計する。
BODY_W = 1.690
HWS = BODY_W / W                 # 平面図の半幅表(1800基準)に掛ける係数
MIRROR_X = HW                    # ミラー最外(=全幅)
ROOF_TOP = H                     # ルーフレール上端(=全高)
# 参考図(2枚目のハッチバック)に合わせる。前後OH730 /
# ホイールベース2940(全長の67%)。旧値は前900/後840・WB2660(60%)で、
# 鼻先と尻が余り、白い塊に見えていた
AXLE_F, AXLE_R = 1.470, -1.470
TIRE_R, TIRE_W = 0.3636, 0.225
ARCH_R = TIRE_R + 0.028      # タイヤとアーチの隙間。空けすぎると小径に見える


# ── 三面図 ────────────────────────────────────────────────────
# 採用: 案C(codex)のプロポーション + Cピラー短縮。経緯は冒頭の説明を参照。
# 表を触るときは _check_tables() の条件を必ず読むこと。
# 側面図: トップライン。y(長さ) → z(高さ)
# テールは立ち上げる。y=-2.20 の天端が低いと(旧値 0.870)リヤが丸く削げ、
# テールランプを貼る面が残らない
TOP_LINE = [
    (-2.200, 1.020), (-2.140, 1.075), (-2.060, 1.125), (-1.940, 1.160),
    (-1.840, 1.180), (-1.680, 1.250), (-1.500, 1.370), (-1.300, 1.500),
    (-1.080, 1.575), (-0.750, 1.601), (-0.350, 1.616), (0.150, 1.620),
    (0.350, 1.575), (0.550, 1.490), (0.820, 1.320), (1.050, 1.160),
    (1.300, 1.035), (1.500, 0.995), (1.820, 0.950), (2.020, 0.915),
    (2.100, 0.815), (2.160, 0.765), (2.200, 0.725),
]
TOP_LINE = [tuple(v) for v in _TABLES['TOP_LINE']] if 'TOP_LINE' in _TABLES else TOP_LINE
# 側面図: ベルトライン(ショルダー)。y → z
BELT_LINE = [
    (-2.200, 0.965), (-2.080, 1.010), (-1.900, 1.045), (-1.680, 1.005),
    (-1.360, 1.010), (-1.080, 0.995), (-0.650, 0.975), (0.000, 0.955),
    (0.550, 0.935), (1.050, 0.905), (1.500, 0.925), (1.820, 0.890),
    # 鼻先はベルトを天端より下げておくこと。上回ると断面が自己交差する
    (2.080, 0.740), (2.160, 0.690), (2.200, 0.650),
]
BELT_LINE = [tuple(v) for v in _TABLES['BELT_LINE']] if 'BELT_LINE' in _TABLES else BELT_LINE
# 平面図: ショルダーでの半幅。y → x。前後端の 60〜120mm で一気に絞らないと、
# 鼻先が幅1.6mの平板になり「バンに顔を描いた」ような形になる
PLAN_HW = [
    (-2.200, 0.585), (-2.180, 0.660), (-2.140, 0.735), (-2.090, 0.795),
    (-1.980, 0.835), (-1.720, 0.872), (-1.360, 0.893), (-0.750, 0.900),
    (0.000, 0.898), (0.720, 0.892), (1.300, 0.879), (1.720, 0.855),
    (1.980, 0.825), (2.090, 0.785), (2.140, 0.725), (2.180, 0.650),
    (2.200, 0.585),
]
PLAN_HW = [tuple(v) for v in _TABLES['PLAN_HW']] if 'PLAN_HW' in _TABLES else PLAN_HW
# 平面図: ルーフ(前ではボンネット、後ろではデッキ)での半幅。y → x
PLAN_HW_ROOF = [
    (-2.200, 0.445), (-2.180, 0.510), (-2.140, 0.575), (-2.090, 0.620),
    (-1.940, 0.685), (-1.680, 0.705), (-1.420, 0.760), (-1.180, 0.782),
    (-0.750, 0.796), (-0.200, 0.802), (0.350, 0.807), (0.820, 0.827),
    (1.050, 0.852), (1.300, 0.860), (1.720, 0.770), (1.980, 0.720),
    (2.090, 0.660), (2.140, 0.590), (2.180, 0.515), (2.200, 0.445),
]
PLAN_HW_ROOF = [tuple(v) for v in _TABLES['PLAN_HW_ROOF']] if 'PLAN_HW_ROOF' in _TABLES else PLAN_HW_ROOF
# 側面図: ロッカー(サイドシル)下端。前後で持ち上げて進入角/離脱角を作る
ROCKER_Z = [
    (-2.200, 0.360), (-2.090, 0.305), (-1.940, 0.245), (-1.700, 0.205),
    (-1.360, 0.195), (-0.900, 0.190), (0.900, 0.190), (1.300, 0.195),
    (1.700, 0.205), (1.940, 0.235), (2.090, 0.275), (2.200, 0.305),
]
ROCKER_Z = [tuple(v) for v in _TABLES['ROCKER_Z']] if 'ROCKER_Z' in _TABLES else ROCKER_Z

# ステーション(長手方向の断面位置)。降順。FEATURES の y はすべてここに在る
STATION_Y = [
    2.200, 2.160, 2.090, 2.020, 1.900, 1.720, 1.500, 1.300,
    1.120, 1.050, 0.940, 0.820, 0.680, 0.500, 0.350, 0.220,
    0.100, 0.000, -0.050, -0.200, -0.400, -0.620, -0.820, -1.020,
    -1.180, -1.280, -1.300, -1.360, -1.420, -1.500, -1.580, -1.640,
    -1.720, -1.800, -1.840, -1.900, -1.940, -2.020, -2.090, -2.140,
    -2.180, -2.200,
]
STATION_Y = [float(v) for v in _TABLES['STATION_Y']] if 'STATION_Y' in _TABLES else STATION_Y

# リング(断面)の点の意味。ring_points() の戻り値の添字と対応する
#   0..3   床下〜ロッカー外面      4..5  下部ボディ側面
#   6..8   ショルダー(支持ループ)  9..11 DLO(ガラスが張れる帯)
#   12..14 ルーフ                  15    ルーフ中心
RING_N = 16
FULL_N = RING_N * 2 - 2                     # 左右合わせた1リングの点数 = 30


def mirror_ring(j):
    """右半分の面番号 j に対応する左半分の面番号。"""
    return FULL_N - 1 - j


def rings(*idx):
    s = set(idx)
    return s | {mirror_ring(j) for j in idx}


# 意匠の帯。(名前, マテリアル番号, yの範囲, リング番号の集合)。後のものが勝つ。
# y は面の行の中点で判定する。境目は必ず STATION_Y に在ること。
MAT_BODY, MAT_GLASS, MAT_CLAD, MAT_HEAD, MAT_TAIL, MAT_GRILLE, MAT_DRL, MAT_PILLAR = range(8)
#
# ランプは帯では表せない。帯はリング番号(=断面上の高さ位置)で決まるので、
# 車の**側面**にしか置けない。ヘッドランプが要るのは正面を向いた面であり、
# ノーズが絞られている以上そこは前後の蓋にしかない。帯で振ると側面に細長い
# 光る筋が出るだけで、正面から見ると消える(実際そうなった)。
# → ランプは build_lamp() で車体の輪郭をなぞる別形状として作る。
# 意匠の境目(ガラスの前後端・バンパーの見切り)は三面図と一緒に動くので、
# 表を差し替えるときは GREENHOUSE も一緒に差し替える
GH = _TABLES.get('GREENHOUSE', {
    'front_lower': 2.090,
    'rear_lower': -2.090,
    'glass_side_f': [0.100, 0.820],
    'glass_side_r': [-1.720, -0.050],
    'windscreen': [0.350, 1.050],
    'backlight': [-1.900, -1.500],
})
FEATURES = [
    ('clad',        MAT_CLAD,   (-9.0, 9.0),        rings(0, 1, 2, 3)),
    # キャビン全長の DLO 帯を先に黒(ピラー)で塗り、あとからガラスを重ねる。
    # A/B/C ピラーが自動的に黒く残り、窓まわりが1本の帯になる
    ('dlo_surround', MAT_PILLAR, (GH['glass_side_r'][0], GH['glass_side_f'][1]),
     rings(9, 10, 11)),
    ('front_lower', MAT_GRILLE, (GH['front_lower'], 2.210),
     rings(0, 1, 2, 3, 4)),
    ('rear_lower',  MAT_CLAD,   (-2.210, GH['rear_lower']),
     rings(0, 1, 2, 3, 4, 5)),
    ('glass_side_f', MAT_GLASS, tuple(GH['glass_side_f']), rings(9, 10, 11)),
    ('glass_side_r', MAT_GLASS, tuple(GH['glass_side_r']), rings(9, 10, 11)),
    ('windscreen',  MAT_GLASS,  tuple(GH['windscreen']), rings(12, 13, 14, 15)),
    ('backlight',   MAT_GLASS,  tuple(GH['backlight']), rings(12, 13, 14, 15)),
]
CAP_Y = {1: 2.205, -1: -2.205}      # 前後の蓋(ファン)を判定に載せるための代表 y


def _check_feature_stations():
    """意匠の境目がステーション線に乗っているか。乗っていなければ形がずれる。"""
    have = set(round(v, 4) for v in STATION_Y)
    for name, _m, (lo, hi), _r in FEATURES:
        for v in (lo, hi):
            if abs(v) > 2.2:            # 蓋まで含める意図の値は範囲外でよい
                continue
            if round(v, 4) not in have:
                raise SystemExit(
                    '[car2] %s の境目 y=%.3f がステーション表に無い' % (name, v))


def _check_tables():
    """三面図の表が、断面を壊さない条件を満たしているか。

    ロフトは表をそのまま信じて断面を組むので、表が矛盾していると形が壊れる。
    しかも壊れ方が「シェーディングが変」程度で、原因が表にあると気付きにくい。
    案を差し替えて比べるなら、ここで落とせないと比較にならない。
    """
    errs = []
    for name, tbl in (('TOP_LINE', TOP_LINE), ('BELT_LINE', BELT_LINE),
                      ('PLAN_HW', PLAN_HW), ('PLAN_HW_ROOF', PLAN_HW_ROOF),
                      ('ROCKER_Z', ROCKER_Z)):
        ys = [p[0] for p in tbl]
        if ys != sorted(ys) or len(set(ys)) != len(ys):
            errs.append('%s: y が昇順の一意でない' % name)
        if abs(ys[0] + 2.200) > 1e-6 or abs(ys[-1] - 2.200) > 1e-6:
            errs.append('%s: 端が ±2.200 でない (%.3f..%.3f)'
                        % (name, ys[0], ys[-1]))
    # 断面が潰れる/上下が入れ替わる条件を、全ステーションで見る。
    # 「肩から天端まで50mm以上」を要求してよいのはキャビンの範囲だけ。
    # ボンネットとデッキの上面はベルトラインのすぐ上に来るのが正しい形なので、
    # 全域に課すと正しい三面図まで落ちる。外では上下の逆転だけを見る。
    # 「肩と天端の間」が実際に帯として要るのはサイドガラスを張る範囲だけ。
    # フロントガラスの根元(カウル)は肩と天端がほぼ一致するのが正しい
    cab_r = GH['glass_side_r'][0]
    cab_f = GH['glass_side_f'][1]
    for y in STATION_Y:
        zt, zb = lerp_table(TOP_LINE, y), lerp_table(BELT_LINE, y)
        z0 = lerp_table(ROCKER_Z, y)
        need = 0.050 if cab_r <= y <= cab_f else 0.0
        if zt - zb < need - 1e-6:
            errs.append('y=%.3f: TOP-BELT が %.3f (キャビン内は0.050以上。'
                        '断面が潰れる)' % (y, zt - zb))
        if zb - z0 < 0.300 - 1e-6:
            errs.append('y=%.3f: BELT-ROCKER が %.3f (0.300未満)' % (y, zb - z0))
        if lerp_table(PLAN_HW_ROOF, y) > lerp_table(PLAN_HW, y):
            errs.append('y=%.3f: ルーフ半幅がショルダー半幅を超えている' % y)
    # 前後端が絞れているか(絞らないと鼻先が平板になる)
    for lbl, y in (('ノーズ', 2.200), ('テール', -2.200)):
        if lerp_table(PLAN_HW, y) > 0.660:
            errs.append('%s先端の PLAN_HW が %.3f (0.660超。平板に見える)'
                        % (lbl, lerp_table(PLAN_HW, y)))
    if lerp_table(TOP_LINE, -2.200) < 0.930:
        errs.append('テール先端の TOP_LINE が %.3f (0.930未満。'
                    'リヤが削げてテールランプを貼る面が残らない)'
                    % lerp_table(TOP_LINE, -2.200))
    # ルーフレール上端が全高を決める。天端がそれを越えるとルーフがレールを
    # 突き抜ける(レールは脚でルーフまで降ろすので、多少沈むのは正しい)
    top = max(lerp_table(TOP_LINE, y) for y in STATION_Y)
    if top > H:
        errs.append('TOP_LINE の最大が %.3f。全高 %.3f を越えるとルーフが'
                    'ルーフレールを突き抜ける' % (top, H))
    if errs:
        raise SystemExit('[car2] 三面図の表に矛盾があります:\n  '
                         + '\n  '.join(errs))
    print('[car2] 三面図の検算 OK (天端最大 %.3f / DLO高 y=0 で %.3f)'
          % (top, lerp_table(TOP_LINE, 0.0) - lerp_table(BELT_LINE, 0.0)))


def lerp_table(table, y):
    if y <= table[0][0]:
        return table[0][1]
    if y >= table[-1][0]:
        return table[-1][1]
    for i in range(len(table) - 1):
        y0, v0 = table[i]
        y1, v1 = table[i + 1]
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0) if y1 > y0 else 0.0
            return v0 + (v1 - v0) * t
    return table[-1][1]


def _mix(a, b, t):
    return a + (b - a) * t


def ring_points(y):
    """1ステーションの断面(右半分)。下端中心 → 外 → ショルダー → ルーフ中心。

    ショルダーより上は必ず (天端 - 肩) の **比** で置く。固定値(旧: 肩+55mm)で
    置くと、肩と天端の差が小さいノーズ/テールで上下が入れ替わって断面が自分自身と
    交差し、ボンネットに帯状のシェーディング破綻が出る。
    """
    hw = lerp_table(PLAN_HW, y) * HWS
    hwr = lerp_table(PLAN_HW_ROOF, y) * HWS
    z0 = lerp_table(ROCKER_Z, y)
    zsh = lerp_table(BELT_LINE, y)
    zt = lerp_table(TOP_LINE, y)
    if zt - zsh < 0.05:
        zsh = zt - 0.05
    g = zt - zsh                        # 肩から天端まで
    b = zsh - z0                        # ロッカーから肩まで
    return [
        (0.0,          z0 - 0.015),
        (hw * 0.52,    z0 - 0.010),
        (hw * 0.86,    z0 + 0.008),
        (hw * 0.965,   z0 + 0.075),                   # ロッカー外面
        # 0.42 だと黒い帯が全高の1/3(z≒0.53m)まで上がり、ジャッキアップ
        # した SUV に見える。実車の樹脂はサイドシル際の細い帯だけ
        (hw * 0.995,   z0 + b * 0.22),
        (hw * 1.000,   zsh - min(0.090, b * 0.16)),
        (hw * 0.999,   zsh - min(0.030, b * 0.055)),  # 支持ループ(下)
        (hw * 0.988,   zsh - min(0.004, b * 0.008)),  # ショルダー(稜線)
        (hw * 0.955,   zsh + g * 0.035),              # 支持ループ(上)
        # ショルダーからルーフ幅へは **3段かけて** 絞る。1段で詰めると
        # 肩の上に幅100mmの棚ができ、ルーフが別の箱として載って見える
        # (三面図をどう引いても直らない。断面の側の問題)
        (_mix(hw * 0.955, hwr * 1.045, 0.45), zsh + g * 0.130),   # DLO下端
        (_mix(hw * 0.955, hwr * 1.020, 0.80), zsh + g * 0.450),
        (hwr * 1.000,  zsh + g * 0.760),
        (hwr * 0.985,  zsh + g * 0.930),              # ルーフ肩
        (hwr * 0.930,  zsh + g * 0.982),
        (hwr * 0.640,  zsh + g * 0.997),
        (0.0,          zt),
    ]


def full_ring(y):
    half = ring_points(y)
    pts = [(x, y, z) for (x, z) in half]
    pts += [(-x, y, z) for (x, z) in reversed(half[1:-1])]
    return pts


def material_for(mid_y, j):
    idx = MAT_BODY
    for _name, m, (lo, hi), rs in FEATURES:
        if lo <= mid_y <= hi and j in rs:
            idx = m
    return idx


def build_body():
    """ロフト。面を作りながら (ステーション行, リング番号) でマテリアルを振る。"""
    bm = bmesh.new()
    verts = [[bm.verts.new(p) for p in full_ring(y)] for y in STATION_Y]
    for i in range(len(STATION_Y) - 1):
        mid = (STATION_Y[i] + STATION_Y[i + 1]) / 2.0
        r0, r1 = verts[i], verts[i + 1]
        for j in range(FULL_N):
            f = bm.faces.new((r0[j], r0[(j + 1) % FULL_N],
                              r1[(j + 1) % FULL_N], r1[j]))
            f.material_index = material_for(mid, j)
    # 前後の蓋。中心へ扇状に張る。中心を前へ出すと全長が伸びてカタログ値と
    # ずれる(= その軸だけ縮められる)ので、蓋は必ず端のステーション上に置く
    for sign, ring in ((1, verts[0]), (-1, verts[-1])):
        y_cap = STATION_Y[0] if sign > 0 else STATION_Y[-1]
        zs = [v.co.z for v in ring]
        c = bm.verts.new((0.0, y_cap, (min(zs) + max(zs)) / 2.0))
        for j in range(FULL_N):
            a, b2 = ring[j], ring[(j + 1) % FULL_N]
            tri = (a, b2, c) if sign > 0 else (b2, a, c)
            f = bm.faces.new(tri)
            f.material_index = material_for(CAP_Y[sign], j)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('car_body')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('car_body', me)
    bpy.context.collection.objects.link(ob)
    return ob


def hex_lin(h):
    """sRGB の16進 → Blender が期待するリニア値(Base Color はリニア)。"""
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        s = int(h[i:i + 2], 16) / 255.0
        out.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat and 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.08
    if emit:
        if 'Emission Color' in b.inputs:
            b.inputs['Emission Color'].default_value = (color[0], color[1], color[2], 1.0)
        if 'Emission Strength' in b.inputs:
            b.inputs['Emission Strength'].default_value = emit
    return m


def body_materials():
    """FEATURES のマテリアル番号と同じ順で積む。順序がずれると全部入れ替わる。"""
    return [
        mat('CarBody', hex_lin('#E4E6EA'), rough=0.28, metal=0.10, coat=0.7),
        mat('CarGlass', hex_lin('#232830'), rough=0.06, metal=0.35),
        mat('CarLower', hex_lin('#3B3F44'), rough=0.75),
        # レンズは **暗く**。白いボディに淡い水色を置いても背景に溶けて、
        # ランプが付いていないように見える。実車もレンズの中は暗く、光るのは
        # 中のリフレクタとデイライトの線だけ。この明暗差が顔付きを作る
        mat('CarHeadlight', hex_lin('#2E3641'), rough=0.08, metal=0.25),
        mat('CarTaillight', hex_lin('#9E1A22'), rough=0.18, emit=0.35),
        mat('CarGrille', hex_lin('#26292E'), rough=0.42),
        mat('CarDrl', hex_lin('#EFF4FF'), rough=0.08, emit=1.6),
        # ピラーとサッシ。参考図でも実車でも窓まわりは黒く塗られていて、
        # 前後のガラスとピラーが **1本の黒い帯** に見える。ここをボディ色で
        # 残すと、暗い部分が窓ごとに分断されて白い柱で刻まれた形になる
        mat('CarPillar', hex_lin('#191B1F'), rough=0.32),
    ]


# ── 回転体(タイヤ・リム) ───────────────────────────────────────
def revolve(profile, segments, axis_y, sign, name, material):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    ring = []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        ca, sa = math.cos(a), math.sin(a)
        ring.append([bm.verts.new((sign * off, axis_y + r * sa, TIRE_R + r * ca))
                     for (r, off) in profile])
    m = len(profile)
    for k in range(segments):
        r0, r1 = ring[k], ring[(k + 1) % segments]
        for j in range(m - 1):
            bm.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def build_wheel(y, sign, tire_m, rim_m, dark_m):
    outer = HW - 0.075
    w, R = TIRE_W, TIRE_R
    prof = [
        (R - 0.105, outer - w * 0.02), (R - 0.020, outer - w * 0.02),
        (R - 0.004, outer - w * 0.10), (R, outer - w * 0.30),
        (R, outer - w * 0.70), (R - 0.004, outer - w * 0.90),
        (R - 0.020, outer - w * 0.98), (R - 0.105, outer - w * 0.98),
    ]
    tag = '%d_%d' % (int(y * 100), sign)
    objs = [revolve(prof, 30, y, sign, 'tire_' + tag, tire_m)]

    rim_r = R - 0.100
    objs.append(revolve([(rim_r, outer - w * 0.03), (rim_r - 0.014, outer - w * 0.03),
                         (rim_r - 0.014, outer - w * 0.55), (rim_r, outer - w * 0.55)],
                        30, y, sign, 'rimlip_' + tag, rim_m))
    # 皿は暗くしてブレーキ側の陰にする。ここを明るくするとスポークが埋もれる
    objs.append(revolve([(rim_r - 0.012, outer - w * 0.30),
                         (rim_r * 0.26, outer - w * 0.38), (0.001, outer - w * 0.40)],
                        30, y, sign, 'rimdisc_' + tag, dark_m))
    # スポーク5本。皿より外側(車体外側)に置いて必ず見えるようにする
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.radians(18)
        me = bpy.data.meshes.new('spoke')
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((0.026, rim_r * 0.80, 0.052)), verts=bm.verts)
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, rim_r * 0.42, 0)))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector((0, 0, 0)),
                         matrix=Matrix.Rotation(a, 3, 'X'))
        bmesh.ops.translate(bm, verts=bm.verts,
                            vec=Vector((sign * (outer - w * 0.20), y, TIRE_R)))
        bm.to_mesh(me)
        bm.free()
        sp = bpy.data.objects.new('spoke', me)
        bpy.context.collection.objects.link(sp)
        sp.data.materials.append(rim_m)
        objs.append(sp)
    # ハブキャップ
    objs.append(revolve([(0.001, outer - w * 0.16), (0.052, outer - w * 0.17),
                         (0.052, outer - w * 0.24)],
                        20, y, sign, 'hub_' + tag, rim_m))
    return objs


# ── 箱もの ────────────────────────────────────────────────────
def box(name, center, size, material, bevel=0.0, segments=1):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel,
                        segments=segments, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def hw_at(y):
    return lerp_table(PLAN_HW, y) * HWS


def build_lamp(sign, path, z_lo, z_hi, material, name, out=0.006, bulge=0.012):
    """車体の平面輪郭をなぞってレンズ面を張る。

    ランプを直方体で貼ると、丸いノーズには必ず角が刺さるか浮くかする。
    輪郭 (x, y) の折れ線に沿わせて3列(下・中・上)で張り、中央列だけ外へ
    膨らませると、面から浮かずにレンズらしい張りが出る。
    """
    zs = (z_lo, (z_lo + z_hi) / 2.0, z_hi)
    outs = (out, out + bulge, out)
    n = len(path)
    # 各点の外向き法線(平面内)。輪郭は「正面の内側 → 外へ → 後方へ回り込む」
    # 順に並ぶので、進行方向を左90度に回したものが外向きになる。符号を逆に
    # すると全部ボディの内側へ潜り、レンダリングしても何も見えない
    norms = []
    for i in range(n):
        ax, ay = path[max(0, i - 1)]
        bx, by = path[min(n - 1, i + 1)]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy) or 1.0
        norms.append((-dy / ln, dx / ln))

    bm = bmesh.new()
    grid = []
    for i, (px, py) in enumerate(path):
        nx, ny = norms[i]
        col = []
        for k in range(3):
            col.append(bm.verts.new((sign * (px + nx * outs[k]),
                                     py + ny * outs[k], zs[k])))
        grid.append(col)
    for i in range(n - 1):
        for k in range(2):
            quad = (grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k])
            bm.faces.new(quad if sign > 0 else tuple(reversed(quad)))
    for i in (0, n - 1):                       # 端の小口を塞ぐ
        bm.faces.new((grid[i][0], grid[i][1], grid[i][2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def lamp_path(x_inner, ys):
    """正面(背面)の平らな部分から、フェンダーのコーナーを回り込む輪郭。

    半幅は 1.000 倍で拾う。0.99 倍などで内側に寄せると、サブディビジョンの
    縮みと合わさってレンズが車体に潜り、レンダリングしても何も見えない。
    """
    pts = [(x_inner, ys[0])]
    pts += [(hw_at(y), y) for y in ys]
    return pts


def build_lamps(head_m, drl_m, tail_m):
    """ランプの z は必ず、その y での車体の天端(TOP_LINE)より下に収めること。
    はみ出すと車体から赤い旗が立つ。"""
    fy = (2.200, 2.196, 2.180, 2.140, 2.090, 2.030)
    ry = (-2.200, -2.196, -2.180, -2.140, -2.080, -1.960)
    objs = []
    for sign in (1, -1):
        # ヘッドランプ。ノーズの天端は y=2.200 で 0.725 なので、その下に
        # 収める。かつバンパーの暗い部分(z<0.44)より上に置き、ボディ色の
        # 面を背にしないと、暗いレンズが暗いバンパーに埋もれて見えなくなる
        objs.append(build_lamp(sign, lamp_path(0.300, fy), 0.548, 0.652,
                               head_m, 'headlamp_%d' % sign, out=0.008))
        # レンズの中で光る部分。暗いレンズに明るい線が入って初めてランプに見える
        objs.append(build_lamp(sign, lamp_path(0.318, fy), 0.578, 0.606,
                               drl_m, 'proj_%d' % sign, out=0.012, bulge=0.002))
        # デイライト: ランプ上端の細い光の線。これの有無で顔付きが決まる
        objs.append(build_lamp(sign, lamp_path(0.288, fy), 0.656, 0.676,
                               drl_m, 'drl_%d' % sign, out=0.012, bulge=0.003))
        # テールランプ: テールゲート脇。天端は y=-2.200 で 1.010
        objs.append(build_lamp(sign, lamp_path(0.290, ry), 0.830, 0.985,
                               tail_m, 'taillamp_%d' % sign, out=0.008))
    return objs


def build_arch_trim(axle_y, sign, material):
    """ホイールアーチの黒い樹脂モール。

    参考図はアーチの縁に必ず黒い縁取りが回っている。無いと、円柱で抜いた
    だけの「穴」に見える。その y での実際の半幅を拾って車体面に沿わせる。
    """
    bm = bmesh.new()
    STEPS = 24
    cols = []
    for k in range(STEPS + 1):
        a = math.pi * k / STEPS                  # 0=前 → π=後(上半分)
        col = []
        for r, out in ((ARCH_R, 0.000), (ARCH_R + 0.026, 0.016),
                       (ARCH_R + 0.056, 0.000)):
            y = axle_y + r * math.cos(a)
            z = TIRE_R + r * math.sin(a)
            col.append(bm.verts.new((sign * (hw_at(y) * 0.999 + out), y, z)))
        cols.append(col)
    for k in range(STEPS):
        c0, c1 = cols[k], cols[k + 1]
        for j in (0, 1):
            q = (c0[j], c0[j + 1], c1[j + 1], c1[j])
            bm.faces.new(q if sign > 0 else tuple(reversed(q)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('archtrim')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('archtrim', me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def build_spoiler(body_m, dark_m):
    """テールゲート上端のルーフスポイラー。

    ハッチバックの後ろ姿はここで決まる。無いとルーフがそのままテールゲートへ
    落ちて「切り落とした箱」に見える。
    """
    objs = []
    y0 = GH['backlight'][0]
    zt = lerp_table(TOP_LINE, y0)
    hwr = lerp_table(PLAN_HW_ROOF, y0) * HWS
    objs.append(box('spoiler', (0.0, y0 - 0.070, zt + 0.024),
                    (hwr * 1.72, 0.160, 0.048), body_m, bevel=0.014, segments=2))
    objs.append(box('spoiler_lip', (0.0, y0 - 0.140, zt + 0.012),
                    (hwr * 1.40, 0.040, 0.022), dark_m, bevel=0.008))
    return objs


def build_mirror(sign, shell_m, glass_m):
    """ドアミラー。台座(セイル)+ アーム + ハウジング + 鏡面の4点で作る。

    箱を1個だけ貼ると「壁から生えた四角い突起」にしかならない。実物は
    ドア側の三角の台座から細いアームが出て、その先に卵形のハウジングが
    載っている。この3段の構成が無いと、どれだけ丸めてもミラーに見えない。
    """
    y = 0.790
    zb = lerp_table(BELT_LINE, y)
    xw = hw_at(y)
    # ハウジング外端は必ず全幅(MIRROR_X)にちょうど届かせる。ここが全幅を決める
    shell_hw = (MIRROR_X - xw) * 0.62
    shell_cx = MIRROR_X - shell_hw
    objs = []
    # 台座(セイル): ドア面に食い込ませて隙間を作らない
    objs.append(box('mir_base_%d' % sign, (sign * (xw - 0.006), y, zb + 0.048),
                    (0.034, 0.126, 0.072), shell_m, bevel=0.012, segments=2))
    # アーム: 台座からハウジングへ。細くして「板が生えている」形を避ける
    objs.append(box('mir_arm_%d' % sign,
                    (sign * (xw + shell_hw * 0.35), y + 0.002, zb + 0.066),
                    ((shell_cx - xw) * 1.6, 0.048, 0.038), shell_m,
                    bevel=0.009, segments=2))
    # ハウジング: 卵形。前が高く後ろへ絞る
    objs.append(box('mir_shell_%d' % sign, (sign * shell_cx, y - 0.010, zb + 0.080),
                    (shell_hw * 2, 0.182, 0.092), shell_m, bevel=0.028, segments=3))
    # 鏡面: 後ろ向きに露出させる
    objs.append(box('mir_glass_%d' % sign, (sign * shell_cx, y - 0.092, zb + 0.080),
                    (shell_hw * 1.55, 0.010, 0.070), glass_m, bevel=0.006, segments=2))
    return objs


def build_grille(dark_m, chrome_m):
    """フロントグリル。全長を伸ばさないよう、必ず y=2.200 より内側に収める。"""
    objs = []
    y0 = STATION_Y[0]                       # 2.200
    # 中央の細いグリル。左右のヘッドランプ(内端 x=0.300)に掛からない幅にする
    objs.append(box('grille_frame', (0.0, y0 - 0.014, 0.596),
                    (0.520, 0.026, 0.092), dark_m, bevel=0.010, segments=2))
    for k, z in enumerate((0.568, 0.596, 0.624)):
        objs.append(box('grille_bar_%d' % k, (0.0, y0 - 0.006, z),
                        (0.480 - abs(k - 1) * 0.02, 0.012, 0.014), chrome_m,
                        bevel=0.004, segments=2))
    # 下部インテーク(バンパー開口)。参考図のこの車は下が大きく開いている
    objs.append(box('intake', (0.0, y0 - 0.016, 0.428),
                    (1.060, 0.026, 0.142), dark_m, bevel=0.014, segments=2))
    for k in range(3):
        objs.append(box('intake_bar_%d' % k, (0.0, y0 - 0.008, 0.386 + k * 0.042),
                        (1.020 - k * 0.02, 0.010, 0.013), dark_m, bevel=0.003))
    objs.append(box('plate_f', (0.0, y0 - 0.010, 0.500),
                    (0.330, 0.014, 0.078), chrome_m, bevel=0.004))
    return objs


def build_rails(trim_m):
    """ルーフレール。上端を全高ちょうどに合わせ、脚2本でルーフに接地させる。

    レールをルーフ面から一定距離で浮かせると、後ろへ行くほどルーフが下がる
    ぶんだけ隙間が開いて宙に浮いて見える。上端を水平に通し、脚でルーフまで
    降ろすのが実物の作りでもある。
    """
    objs = []
    top, thick = ROOF_TOP, 0.028
    ya, yb = -1.30, 0.20
    for sign in (1, -1):
        objs.append(box('rail_%d' % sign, (sign * 0.520, (ya + yb) / 2,
                                           top - thick / 2),
                        (0.042, yb - ya, thick), trim_m, bevel=0.009, segments=2))
        for fy in (ya + 0.06, yb - 0.06):
            zt = lerp_table(TOP_LINE, fy)
            objs.append(box('railfoot_%d_%.0f' % (sign, fy * 100),
                            (sign * 0.520, fy, (zt + top - thick) / 2),
                            (0.034, 0.068, top - thick - zt + 0.010), trim_m,
                            bevel=0.006))
    return objs


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _check_feature_stations()
    _check_tables()

    body = build_body()
    mats = body_materials()
    for m in mats:
        body.data.materials.append(m)

    # ホイールアーチを円柱で抜く(マテリアルは既に振ってあるので影響しない)
    for i, ay in enumerate((AXLE_F, AXLE_R)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ARCH_R, depth=W + 0.6,
                                            location=(0, ay, TIRE_R),
                                            rotation=(0, math.radians(90), 0))
        cutter = bpy.context.object
        boo = body.modifiers.new('A%d' % i, 'BOOLEAN')
        boo.operation = 'DIFFERENCE'
        boo.object = cutter
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=boo.name)
        bpy.data.objects.remove(cutter, do_unlink=True)

    sub = body.modifiers.new('Sub', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=sub.name)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(34))

    TIRE = mat('CarTire', hex_lin('#26272A'), rough=0.95)
    RIM = mat('CarRim', hex_lin('#C6C8CC'), rough=0.30, metal=0.75)
    DARK = mat('CarWheelWell', hex_lin('#1E2023'), rough=0.85)
    TRIM = mat('CarTrim', hex_lin('#33363B'), rough=0.55)
    CHROME = mat('CarChrome', hex_lin('#C8CBD0'), rough=0.16, metal=1.0)
    MGLASS = mat('CarMirrorGlass', hex_lin('#7E8894'), rough=0.05, metal=0.9)

    parts = []
    for ay in (AXLE_F, AXLE_R):
        for sign in (1, -1):
            parts += build_wheel(ay, sign, TIRE, RIM, DARK)
    for sign in (1, -1):
        parts += build_mirror(sign, TRIM, MGLASS)
    parts += build_grille(TRIM, CHROME)
    # ルーフレールは付けない。参考図のハッチバックには無く、
    # 水平に通すとルーフが後ろ下がりのぶんだけ浮いて見える
    parts += build_spoiler(mats[MAT_BODY], mats[MAT_CLAD])
    for ay in (AXLE_F, AXLE_R):
        for sign in (1, -1):
            parts.append(build_arch_trim(ay, sign, mats[MAT_CLAD]))
    parts += build_lamps(mats[MAT_HEAD], mats[MAT_DRL], mats[MAT_TAIL])
    parts.append(box('skid_f', (0.0, 2.140, 0.352), (0.80, 0.12, 0.048), CHROME,
                     bevel=0.010, segments=2))
    parts.append(box('skid_r', (0.0, -2.120, 0.372), (0.78, 0.12, 0.048), CHROME,
                     bevel=0.010, segments=2))
    parts.append(box('plate_r', (0.0, -2.128, 0.760), (0.330, 0.014, 0.165), CHROME,
                     bevel=0.004))

    bpy.ops.object.select_all(action='DESELECT')
    for o in [body] + parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    car = bpy.context.object
    car.name = 'car_crossover'

    per = {}
    for p in car.data.polygons:
        m0 = (car.data.materials[p.material_index]
              if p.material_index < len(car.data.materials) else None)
        nm = m0.name if m0 else '(empty)'
        per[nm] = per.get(nm, 0) + 1
    print('[car2] faces per material: %s'
          % sorted(per.items(), key=lambda kv: -kv[1]))
    tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
    bb = [Vector(c) for c in car.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    got = (mx.x - mn.x, mx.y - mn.y, mx.z - mn.z)
    print('[car2] tris=%d bbox=%.3f x %.3f x %.3f (z %.3f..%.3f)'
          % (tris, got[0], got[1], got[2], mn.z, mx.z))
    # カタログ(car の w/d/h)とバウンディングボックスを厳密に一致させる。
    # ずれたまま出すと makeGltfBoxFitClone がその軸だけ伸縮させ、幅だけ細い車に
    # なる。ランプやミラーの張り出しぶんの端数(1%未満)はここで吸収する。
    # 1%を超えるずれは設計側の間違いなので、黙って潰さず落とす
    for axis, want, have, name in ((0, W, got[0], '幅'), (1, L, got[1], '全長'),
                                   (2, H, got[2], '全高')):
        err = abs(have - want) / want
        if err > 0.01:
            raise SystemExit('[car2] %s がカタログと %.1f%% ずれている '
                             '(%.0f / %.0f)。設計値を直すこと'
                             % (name, err * 100, want * 1000, have * 1000))
    for v in car.data.vertices:
        v.co.x *= W / got[0]
        v.co.y *= L / got[1]
        v.co.z *= H / got[2]
    print('[car2] カタログ %.0f x %.0f x %.0f へ厳密に合わせた'
          % (W * 1000, L * 1000, H * 1000))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    car.select_set(True)
    bpy.context.view_layer.objects.active = car
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True)
    print('[car2] wrote %s' % OUT)


if __name__ == '__main__':
    main()
