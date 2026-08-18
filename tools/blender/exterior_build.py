"""外構モデル(庭木・ウッドデッキ)を生成して `assets/models/custom/` へ書き出す。

■ なぜ手続き生成なのか
  庭木は「正二十面体を数個重ねた緑の団子」、ウッドデッキは「ただの直方体」
  だった。どちらも遠目には家具に見えず、間取りの外構が嘘くさくなる。
  かといって高密度メッシュはモバイルで重い。そこで**低ポリのまま
  「それらしく見える」形状の手続き生成**に寄せた。

  - 庭木: 葉を1枚ずつの薄い板(quad)にして隙間を作る。塊で塗らないので
    低ポリでも透け感が出て、背後の建物が見える。
  - デッキ: 床板を1枚ずつ並べる。目地の線が入るだけで「板を張った面」に
    見えるので、面数を増やさずにデッキらしさが出る。

■ 座標・原点の約束(既存モデルと共通)
  - 単位はメートル。Blender は Z-up(X=幅, Y=奥行, Z=高さ)で組み、
    `export_yup=True` で glTF(+Y up)へ変換する。
  - 原点は接地面の中心。モデルは Z=0 から上へ立つ(glTF では Y=0 から上)。
  - アプリはカタログの w/d/h(mm)へ非等方スケールするため、
    **メッシュのバウンディングボックスは w/d/h と一致させること**
    (`normalize_to()` が担保する)。ズレるとその分だけ寸法が狂う。

■ 出力寸法(manifest.json の w/d/h と一対一)
  - garden_tree.glb : 1500 x 1500 x 3000 mm (株立ち、樹冠φ1.5m / 樹高3.0m)
  - wood_deck.glb   : 2600 x  900 x  450 mm (床板22枚、幕板・根太・束付き)

■ 実行方法
  bpy(PyPI)が入っていれば単体で走る。入っていなければ Blender の CLI から。

      python3 tools/blender/exterior_build.py
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/exterior_build.py

  フラグ:
      --no-export   GLBを書かず、三角形数と寸法だけ出す(寸法確認用)
      --no-icons    top/thumb のPNGを描き直さない(Cyclesを回さないので速い)

■ 注意点
  - 乱数は固定シード。同じスクリプトからは必ず同じ形が出る。
    形を変えたくないのに枝数やスプリグ数を触ると全体が変わる。
  - 葉は板1枚(裏表なし)なので、マテリアルは doubleSided のままにすること。
    Blenderの `use_backface_culling` をONにすると裏から見て葉が消える。
  - **既存GLBを差し替えたときは `index.html` の MODEL_ASSET_VER を+1する。**
    新規追加(初回)は旧キャッシュが無いので不要。
"""

import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'assets', 'models', 'custom')

SEED = 20260815


