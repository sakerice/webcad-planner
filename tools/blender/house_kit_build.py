"""隣家(neighbor-house)を「日本の住宅規格に沿ったパーツキット」として組み立てるBlenderスクリプト。

■ なぜキットなのか
  旧 `house_build.py` は 5.2m×3.6m の一体モデルを出力し、アプリ側で
  `scale(w/5.2, storyH/2.7, d/3.6)` と非等方スケールしていた。
  そのため隣家を大きくすると窓が3m幅・玄関ドアが2m幅になるなど、
  日本の住宅では有り得ない寸法・意匠になっていた。

  本スクリプトは「実寸のパーツ」だけを書き出す。アプリ側は 910mm(1P)の
  グリッドにパーツを並べるだけなので、建物をいくら大きくしても
  窓・ドア・シャッター・バルコニー・軒の出は実寸のまま保たれる。

■ 座標・原点の約束(重要)
  - Blender: X=幅, Y=奥行, Z=高さ。**外側(屋外)は -Y 方向**。
    glTF(export_yup=True)へ変換すると Blender -Y は glTF +Z になるため、
    アプリ側では「パーツの +Z が屋外向き」として扱える。
  - 外壁パーツの原点 = 外壁面の下端中央 (外壁面 y=0、躯体は y>0 側へ伸びる)。
  - 高さは全て「その階の床(FL)」基準。

■ 準拠させた主な寸法(日本の住宅規格)
  - モジュール 910mm(1P) / 半間 455mm
  - 外壁: 目地の無いフラットな塗り壁仕上げ(粒状感のみ)、出隅役物 90mm
  - 基礎立上り GL+400、土台水切り
  - サッシ(LIXIL等の呼称寸法):
      16520 掃き出し窓 W1690×H2030 (FL±0)
      16511 引違い窓   W1690×H1170 (窓台FL+830 → まぐさFL+2000)
      06011 縦すべり出し W 640×H1170 (窓台FL+830)
      06005 横すべり出し W 640×H 570 (FL+1430、型ガラス+面格子。浴室・便所)
  - 玄関: 親子ドア W1235×H2300、ポーチ庇 W1820×出600
  - 車庫: オーバースライダー/シャッター W2400×H2300(普通車対応)
  - バルコニー: 幅1820 / 出910 / 手すり高1100(建築基準法1100以上)
  - 階の外壁高さ 2700(アプリの最小階高と一致。超過分はJS側で見切り下に充填)

  ※屋根はフットプリント依存(寄棟・4寸勾配・軒の出455)のため、
    形状のみアプリ側で生成し、マテリアル(NhRoof等)は本キットの
    `nh_matlib` から取得する。

■ 実行方法
    python3 tools/blender/house_kit_build.py            # GLB書き出しまで
    python3 tools/blender/house_kit_build.py --no-export
  Blender GUI/MCP から流す場合はそのまま `exec(open(...).read())` でよい
  (`--` 引数が無いときは書き出しをスキップする)。
"""

import math
import os
import random
import sys

import bpy
import bmesh

# ── 寸法定数(mm→m) ──────────────────────────────────────────────
P = 0.910          # 1P(1間の半分=3尺)
HP = 0.455         # 半P
SEG_H = 2.700      # 1階分の外壁高さ(アプリの最小階高に一致)
WALL_T = 0.120     # 外壁の見付け厚(通気層+外装材)
TILE = 1.820       # 外壁・屋根のUVタイル基準(1.82m = 2P)
RECESS = 0.045     # サッシの引っ込み(外壁面からの奥行)
CASING = 0.022     # 額縁(窓枠化粧材)の出

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'assets', 'models', 'context')


# ── マテリアル ────────────────────────────────────────────────
def matp(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Emission Strength' in b.inputs:
        b.inputs['Emission Strength'].default_value = 0.0
    return m


def _new_image(name, n):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    return bpy.data.images.new(name, n, n, alpha=False)


def make_wall_image(name, base, seed=42):
    """フラットな外壁(塗り壁/フラットサイディング)。

    横張りサイディングの目地(横縞)は入れない。方向性のある模様を持たせると
    パネルの継ぎ目や端数吸収でスケールした端部ベイで縞のピッチが揃わず、
    かえって不自然に見えるため、等方な微粒子のムラだけを入れる。
    純粋なノイズなのでUVタイルの繰り返しも視認されない。
    """
    n = 128        # 構造の無いノイズなので解像度は低くてよい(GLBを軽く保つ)
    img = _new_image(name, n)
    rng = random.Random(seed)
    px = [0.0] * (n * n * 4)
    for y in range(n):
        for x in range(n):
            i = (y * n + x) * 4
            # 完全にランダムな粒状感(±2.2%)のみ。
            # 三角関数などで濃淡のうねりを足すと周期的な縞に見えてしまうので入れない。
            g = 1.0 + rng.uniform(-0.022, 0.022)
            px[i] = min(1.0, base[0] * g)
            px[i + 1] = min(1.0, base[1] * g)
            px[i + 2] = min(1.0, base[2] * g)
            px[i + 3] = 1.0
    img.pixels = px
    img.pack()
    return img


def make_slate_image(name, base):
    """化粧スレート(コロニアル)。働き幅182mm。TILE_ROOF=1.456mに8段。"""
    n = 256
    img = _new_image(name, n)
    rows, cols = 8, 4
    rh, cw = n // rows, n // cols
    rng = random.Random(11)
    px = [0.0] * (n * n * 4)
    for y in range(n):
        r = min(rows - 1, y // rh)
        inr = y % rh
        for x in range(n):
            c = min(cols - 1, x // cw)
            inc = x % cw
            tone = 1.0 + ((r * 7 + c * 3) % 5 - 2) * 0.022
            if inr < 2:
                tone *= 0.58            # 段の影
            elif inr < 4:
                tone *= 1.14            # 段鼻
            # 縦のスリット(1段おきに半ピッチずらす)
            slit = (inc + (cw // 2 if r % 2 else 0)) % cw
            if slit < 2 and inr >= 3:
                tone *= 0.72
            g = tone * (1.0 + rng.uniform(-0.018, 0.018))
            i = (y * n + x) * 4
            px[i] = min(1.0, base[0] * g)
            px[i + 1] = min(1.0, base[1] * g)
            px[i + 2] = min(1.0, base[2] * g)
            px[i + 3] = 1.0
    img.pixels = px
    img.pack()
    return img


def make_shutter_image(name, base):
    """ガレージシャッターのスラット(ピッチ約76mm → TILE 1.82mに24本)。"""
    n = 256
    img = _new_image(name, n)
    pitch = n // 24
    px = [0.0] * (n * n * 4)
    for y in range(n):
        inp = y % pitch
        tone = 1.0
        if inp == 0:
            tone = 0.52
        elif inp <= 2:
            tone = 1.12
        elif inp >= pitch - 2:
            tone = 0.82
        for x in range(n):
            i = (y * n + x) * 4
            px[i] = min(1.0, base[0] * tone)
            px[i + 1] = min(1.0, base[1] * tone)
            px[i + 2] = min(1.0, base[2] * tone)
            px[i + 3] = 1.0
    img.pixels = px
    img.pack()
    return img


def tex_mat(name, image, rough=0.9, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        if nd.type == 'TEX_IMAGE':
            nt.nodes.remove(nd)
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.location = (-420, 240)
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Emission Strength' in b.inputs:
        b.inputs['Emission Strength'].default_value = 0.0
    return m


def build_materials():
    mats = {}
    mats['WALL'] = tex_mat('NhWall', make_wall_image('NhWallImg', (0.86, 0.845, 0.80)))
    mats['WALL2'] = tex_mat('NhWall2', make_wall_image(
        'NhWall2Img', (0.42, 0.405, 0.385), seed=7))
    mats['ROOF'] = tex_mat('NhRoof', make_slate_image('NhRoofImg', (0.215, 0.215, 0.235)), rough=0.72)
    mats['SHUT'] = tex_mat('NhShutter', make_shutter_image('NhShutterImg', (0.60, 0.61, 0.63)),
                           rough=0.5, metal=0.55)
    mats['TRIM'] = matp('NhTrim', (0.30, 0.29, 0.28), rough=0.78)
    mats['FASCIA'] = matp('NhFascia', (0.90, 0.89, 0.86), rough=0.72)
    mats['SASH'] = matp('NhSash', (0.68, 0.69, 0.71), rough=0.32, metal=0.80)
    mats['GLASS'] = matp('NhGlass', (0.24, 0.34, 0.44), rough=0.06, metal=0.30)
    mats['FGLASS'] = matp('NhGlassFrost', (0.68, 0.72, 0.75), rough=0.48)
    mats['DOOR'] = matp('NhDoor', (0.30, 0.19, 0.11), rough=0.48)
    mats['DOORD'] = matp('NhDoorDark', (0.21, 0.13, 0.07), rough=0.55)
    mats['RAIL'] = matp('NhRail', (0.62, 0.62, 0.64), rough=0.36, metal=0.65)
    # 棟包み・隅棟包み(ガルバリウム)。屋根材より確実に暗く、稜線が浮かないようにする
    mats['RIDGE'] = matp('NhRidge', (0.13, 0.13, 0.145), rough=0.52, metal=0.30)
    mats['BASE'] = matp('NhBase', (0.62, 0.61, 0.58), rough=0.94)
    mats['DARK'] = matp('NhDark', (0.09, 0.09, 0.10), rough=0.96)
    mats['GARA'] = matp('NhGarage', (0.22, 0.22, 0.23), rough=0.94)
    mats['GARAF'] = matp('NhGarageFloor', (0.40, 0.40, 0.39), rough=0.95)
    mats['ACU'] = matp('NhAc', (0.78, 0.78, 0.76), rough=0.62)
    return mats


# ── 形状ユーティリティ ────────────────────────────────────────
def box(mat, cx, cy, cz, sx, sy, sz):
    """中心 + サイズ指定の直方体。"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, cz))
    ob = bpy.context.object
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def span(mat, x0, x1, y0, y1, z0, z1):
    """min/max 指定の直方体(壁の隙間埋めはこちらが読みやすい)。"""
    if x1 - x0 <= 1e-6 or y1 - y0 <= 1e-6 or z1 - z0 <= 1e-6:
        return None
    return box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0)


def cyl(mat, cx, cy, cz, r, depth, axis='z', verts=12):
    rot = {'z': (0, 0, 0), 'y': (math.pi / 2, 0, 0), 'x': (0, math.pi / 2, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=(cx, cy, cz), rotation=rot)
    ob = bpy.context.object
    if mat:
        ob.data.materials.append(mat)
    return ob


def join_as(name, obs):
    obs = [o for o in obs if o]
    if not obs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name + '_mesh'
    return ob


def planar_uv(ob, tile=TILE, v_offset=0.0):
    """面の主法線に応じた平面投影UV。
    ワールド座標をそのまま使うので、隣り合うパーツ間でテクスチャが連続し、
    端数吸収で横方向にスケールしたパネルでも継ぎ目が出ない。"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for lp in f.loops:
            co = lp.vert.co
            if az >= ax and az >= ay:
                u, v = co.x, co.y           # 水平面
            elif ay >= ax:
                u, v = co.x, co.z           # 前後面(妻・平)
            else:
                u, v = co.y, co.z           # 左右面
            lp[uv].uv = (u / tile, v / tile + v_offset)
    bm.to_mesh(me)
    bm.free()


def shade_flat(ob):
    for poly in ob.data.polygons:
        poly.use_smooth = False


# ── 開口(サッシ)ユニット ────────────────────────────────────
class Opening:
    """外壁セグメントに開ける開口。u=セグメント内での中心X、z0=FLからの窓台高。"""

    def __init__(self, u, z0, w, h, kind='slide2', frosted=False,
                 grille=False, sill=True, shutter=False):
        self.u, self.z0, self.w, self.h = u, z0, w, h
        self.kind = kind
        self.frosted = frosted
        self.grille = grille
        self.sill = sill
        self.shutter = shutter


def build_sash(M, op, parts):
    """開口内にアルミサッシ・ガラス・額縁・窓台を納める。"""
    fr = 0.042                       # 枠見付
    y_out = 0.0
    y_fr = RECESS                    # 枠の外面
    y_gl = RECESS + 0.030
    u, z0, w, h = op.u, op.z0, op.w, op.h
    z1 = z0 + h
    S, G = M['SASH'], (M['FGLASS'] if op.frosted else M['GLASS'])

    # 開口見込み(reveal)を暗色でライニングし、開口が「穴」に見えるようにする
    parts.append(span(M['DARK'], u - w / 2, u + w / 2, y_out, y_out + RECESS, z1 - 0.004, z1))
    parts.append(span(M['DARK'], u - w / 2, u - w / 2 + 0.004, y_out, y_out + RECESS, z0, z1))
    parts.append(span(M['DARK'], u + w / 2 - 0.004, u + w / 2, y_out, y_out + RECESS, z0, z1))

    # 4周枠
    parts.append(box(S, u, y_fr + 0.030, z0 + fr / 2, w, 0.060, fr))
    parts.append(box(S, u, y_fr + 0.030, z1 - fr / 2, w, 0.060, fr))
    parts.append(box(S, u - w / 2 + fr / 2, y_fr + 0.030, (z0 + z1) / 2, fr, 0.060, h))
    parts.append(box(S, u + w / 2 - fr / 2, y_fr + 0.030, (z0 + z1) / 2, fr, 0.060, h))
    # ガラス
    parts.append(box(G, u, y_gl, (z0 + z1) / 2, w - fr * 2, 0.018, h - fr * 2))

    if op.kind == 'slide2':
        # 引違い: 中央の召合せ框 + 各障子の下框
        parts.append(box(S, u, y_fr + 0.028, (z0 + z1) / 2, 0.036, 0.056, h - fr * 2))
        for s in (-1, 1):
            parts.append(box(S, u + s * w / 4, y_fr + 0.028, z0 + fr + 0.045, w / 2 - fr, 0.050, 0.036))
    elif op.kind == 'casement':
        # 縦すべり出し: 障子框(周囲)+ ハンドル
        parts.append(box(S, u, y_fr + 0.026, z0 + fr + 0.030, w - fr * 2, 0.048, 0.032))
        parts.append(box(S, u, y_fr + 0.026, z1 - fr - 0.030, w - fr * 2, 0.048, 0.032))
        parts.append(box(S, u - w / 2 + fr + 0.020, y_fr + 0.026, (z0 + z1) / 2, 0.032, 0.048, h - fr * 2))
        parts.append(box(S, u + w / 2 - fr - 0.020, y_fr + 0.026, (z0 + z1) / 2, 0.032, 0.048, h - fr * 2))
        parts.append(box(M['RAIL'], u - w / 2 + fr + 0.055, y_fr + 0.010, (z0 + z1) / 2 - 0.10, 0.024, 0.030, 0.11))
    elif op.kind == 'awning':
        parts.append(box(S, u, y_fr + 0.026, (z0 + z1) / 2, w - fr * 2, 0.048, 0.030))

    # 額縁(窓周りの化粧枠)
    F = M['FASCIA']
    parts.append(span(F, u - w / 2 - 0.055, u + w / 2 + 0.055, -CASING, 0.004, z1, z1 + 0.055))
    parts.append(span(F, u - w / 2 - 0.055, u - w / 2, -CASING, 0.004, z0 - 0.055, z1 + 0.055))
    parts.append(span(F, u + w / 2, u + w / 2 + 0.055, -CASING, 0.004, z0 - 0.055, z1 + 0.055))
    if op.sill:
        # 窓台水切り(下端は水返しのため少し勾配代わりに厚く)
        parts.append(box(F, u, -0.038, z0 - 0.030, w + 0.11, 0.095, 0.045))
    else:
        parts.append(span(F, u - w / 2 - 0.055, u + w / 2 + 0.055, -CASING, 0.004, z0 - 0.045, z0))

    if op.grille:
        # 面格子(1階の小窓・浴室窓)
        R = M['RAIL']
        parts.append(box(R, u, -0.055, z0 - 0.010, w + 0.02, 0.028, 0.028))
        parts.append(box(R, u, -0.055, z1 + 0.010, w + 0.02, 0.028, 0.028))
        cnt = max(2, int(round(w / 0.11)))
        for i in range(cnt):
            gx = u - w / 2 + w * (i + 0.5) / cnt
            parts.append(box(R, gx, -0.055, (z0 + z1) / 2, 0.016, 0.024, h + 0.02))

    if op.shutter:
        # 雨戸(シャッター)ボックス
        parts.append(box(M['SASH'], u, -0.075, z1 + 0.115, w + 0.10, 0.170, 0.180))


# ── 外壁セグメント ────────────────────────────────────────────
def facade_segment(name, M, width, openings, wall_mat, height=SEG_H):
    """幅 width(910の倍数)の外壁セグメントを作る。
    原点=外壁面の下端中央、躯体は +Y 側、屋外は -Y 側。"""
    parts = []
    ops = sorted(openings, key=lambda o: o.u)
    x = -width / 2
    for op in ops:
        parts.append(span(wall_mat, x, op.u - op.w / 2, 0.0, WALL_T, 0.0, height))
        # 開口の下(腰壁)と上(まぐさ壁)
        parts.append(span(wall_mat, op.u - op.w / 2, op.u + op.w / 2, 0.0, WALL_T, 0.0, op.z0))
        parts.append(span(wall_mat, op.u - op.w / 2, op.u + op.w / 2, 0.0, WALL_T,
                          op.z0 + op.h, height))
        x = op.u + op.w / 2
    parts.append(span(wall_mat, x, width / 2, 0.0, WALL_T, 0.0, height))
    parts = [p for p in parts if p]

    skin = join_as(name + '_skin', parts)
    planar_uv(skin)
    shade_flat(skin)

    extra = []
    for op in ops:
        build_sash(M, op, extra)
    extra = [e for e in extra if e]
    for e in extra:
        shade_flat(e)
    seg = join_as(name, [skin] + extra)
    return seg


# ── 各パーツ ──────────────────────────────────────────────────
def build_parts(M):
    made = {}

    def reg(ob):
        if ob:
            made[ob.name] = ob
        return ob

    # 1) 無開口パネル(明色/濃色)
    reg(facade_segment('nh_seg_plain', M, P, [], M['WALL']))
    reg(facade_segment('nh_seg_plain2', M, P, [], M['WALL2']))

    # 2) 引違い腰窓 16511 (W1690×H1170 / 窓台FL+830) を 2P 幅に納める
    reg(facade_segment('nh_seg_win_l', M, 2 * P,
                       [Opening(0, 0.830, 1.690, 1.170, 'slide2')], M['WALL']))
    reg(facade_segment('nh_seg_win_l2', M, 2 * P,
                       [Opening(0, 0.830, 1.690, 1.170, 'slide2')], M['WALL2']))

    # 3) 縦すべり出し 06011 (W640×H1170)
    reg(facade_segment('nh_seg_win_s', M, P,
                       [Opening(0, 0.830, 0.640, 1.170, 'casement')], M['WALL']))
    reg(facade_segment('nh_seg_win_s2', M, P,
                       [Opening(0, 0.830, 0.640, 1.170, 'casement')], M['WALL2']))

    # 4) 横すべり出し 06005 (W640×H570 / FL+1430) 型ガラス+面格子(浴室・便所)
    reg(facade_segment('nh_seg_win_t', M, P,
                       [Opening(0, 1.430, 0.640, 0.570, 'awning', frosted=True, grille=True)],
                       M['WALL']))
    reg(facade_segment('nh_seg_win_t2', M, P,
                       [Opening(0, 1.430, 0.640, 0.570, 'awning', frosted=True, grille=True)],
                       M['WALL2']))

    # 5) 掃き出し窓 16520 (W1690×H2030 / FL±0)
    reg(facade_segment('nh_seg_door_l', M, 2 * P,
                       [Opening(0, 0.030, 1.690, 2.030, 'slide2', sill=False, shutter=True)],
                       M['WALL']))
    reg(facade_segment('nh_seg_door_l2', M, 2 * P,
                       [Opening(0, 0.030, 1.690, 2.030, 'slide2', sill=False, shutter=True)],
                       M['WALL2']))

    # 6) 玄関(親子ドア W1235×H2300 + ポーチ庇 + ポーチ灯 + インターホン)
    reg(build_entry(M))
    reg(build_entry(M, M['WALL2'], 'nh_seg_entry2'))

    # 7) インナーガレージ開口(シャッター W2400×H2300)
    reg(build_garage(M))
    reg(build_garage(M, M['WALL2'], 'nh_seg_garage2'))

    # 8) 出隅役物 90×90
    reg(build_corner(M))

    # 9) 基礎立上り+土台水切り(1P)
    reg(build_plinth(M))

    # 10) 胴差見切り(階間の水切り、1P)
    reg(build_band(M))

    # 11) 充填用の外壁帯(階高が2700を超える分、1P×455)
    reg(build_fill(M))

    # 12) バルコニー(幅1820 出910 手すり高1100)
    reg(build_balcony(M))

    # 13) 竪樋(高さ1000の繰り返し単位)
    reg(build_downpipe(M))

    # 14) エアコン室外機・電力量計ボックス・換気フード
    reg(build_ac(M))
    reg(build_meter(M))
    reg(build_vent(M))

    # 15) マテリアルライブラリ(屋根等、アプリ側生成形状に貼るマテリアルの受け皿)
    reg(build_matlib(M))
    return made


def build_entry(M, wall=None, name='nh_seg_entry'):
    """玄関セグメント(2P幅)。親子ドア W1235×H2300、ポーチ庇 W1820×出600。"""
    wall = wall or M['WALL']
    w = 2 * P
    dw, dh = 1.235, 2.300
    parts = [
        span(wall, -w / 2, -dw / 2, 0, WALL_T, 0, SEG_H),
        span(wall, dw / 2, w / 2, 0, WALL_T, 0, SEG_H),
        span(wall, -dw / 2, dw / 2, 0, WALL_T, dh, SEG_H),
    ]
    skin = join_as(name + '_skin', parts)
    planar_uv(skin)
    shade_flat(skin)

    ex = []
    # 三方枠
    fr = 0.048
    ex.append(box(M['SASH'], -dw / 2 + fr / 2, RECESS + 0.03, dh / 2, fr, 0.09, dh))
    ex.append(box(M['SASH'], dw / 2 - fr / 2, RECESS + 0.03, dh / 2, fr, 0.09, dh))
    ex.append(box(M['SASH'], 0, RECESS + 0.03, dh - fr / 2, dw, 0.09, fr))
    # 親扉(W800)+ 子扉(W390)
    px_main = -dw / 2 + fr + 0.400
    ex.append(box(M['DOOR'], px_main, RECESS + 0.055, dh / 2, 0.800, 0.045, dh - fr * 2))
    px_sub = dw / 2 - fr - 0.195
    ex.append(box(M['DOOR'], px_sub, RECESS + 0.055, dh / 2, 0.390, 0.045, dh - fr * 2))
    ex.append(box(M['DOORD'], 0, RECESS + 0.052, dh / 2, 0.014, 0.050, dh - fr * 2))
    # 採光スリット(縦2本)
    for s in (-1, 1):
        ex.append(box(M['GLASS'], px_main + s * 0.20, RECESS + 0.078, dh * 0.60, 0.075, 0.016, 1.30))
    ex.append(box(M['DOORD'], px_sub, RECESS + 0.080, dh * 0.60, 0.070, 0.012, 1.30))
    # ハンドル(プッシュプル)
    ex.append(box(M['RAIL'], px_main + 0.325, RECESS + 0.095, dh * 0.50, 0.030, 0.040, 1.10))
    # 上がり框の沓摺
    ex.append(box(M['RAIL'], 0, RECESS + 0.045, 0.012, dw - fr, 0.070, 0.024))
    # ポーチ庇(出600・水切り付)
    ex.append(box(M['FASCIA'], 0, -0.300, dh + 0.150, 1.820, 0.600, 0.070))
    ex.append(box(M['TRIM'], 0, -0.598, dh + 0.150, 1.820, 0.036, 0.100))
    for s in (-1, 1):
        ex.append(box(M['FASCIA'], s * 0.60, -0.135, dh + 0.30, 0.045, 0.230, 0.24))
    # ポーチ灯・インターホン・表札
    ex.append(box(M['FASCIA'], dw / 2 + 0.190, -0.045, 2.000, 0.100, 0.090, 0.230))
    ex.append(box(M['DARK'], -w / 2 + 0.150, -0.020, 1.350, 0.090, 0.040, 0.130))
    ex.append(box(M['FASCIA'], -w / 2 + 0.150, -0.012, 1.600, 0.240, 0.024, 0.090))
    # ポーチ土間(1段=蹴上180)。敷地を侵さないよう出は910以内に収める
    ex.append(box(M['BASE'], 0, -0.380, 0.090, 1.820, 0.760, 0.180))
    ex.append(box(M['BASE'], 0, -0.835, 0.045, 1.820, 0.150, 0.090))
    for e in ex:
        shade_flat(e)
    return join_as(name, [skin] + ex)


def build_garage(M, wall=None, name='nh_seg_garage'):
    """インナーガレージ開口(3P幅)。シャッター有効 W2400×H2300。"""
    wall = wall or M['WALL']
    w = 3 * P
    gw, gh = 2.400, 2.300
    parts = [
        span(wall, -w / 2, -gw / 2, 0, WALL_T, 0, SEG_H),
        span(wall, gw / 2, w / 2, 0, WALL_T, 0, SEG_H),
        span(wall, -gw / 2, gw / 2, 0, WALL_T, gh, SEG_H),
    ]
    skin = join_as(name + '_skin', parts)
    planar_uv(skin)
    shade_flat(skin)

    ex = []
    # まぐさ(化粧梁)・ガイドレール
    ex.append(box(M['SASH'], 0, 0.075, gh + 0.075, gw + 0.24, 0.150, 0.150))
    for s in (-1, 1):
        ex.append(box(M['SASH'], s * (gw / 2 + 0.055), 0.075, (gh + 0.15) / 2, 0.110, 0.150, gh + 0.15))
    # シャッター(巻き上げ途中: 上部400mmだけ降ろした状態)
    ex.append(box(M['SHUT'], 0, 0.055, gh - 0.200, gw, 0.040, 0.400))
    ex.append(box(M['SASH'], 0, 0.055, gh - 0.408, gw, 0.055, 0.030))
    # 土間コンクリート
    ex.append(box(M['GARAF'], 0, 0.900, 0.015, gw - 0.04, 2.100, 0.030))
    # 内部ライニング(暗色) 左右・天井・奥
    ex.append(box(M['GARA'], -gw / 2 + 0.02, 0.900, gh / 2, 0.040, 2.100, gh))
    ex.append(box(M['GARA'], gw / 2 - 0.02, 0.900, gh / 2, 0.040, 2.100, gh))
    ex.append(box(M['GARA'], 0, 0.900, gh - 0.02, gw - 0.04, 2.100, 0.040))
    ex.append(box(M['GARA'], 0, 1.930, gh / 2, gw - 0.04, 0.060, gh))
    # 天井のライン照明・奥の物置棚
    ex.append(box(M['FASCIA'], 0, 0.900, gh - 0.055, 0.110, 1.200, 0.040))
    ex.append(box(M['GARA'], gw / 2 - 0.35, 1.700, 0.900, 0.640, 0.360, 1.800))
    for e in ex:
        shade_flat(e)
    return join_as(name, [skin] + ex)


def build_corner(M):
    """出隅役物 90×90。断面が正方形なので原点は角柱の中心に置き、
    アプリ側は回転させずに4隅へ配置するだけでよい。"""
    t = 0.090
    a = box(M['FASCIA'], 0, 0, SEG_H / 2, t, t, SEG_H)
    planar_uv(a)
    shade_flat(a)
    a.name = 'nh_corner'
    a.data.name = 'nh_corner_mesh'
    return a


def build_plinth(M):
    """基礎立上り(見え掛かり400)+土台水切り。1P幅、原点=外壁面下端中央。
    外壁面よりわずかに屋外側へ出し、水切りをさらに前に出す。"""
    ex = []
    ex.append(box(M['BASE'], 0, -0.005, 0.200, P, 0.050, 0.400))
    ex.append(box(M['TRIM'], 0, -0.028, 0.412, P, 0.056, 0.030))
    for e in ex:
        shade_flat(e)
    ob = join_as('nh_plinth', ex)
    planar_uv(ob)
    return ob


def build_band(M):
    """胴差(階間)水切り。1P幅、原点=外壁面・その階のFL。"""
    ob = box(M['TRIM'], 0, -0.018, -0.030, P, 0.052, 0.060)
    shade_flat(ob)
    ob.name = 'nh_band'
    ob.data.name = 'nh_band_mesh'
    planar_uv(ob)
    return ob


def build_fill(M):
    """階高が2700を超える分を埋める外壁帯(1P×455)。"""
    ob = box(M['WALL'], 0, WALL_T / 2, HP / 2, P, WALL_T, HP)
    planar_uv(ob)
    shade_flat(ob)
    ob.name = 'nh_fill'
    ob.data.name = 'nh_fill_mesh'
    return ob


def build_balcony(M):
    """バルコニー 幅1820 / 出910 / 手すり高1100(笠木込み1150)。
    原点=取付壁面のFL。"""
    bw, bd = 1.820, 0.910
    t = 0.075
    ex = []
    # 床スラブ(先端下がりの水切り込み)
    ex.append(box(M['FASCIA'], 0, -bd / 2, 0.065, bw, bd, 0.130))
    ex.append(box(M['TRIM'], 0, -bd / 2, -0.008, bw + 0.02, bd + 0.02, 0.026))
    # 手すり壁(正面+両側面) H1100。
    # 本体と同色だと正面視でバルコニーが壁に溶けて見えなくなるため、
    # 日本の建売で一般的な「アクセント色の外壁」で仕上げる。
    ex.append(box(M['WALL2'], 0, -bd + t / 2, 0.130 + 0.550, bw, t, 1.100))
    ex.append(box(M['WALL2'], -bw / 2 + t / 2, -bd / 2 - 0.01, 0.130 + 0.550, t, bd - 0.02, 1.100))
    ex.append(box(M['WALL2'], bw / 2 - t / 2, -bd / 2 - 0.01, 0.130 + 0.550, t, bd - 0.02, 1.100))
    for e in ex:
        planar_uv(e)
    # アルミ笠木
    k = []
    k.append(box(M['RAIL'], 0, -bd + t / 2, 1.250, bw + 0.04, t + 0.04, 0.045))
    k.append(box(M['RAIL'], -bw / 2 + t / 2, -bd / 2 - 0.01, 1.250, t + 0.04, bd - 0.02, 0.045))
    k.append(box(M['RAIL'], bw / 2 - t / 2, -bd / 2 - 0.01, 1.250, t + 0.04, bd - 0.02, 0.045))
    # 物干し金物
    for s in (-1, 1):
        k.append(box(M['RAIL'], s * 0.55, -bd + 0.22, 1.520, 0.032, 0.032, 0.500))
        k.append(box(M['RAIL'], s * 0.55, -bd + 0.30, 1.760, 0.030, 0.200, 0.030))
    # ドレン
    k.append(cyl(M['RAIL'], bw / 2 - 0.16, -bd + 0.10, 0.02, 0.026, 0.10, 'z', 8))
    ex += k
    for e in ex:
        shade_flat(e)
    return join_as('nh_balcony', ex)


def build_downpipe(M):
    """竪樋 φ60(高さ1000の単位)。原点=外壁面・下端。"""
    ob = cyl(M['RAIL'], 0, -0.042, 0.5, 0.030, 1.0, 'z', 10)
    shade_flat(ob)
    ob.name = 'nh_downpipe'
    ob.data.name = 'nh_downpipe_mesh'
    return ob


def build_ac(M):
    """エアコン室外機 W800×D300×H630 + 配管カバー。原点=外壁面・接地。"""
    ex = []
    ex.append(box(M['ACU'], 0, -0.170, 0.400, 0.800, 0.300, 0.630))
    ex.append(box(M['DARK'], 0, -0.322, 0.400, 0.560, 0.010, 0.440))
    ex.append(box(M['BASE'], 0, -0.170, 0.042, 0.860, 0.340, 0.085))
    ex.append(box(M['FASCIA'], 0.470, -0.038, 0.900, 0.090, 0.075, 1.600))
    for e in ex:
        shade_flat(e)
    return join_as('nh_ac', ex)


def build_meter(M):
    """電力量計+ガスメーターボックス。原点=外壁面・接地。"""
    ex = []
    ex.append(box(M['FASCIA'], 0, -0.065, 1.600, 0.360, 0.130, 0.480))
    ex.append(box(M['DARK'], 0, -0.128, 1.680, 0.230, 0.010, 0.230))
    ex.append(box(M['BASE'], 0, -0.110, 0.350, 0.420, 0.220, 0.700))
    for e in ex:
        shade_flat(e)
    return join_as('nh_meter', ex)


def build_vent(M):
    """換気フード φ150。原点=外壁面。"""
    ex = []
    ex.append(cyl(M['RAIL'], 0, -0.035, 0, 0.082, 0.070, 'y', 12))
    ex.append(box(M['RAIL'], 0, -0.082, -0.030, 0.180, 0.030, 0.055))
    for e in ex:
        shade_flat(e)
    return join_as('nh_vent', ex)


def build_matlib(M):
    """アプリ側で生成する屋根等のためにマテリアルを載せて運ぶ極小メッシュ。
    アプリはこのノードを描画せず、マテリアルだけを取り出す。"""
    ex = []
    for i, key in enumerate(('ROOF', 'FASCIA', 'TRIM', 'RAIL', 'BASE', 'DARK',
                             'WALL', 'WALL2', 'GARAF', 'RIDGE')):
        ob = box(M[key], i * 0.02, 0, -5.0, 0.01, 0.01, 0.01)
        planar_uv(ob)
        ex.append(ob)
    return join_as('nh_matlib', ex)


# ── 実行 ─────────────────────────────────────────────────────
def clear_kit():
    for ob in list(bpy.data.objects):
        if ob.name.startswith('nh_'):
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def anchor_parts(made):
    """glTF書き出し時に位置が二重に効かないよう、全パーツの変換を適用する。"""
    for ob in made.values():
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.location = (0, 0, 0)


def export(made, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in made.values():
        ob.select_set(True)
        ob.hide_render = False
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_apply=True, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False, export_texture_dir='')
    return os.path.getsize(path)


def main(do_export=True):
    clear_kit()
    M = build_materials()
    made = build_parts(M)
    anchor_parts(made)
    print('KIT_PARTS', len(made))
    for name in sorted(made):
        ob = made[name]
        dims = ob.dimensions
        print('  %-18s tris=%-5d  %.3f x %.3f x %.3f' % (
            name, len(ob.data.polygons), dims.x, dims.y, dims.z))
    if do_export:
        path = os.path.join(OUT_DIR, 'neighbor_house_kit.glb')
        size = export(made, path)
        print('KIT_GLB', path, size)
    return made


if __name__ == '__main__':
    main(do_export='--no-export' not in sys.argv)