# ── マテリアル ────────────────────────────────────────────────
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    """#rrggbb(sRGB) → Blenderのリニア値。カタログの色指定をそのまま使う。"""
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def matp(name, hex_color, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    r, g, bl = hex_rgb(hex_color)
    b.inputs['Base Color'].default_value = (r, g, bl, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def new_object(name, bm, materials):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    for mat in materials:
        mesh.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ── プリミティブ ──────────────────────────────────────────────
def add_box(bm, mat_index, lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [bm.verts.new(p) for p in (
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in idx]).material_index = mat_index


def add_plank_y(bm, mat_index, x0, x1, y0, y1, z0, z1, chamfer):
    """Y方向に伸びる床板。断面(X/Z)の上2角を面取りする。

    面取りはハイライトの線を作るためのもの。1枚ずつ縁が光るので、
    並べたときに「板の集合」として読める(三角形数は増えない)。
    """
    c = min(chamfer, (x1 - x0) / 3.0, (z1 - z0) / 3.0)
    profile = [(x0, z0), (x1, z0), (x1, z1 - c),
               (x1 - c, z1), (x0 + c, z1), (x0, z1 - c)]
    ring0 = [bm.verts.new((x, y0, z)) for x, z in profile]
    ring1 = [bm.verts.new((x, y1, z)) for x, z in profile]
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([ring0[i], ring1[i], ring1[j],
                      ring0[j]]).material_index = mat_index
    bm.faces.new(list(ring0)).material_index = mat_index
    bm.faces.new(list(reversed(ring1))).material_index = mat_index


def add_tube(bm, mat_index, points, radii, sides):
    """ポリラインに沿ったチューブ。幹・枝用。

    断面の向きは回転最小化フレームで運ぶ。単純に毎回 up ベクトルから
    作り直すと、枝が水平に近づいたところで断面がねじれて折れて見える。
    """
    pts = [Vector(p) for p in points]
    n = len(pts)
    tangents = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized())

    normal = tangents[0].orthogonal().normalized()
    normals = [normal]
    for i in range(1, n):
        normal = (tangents[i - 1].rotation_difference(tangents[i])
                  @ normal).normalized()
        normals.append(normal)

    rings = []
    for i in range(n):
        t, nr = tangents[i], normals[i]
        bn = t.cross(nr).normalized()
        rings.append([bm.verts.new(
            pts[i] + (nr * math.cos(2 * math.pi * k / sides)
                      + bn * math.sin(2 * math.pi * k / sides)) * radii[i])
            for k in range(sides)])

    for i in range(n - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new([rings[i][k], rings[i][k2], rings[i + 1][k2],
                          rings[i + 1][k]]).material_index = mat_index
    bm.faces.new(list(reversed(rings[0]))).material_index = mat_index
    bm.faces.new(list(rings[-1])).material_index = mat_index


def add_quad(bm, mat_index, centre, axis_a, axis_b, half_a, half_b):
    a, b = axis_a * half_a, axis_b * half_b
    bm.faces.new([bm.verts.new(centre + s) for s in
                  (-a - b, a - b, a + b, -a + b)]).material_index = mat_index


def normalize_to(obj, target_w, target_d, target_h):
    """接地面の中心を原点へ、底面を Z=0 へ、寸法をカタログ値へ合わせる。

    アプリが w/d/h へスケールする前提なので、ここがズレるとその比率のまま
    現物の寸法が狂う。葉が枝より外へはみ出すぶん、生成後に測って直す。
    """
    vs = obj.data.vertices
    xs = [v.co.x for v in vs]
    ys = [v.co.y for v in vs]
    zs = [v.co.z for v in vs]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    s_xy = min(target_w / (max(xs) - min(xs)), target_d / (max(ys) - min(ys)))
    s_z = target_h / (max(zs) - min(zs))
    z0 = min(zs)
    for v in vs:
        v.co.x = (v.co.x - cx) * s_xy
        v.co.y = (v.co.y - cy) * s_xy
        v.co.z = (v.co.z - z0) * s_z
    obj.data.update()


# ── 庭木(アオダモ/シマトネリコ風の株立ち) ──────────────────────
def add_sprig(bm, origin, direction, mat_index, leaflets, rng):
    """羽状複葉1本ぶん。短い葉軸に沿って小葉を左右交互に並べる。

    葉を1枚の大きな板で表すと団子になる。小葉に割って隙間を残すのが
    透け感の要。
    """
    f = direction.normalized()
    up = Vector((0, 0, 1))
    if abs(f.dot(up)) > 0.95:
        up = Vector((0, 1, 0))
    side = f.cross(up).normalized()
    nrm = side.cross(f).normalized()

    rachis = rng.uniform(0.15, 0.21)
    ll = rng.uniform(0.052, 0.068)   # 小葉の長さ/2
    lw = rng.uniform(0.022, 0.029)   # 小葉の幅/2
    for i in range(leaflets):
        u = (i // 2 + 1) / (leaflets / 2 + 1)
        sign = 1.0 if i % 2 == 0 else -1.0
        centre = (origin + f * (rachis * u) + side * sign * (lw + 0.012)
                  - nrm * (0.02 * u))
        tilt = rng.uniform(-0.5, 0.5)
        a = (f * math.cos(tilt) + side * sign * math.sin(tilt)).normalized()
        add_quad(bm, mat_index, centre, a, a.cross(nrm).normalized(), ll, lw)
    add_quad(bm, mat_index, origin + f * (rachis + ll * 0.8) - nrm * 0.02,
             f, side, ll, lw)


def build_tree():
    rng = random.Random(SEED)

    mats = [matp('TreeBark', '#6b5a45', rough=0.92),
            matp('TreeLeafDark', '#5c7a4d', rough=0.72),
            matp('TreeLeafMid', '#6f8f5f', rough=0.70),
            matp('TreeLeafLight', '#86a473', rough=0.66)]
    LEAF_MATS = [1, 2, 2, 3]          # 中間色を厚めに。明度差で葉の重なりを出す

    bm = bmesh.new()
    CROWN_R = 0.66
    branches = []
    golden = math.radians(137.5)
    bcount = 0                        # 枝の方位を黄金角で振って偏りを消す

    # 幹は3本。株立ちなので根元は1か所から出て上で開く。
    # 幹の頂点は3.0m より低く取り、残りは葉が埋める。
    stem_specs = [
        # (方位, 高さ, 根元半径, 開き, 位相)
        (math.radians(20), 2.82, 0.040, 0.26, 0.4),
        (math.radians(150), 2.46, 0.034, 0.32, 1.9),
        (math.radians(265), 2.10, 0.029, 0.36, 3.1),
    ]
    for az, height, base_r, lean, phase in stem_specs:
        bx, by = math.cos(az) * 0.085, math.sin(az) * 0.085
        n = 8
        pts, radii = [], []
        for i in range(n):
            t = i / (n - 1)
            # 下で外へ開き、上で立ちに戻る(株立ちの弓なり)
            off = lean * (1.35 * t ** 0.6 - 0.35 * t ** 2.4)
            wob = 0.055 * math.sin(t * 3.1 + phase)
            pts.append((bx + math.cos(az) * off
                        + math.cos(az + math.pi / 2) * wob * t,
                        by + math.sin(az) * off
                        + math.sin(az + math.pi / 2) * wob * t,
                        height * t))
            flare = 1.0 + 0.55 * max(0.0, 1.0 - t / 0.09) ** 2   # 根張り
            radii.append((base_r * (1.0 - t) ** 0.8 + 0.008) * flare)
        add_tube(bm, 0, pts, radii, 6)

        for b in range(7):
            t = 0.34 + 0.62 * (b + rng.uniform(0.15, 0.85)) / 7
            i = min(n - 2, int(t * (n - 1)))
            base = Vector(pts[i]).lerp(Vector(pts[i + 1]), t * (n - 1) - i)
            baz = golden * bcount + rng.uniform(-0.35, 0.35)
            bcount += 1
            elev = rng.uniform(0.55, 1.00)
            length = rng.uniform(0.34, 0.56) * (0.65 + 0.5 * (1.0 - t))
            horiz = math.cos(elev) * length
            tip = Vector((base.x + math.cos(baz) * horiz,
                          base.y + math.sin(baz) * horiz,
                          base.z + math.sin(elev) * length))
            # 枝先を楕円体の樹冠に収める。円柱で切ると寸胴に見える。
            k = (tip.z - 2.05) / 1.35
            envelope = CROWN_R * max(0.40, (1.0 - min(1.0, k * k)) ** 0.35)
            flat = Vector((tip.x, tip.y, 0.0))
            if flat.length > envelope:
                flat = flat.normalized() * envelope
                tip = Vector((flat.x, flat.y, tip.z))
            mid = base.lerp(tip, 0.5) + Vector((0, 0, 0.045))
            br = 0.016 * (1.0 - 0.4 * t)
            add_tube(bm, 0, [base, mid, tip], [br, br * 0.65, 0.005], 4)
            branches.append((base, tip))

    for base, tip in branches:
        along = tip - base
        for s in range(8):
            origin = base + along * (0.30 + 0.80 * s / 8)
            # 枝線上に並べず周囲の体積へ散らす。線に沿うと筋に見える。
            origin += Vector((rng.uniform(-.13, .13), rng.uniform(-.13, .13),
                              rng.uniform(-.10, .10)))
            d = along.normalized()
            d = Vector((d.x + rng.uniform(-.7, .7),
                        d.y + rng.uniform(-.7, .7),
                        d.z + rng.uniform(-.6, .3))).normalized()
            add_sprig(bm, origin, d, LEAF_MATS[rng.randrange(4)], 5, rng)

    obj = new_object('GardenTree', bm, mats)
    normalize_to(obj, 1.5, 1.5, 3.0)
    return obj


# ── ウッドデッキ ──────────────────────────────────────────────
def build_deck():
    W, D, H = 2.6, 0.9, 0.45
    BOARD_T, GAP, N_BOARDS = 0.030, 0.005, 22
    board_w = (W - GAP * (N_BOARDS - 1)) / N_BOARDS   # 113.4mm(呼び115mm)

    mats = [matp('DeckWoodA', '#8B5E3C', rough=0.80),
            matp('DeckWoodB', '#7d5335', rough=0.82),
            matp('DeckWoodC', '#96684a', rough=0.78),
            matp('DeckFrame', '#6d4a30', rough=0.88),
            matp('DeckFooting', '#9a9a97', rough=0.95)]
    TONES = [0, 1, 2, 0, 2, 1, 0, 1]                  # 板ごとの色ムラ

    bm = bmesh.new()
    z_top, z_bot = H, H - BOARD_T

    # 床板: 奥行方向(Y)に張り、幅方向(X)へ22枚並べる
    for i in range(N_BOARDS):
        x0 = -W / 2 + i * (board_w + GAP)
        add_plank_y(bm, TONES[i % len(TONES)], x0, x0 + board_w,
                    -D / 2, D / 2, z_bot, z_top, 0.004)

    # 根太: 幅方向に通す。幕板より背を高くして下端を覗かせる
    JOIST_H, JOIST_W = 0.120, 0.045
    jz0 = z_bot - JOIST_H
    for y in (-0.33, 0.0, 0.33):
        add_box(bm, 3, (-W / 2 + 0.02, y - JOIST_W / 2, jz0),
                (W / 2 - 0.02, y + JOIST_W / 2, z_bot))

    # 束と束石
    POST, FOOT, FOOT_H = 0.090, 0.130, 0.045
    for x in (-1.10, -0.37, 0.37, 1.10):
        for y in (-0.33, 0.33):
            add_box(bm, 4, (x - FOOT / 2, y - FOOT / 2, 0.0),
                    (x + FOOT / 2, y + FOOT / 2, FOOT_H))
            add_box(bm, 3, (x - POST / 2, y - POST / 2, FOOT_H),
                    (x + POST / 2, y + POST / 2, jz0))

    # 幕板: 前面と両側面。床板より内側へ引っ込めて陰の線を作る
    # (背面は建物側なので張らない。下から根太が見える)
    FT, INSET = 0.018, 0.014
    fz0 = z_bot - 0.090
    fx, fy = W / 2 - INSET, D / 2 - INSET
    add_box(bm, 3, (-fx, -fy, fz0), (fx, -fy + FT, z_bot))
    add_box(bm, 3, (-fx, -fy, fz0), (-fx + FT, D / 2, z_bot))
    add_box(bm, 3, (fx - FT, -fy, fz0), (fx, D / 2, z_bot))

    obj = new_object('WoodDeck', bm, mats)
    normalize_to(obj, W, D, H)
    return obj


# ── 書き出し ──────────────────────────────────────────────────
def export(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_apply=True, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False, export_texture_dir='')
    return os.path.getsize(path)


# ── アイコン(2D平面図の上面図 / ライブラリのサムネ) ──────────────
def _icon_scene(keep, res=512):
    """前のパスで足したカメラ/ライトを片付けて、背景透過で撮り直す。"""
    bpy.ops.object.select_all(action='DESELECT')
    for ob in list(bpy.context.scene.objects):
        if ob is not keep:
            ob.select_set(True)
    bpy.ops.object.delete(use_global=False)

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    world = bpy.data.worlds.new('IconWorld')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs[1].default_value = 1.5
    return scene


def _sun(energy, rot, loc):
    bpy.ops.object.light_add(type='SUN', location=loc)
    s = bpy.context.active_object
    s.data.energy = energy
    s.data.angle = math.radians(28)
    s.rotation_euler = rot


def render_top(obj, path):
    """平面図用。真上から正射投影。画面の上=+Y(平面図の上)に合わせる。"""
    scene = _icon_scene(obj)
    _sun(3.0, (math.radians(14), 0, math.radians(30)), (1.5, -1.5, 8))
    dx, dy, dz = obj.dimensions
    bpy.ops.object.camera_add(location=(0, 0, dz + 4.0), rotation=(0, 0, 0))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(dx, dy) * 1.06
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_thumb(obj, path):
    scene = _icon_scene(obj)
    _sun(3.4, (math.radians(50), 0, math.radians(35)), (3, -4, 6))
    dx, dy, dz = obj.dimensions
    span = max(dx, dy, dz)
    dist = span * 1.9
    bpy.ops.object.camera_add(
        location=(dist * 0.62, -dist * 0.95, dz * 0.78 + span * 0.35))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = span * 1.18
    scene.camera = cam
    cam.constraints.new('TRACK_TO')
    bpy.ops.object.empty_add(location=(0, 0, dz * 0.45))
    cam.constraints[0].target = bpy.context.active_object
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main(do_export=True, do_icons=True):
    made = []
    for stem, builder in (('garden_tree', build_tree),
                          ('wood_deck', build_deck)):
        clear_scene()
        obj = builder()
        d = obj.dimensions
        line = '  %-12s tris=%-5d %.3f x %.3f x %.3f m' % (
            stem, tri_count(obj), d.x, d.y, d.z)
        if do_export:
            size = export(obj, os.path.join(OUT_DIR, stem + '.glb'))
            line += '  glb=%d bytes' % size
        print(line)
        if do_icons:
            render_top(obj, os.path.join(OUT_DIR, stem + '_top.png'))
            render_thumb(obj, os.path.join(OUT_DIR, stem + '_thumb.png'))
        made.append(obj)
    return made


if __name__ == '__main__':
    main(do_export='--no-export' not in sys.argv,
         do_icons='--no-icons' not in sys.argv)
