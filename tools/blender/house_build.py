import bpy, bmesh, math

def matp(name, color, rough=0.8, metal=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m

def raw_box(mat, x, y, z, sx, sy, sz):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    ob = bpy.context.object
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if mat: ob.data.materials.append(mat)
    return ob

def cut(wall, x, y, z, sx, sy, sz):
    c = raw_box(None, x, y, z, sx, sy, sz)
    boo = wall.modifiers.new('C', 'BOOLEAN')
    boo.operation = 'DIFFERENCE'; boo.object = c
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier=boo.name)
    bpy.data.objects.remove(c, do_unlink=True)

def join_group(name, obs):
    obs = [o for o in obs if o]
    if not obs: return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob

for ob in list(bpy.data.objects):
    if ob.name.startswith(('nh_', 'bdprev_')):
        bpy.data.objects.remove(ob, do_unlink=True)

import random
def make_siding_image(name, base, groove_mul=0.72):
    img = bpy.data.images.get(name)
    if img: bpy.data.images.remove(img)
    N = 256
    img = bpy.data.images.new(name, N, N, alpha=False)
    planks = 4
    ph = N // planks
    rng = random.Random(42)
    tones = [1.0 + rng.uniform(-0.045, 0.045) for _ in range(planks)]
    px = [0.0] * (N * N * 4)
    for y in range(N):
        plank = min(planks - 1, y // ph)
        inplank = y % ph
        tone = tones[plank]
        # 目地(プランク境界の3px)と水切り陰(境界上1px明)
        if inplank < 3:
            tone *= groove_mul
        elif inplank == 3:
            tone *= 1.06
        rowjit = 1.0 + rng.uniform(-0.012, 0.012)
        for x in range(N):
            i = (y * N + x) * 4
            g = tone * rowjit * (1.0 + rng.uniform(-0.008, 0.008))
            px[i] = min(1.0, base[0] * g)
            px[i+1] = min(1.0, base[1] * g)
            px[i+2] = min(1.0, base[2] * g)
            px[i+3] = 1.0
    img.pixels = px
    img.pack()
    return img

def make_siding_mat(name, base, groove_mul=0.72):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE': nt.nodes.remove(n)
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = make_siding_image(name + 'Img', base, groove_mul)
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9
    b.inputs['Metallic'].default_value = 0.0
    return m

WALL  = make_siding_mat('NhWall',  (0.88, 0.86, 0.80))
WALL2 = make_siding_mat('NhWall2', (0.58, 0.55, 0.50), groove_mul=0.78)
TRIMD = matp('NhTrim',  (0.28, 0.27, 0.26), rough=0.8)
SASH  = matp('NhSash',  (0.70, 0.71, 0.73), rough=0.35, metal=0.8)
GLASS = matp('NhGlass', (0.30, 0.42, 0.53), rough=0.06, metal=0.25)
FGLASS= matp('NhGlassFrost', (0.66, 0.71, 0.74), rough=0.45, metal=0.0)
DOOR  = matp('NhDoor',  (0.33, 0.21, 0.12), rough=0.55)
def make_slate_image(name, base):
    img = bpy.data.images.get(name)
    if img: bpy.data.images.remove(img)
    N = 256
    img = bpy.data.images.new(name, N, N, alpha=False)
    rows = 6          # 段/タイル → cube_project 2.7m で455mmピッチ
    rh = N // rows
    rng = random.Random(11)
    tones = [1.0 + rng.uniform(-0.06, 0.06) for _ in range(rows)]
    px = [0.0] * (N * N * 4)
    for y in range(N):
        row = min(rows - 1, y // rh)
        inrow = y % rh
        tone = tones[row]
        if inrow < 2:
            tone *= 0.55      # 段の影
        elif inrow < 4:
            tone *= 1.15      # 段鼻のハイライト
        for x in range(N):
            i = (y * N + x) * 4
            g = tone * (1.0 + rng.uniform(-0.02, 0.02))
            px[i]   = min(1.0, base[0] * g)
            px[i+1] = min(1.0, base[1] * g)
            px[i+2] = min(1.0, base[2] * g)
            px[i+3] = 1.0
    img.pixels = px
    img.pack()
    return img

def make_slate_mat(name, base):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE': nt.nodes.remove(n)
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = make_slate_image(name + 'Img', base)
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.7
    b.inputs['Metallic'].default_value = 0.0
    return m
ROOF  = make_slate_mat('NhRoof', (0.20, 0.195, 0.215))
FASCIA= matp('NhFascia',(0.82, 0.82, 0.80), rough=0.7)
RAIL  = matp('NhRail',  (0.60, 0.60, 0.62), rough=0.4, metal=0.6)

FW, FD, SH = 5.2, 3.6, 2.7
ROOF_H, OVER = 1.05, 0.40
NICHE = 0.13   # 開口の彫り込み深さ

OPENINGS = {}
def reg_open(face, u, z, w, h):
    OPENINGS.setdefault(face, []).append((u - w/2 - 0.06, u + w/2 + 0.06, z - 0.06, z + h + 0.06))

def line_segments(face, zz, lo, hi):
    segs = [(lo, hi)]
    for (u0, u1, zl, zh) in OPENINGS.get(face, []):
        if not (zl <= zz <= zh):
            continue
        out = []
        for (a, b) in segs:
            if u1 <= a or u0 >= b:
                out.append((a, b))
            else:
                if u0 > a: out.append((a, u0))
                if u1 < b: out.append((u1, b))
        segs = out
    return [(a, b) for (a, b) in segs if b - a > 0.08]

def siding_lines(store, z0, z1):
    zz = z0
    while zz < z1 - 0.05:
        for (a, b) in line_segments('f', zz, -FW/2 + 0.01, FW/2 - 0.01):
            store.append(raw_box(TRIMD, (a+b)/2, -FD/2 - 0.005, zz, b - a, 0.010, 0.013))
        for (a, b) in line_segments('b', zz, -FW/2 + 0.01, FW/2 - 0.01):
            store.append(raw_box(TRIMD, (a+b)/2, FD/2 + 0.005, zz, b - a, 0.010, 0.013))
        for (a, b) in line_segments('l', zz, -FD/2 + 0.01, FD/2 - 0.01):
            store.append(raw_box(TRIMD, -FW/2 - 0.005, (a+b)/2, zz, 0.010, b - a, 0.013))
        for (a, b) in line_segments('r', zz, -FD/2 + 0.01, FD/2 - 0.01):
            store.append(raw_box(TRIMD, FW/2 + 0.005, (a+b)/2, zz, 0.010, b - a, 0.013))
        zz += 0.45

def corner_boards(store, h):
    for sx in (-1, 1):
        for sy in (-1, 1):
            store.append(raw_box(FASCIA, sx*(FW/2 - 0.001), sy*(FD/2 - 0.001), h/2, 0.09, 0.09, h))

def window(wall, frames, glasses, sills, face, u, z, w, h, mullion='cross', frosted=False):
    """壁に開口を彫り、サッシ・ガラス・方立を開口内(壁面より奥)に納める"""
    fr = 0.05
    reg_open(face, u, z, w, h)
    if face in ('f', 'b'):
        sgn = -1 if face == 'f' else 1
        wallface = sgn * FD/2
        # 開口(壁面から NICHE 奥まで)
        cut(wall, u, wallface + sgn*(-NICHE/2 + 0.1*sgn*sgn), z + h/2, w, NICHE + 0.2, h)
        # ↑ cutter: 壁面の外側0.2m〜内側NICHEまで貫入
        inner = wallface - sgn*NICHE
        fy = inner + sgn*0.055     # サッシ面(壁面より奥)
        gy = inner + sgn*0.030
        # 4辺フレーム(枠のみ、中はガラス)
        frames.append(raw_box(SASH, u, fy, z + fr/2, w - 0.015, 0.06, fr))
        frames.append(raw_box(SASH, u, fy, z + h - fr/2, w - 0.015, 0.06, fr))
        frames.append(raw_box(SASH, u - w/2 + fr/2, fy, z + h/2, fr, 0.06, h - 0.015))
        frames.append(raw_box(SASH, u + w/2 - fr/2, fy, z + h/2, fr, 0.06, h - 0.015))
        glasses.append(raw_box(FGLASS if frosted else GLASS, u, gy, z + h/2, w - fr*1.2, 0.02, h - fr*1.2))
        # 召合せ框(引き違いの中央縦)
        frames.append(raw_box(SASH, u, fy, z + h/2, 0.035, 0.065, h - fr))
        if mullion == 'cross':
            frames.append(raw_box(SASH, u, fy, z + h*0.62, w - fr, 0.065, 0.035))
        sills.append(raw_box(FASCIA, u, wallface + sgn*0.025, z - 0.028, w + 0.10, 0.10, 0.045))
    else:
        sgn = -1 if face == 'l' else 1
        wallface = sgn * FW/2
        cut(wall, wallface - sgn*NICHE/2 + sgn*0.1, u, z + h/2, NICHE + 0.2, w, h)
        inner = wallface - sgn*NICHE
        fx = inner + sgn*0.055
        gx = inner + sgn*0.030
        frames.append(raw_box(SASH, fx, u, z + fr/2, 0.06, w - 0.015, fr))
        frames.append(raw_box(SASH, fx, u, z + h - fr/2, 0.06, w - 0.015, fr))
        frames.append(raw_box(SASH, fx, u - w/2 + fr/2, z + h/2, 0.06, fr, h - 0.015))
        frames.append(raw_box(SASH, fx, u + w/2 - fr/2, z + h/2, 0.06, fr, h - 0.015))
        glasses.append(raw_box(FGLASS if frosted else GLASS, gx, u, z + h/2, 0.02, w - fr*1.2, h - fr*1.2))
        frames.append(raw_box(SASH, fx, u, z + h/2, 0.065, 0.035, h - fr))
        if mullion == 'cross':
            frames.append(raw_box(SASH, fx, u, z + h*0.62, 0.065, w - fr, 0.035))
        sills.append(raw_box(FASCIA, wallface + sgn*0.025, u, z - 0.028, 0.10, w + 0.10, 0.045))

# ============ BASE (1F) ============
def uv_project(ob, size=1.8):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=size, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

GARA  = matp('NhGarage', (0.24, 0.24, 0.25), rough=0.92)
GARAF = matp('NhGarageFloor', (0.38, 0.38, 0.37), rough=0.95)
wall = raw_box(WALL2, 0, 0, SH/2, FW, FD, SH)
frames, glasses, sills, trims = [], [], [], []
# 掃き出し窓(正面左)
window(wall, frames, glasses, sills, 'f', -0.35, 0.90, 0.60, 1.10, 'none')
window(wall, frames, glasses, sills, 'l', 0.55, 0.03, 1.65, 2.03, 'v')
window(wall, frames, glasses, sills, 'r', 0.05, 0.90, 1.65, 1.10)
window(wall, frames, glasses, sills, 'b', -FW*0.18, 0.90, 1.65, 1.10)
window(wall, frames, glasses, sills, 'b', FW*0.25, 1.10, 0.60, 0.90, 'none', frosted=True)
# 玄関(掃き出し窓とガレージの間): 開口を彫って奥にドアを納める
px = -1.55
reg_open('f', px, 0.0, 1.06, 2.36)
cut(wall, px, -FD/2 - 0.1 + NICHE/2 + 0.001, 1.18, 1.06, NICHE + 0.2, 2.36)
inner = -FD/2 + NICHE
frames.append(raw_box(SASH, px, inner + 0.02, 1.17, 1.00, 0.05, 2.34))
d = raw_box(DOOR, px, inner + 0.045, 1.165, 0.87, 0.045, 2.30)
glasses.append(raw_box(GLASS, px - 0.26, inner + 0.075, 1.40, 0.13, 0.02, 1.55))
# 鏡板ライン(縦2本の浅い段差)
DOORD = matp('NhDoorDark', (0.26, 0.16, 0.09), rough=0.6)
trims.append(raw_box(DOORD, px + 0.06, inner + 0.070, 1.40, 0.02, 0.006, 1.60))
trims.append(raw_box(DOORD, px + 0.28, inner + 0.070, 1.40, 0.02, 0.006, 1.60))
frames.append(raw_box(SASH, px + 0.30, inner + 0.08, 1.05, 0.03, 0.03, 0.30))
trims.append(raw_box(TRIMD, px, -FD/2 - 0.14, 0.045, 1.16, 0.30, 0.09))
trims.append(raw_box(TRIMD, px, -FD/2 - 0.22, 2.46, 1.22, 0.58, 0.055))
trims.append(raw_box(TRIMD, px - 0.56, -FD/2 - 0.09, 2.34, 0.05, 0.24, 0.05))
trims.append(raw_box(TRIMD, px + 0.56, -FD/2 - 0.09, 2.34, 0.05, 0.24, 0.05))
# ── インナーガレージ(正面右): 車が入る貫通開口 ──
GX, GW, GH_, GD = 1.38, 2.20, 2.20, FD - 0.15   # 中心x, 幅, 高さ, 奥行(奥壁0.15残し)
reg_open('f', GX, 0.0, GW, GH_ + 0.15)
cut(wall, GX, -FD/2 + GD/2 - 0.101, GH_/2 + 0.02, GW, GD + 0.2, GH_)
gz0 = -FD/2 + GD   # 奥壁の内面y
# 内装ライナー(暗色): 奥壁・左右壁・天井
garas = []
GARA2 = matp('NhGarageDeep', (0.12, 0.12, 0.13), rough=0.95)
LIGHTB= matp('NhGarageLight', (0.85, 0.86, 0.82), rough=0.4)
garas.append(raw_box(GARA2, GX, gz0 - 0.015, GH_/2 + 0.02, GW - 0.02, 0.03, GH_ - 0.02))
# 天井ライン照明
garas.append(raw_box(LIGHTB, GX, -FD/2 + GD*0.45, GH_ - 0.04, 0.10, 1.20, 0.04))
# 奥壁の物置棚
garas.append(raw_box(GARA, GX + GW*0.28, gz0 - 0.20, 0.95, 0.90, 0.35, 1.80))
garas.append(raw_box(GARA, GX - GW/2 + 0.015, -FD/2 + GD/2, GH_/2 + 0.02, 0.03, GD - 0.04, GH_ - 0.02))
garas.append(raw_box(GARA, GX + GW/2 - 0.015, -FD/2 + GD/2, GH_/2 + 0.02, 0.03, GD - 0.04, GH_ - 0.02))
garas.append(raw_box(GARA, GX, -FD/2 + GD/2, GH_ + 0.005, GW - 0.02, GD - 0.04, 0.03))
# 土間床(コンクリート)
garas.append(raw_box(GARAF, GX, -FD/2 + GD/2 - 0.05, 0.015, GW - 0.02, GD + 0.10, 0.03))
# シャッターボックス(開口内上部)+ガイドレール
garas.append(raw_box(SASH, GX, -FD/2 + 0.15, GH_ - 0.14, GW - 0.03, 0.28, 0.26))
garas.append(raw_box(SASH, GX - GW/2 + 0.03, -FD/2 + 0.10, GH_/2, 0.05, 0.18, GH_ - 0.05))
garas.append(raw_box(SASH, GX + GW/2 - 0.03, -FD/2 + 0.10, GH_/2, 0.05, 0.18, GH_ - 0.05))
# 開口まわりの額縁
frames.append(raw_box(SASH, GX, -FD/2 - 0.02, GH_ + 0.06, GW + 0.22, 0.07, 0.12))
frames.append(raw_box(SASH, GX - GW/2 - 0.05, -FD/2 - 0.02, GH_/2 + 0.02, 0.10, 0.07, GH_ + 0.04))
frames.append(raw_box(SASH, GX + GW/2 + 0.05, -FD/2 - 0.02, GH_/2 + 0.02, 0.10, 0.07, GH_ + 0.04))
# 基礎水切り(ガレージ開口部を除く分割配置)
plinth_z, plinth_h = 0.10, 0.20
seg_l0, seg_l1 = -FW/2 - 0.05, GX - GW/2 - 0.10
seg_r0, seg_r1 = GX + GW/2 + 0.10, FW/2 + 0.05
trims.append(raw_box(TRIMD, (seg_l0+seg_l1)/2, -FD/2 - 0.025, plinth_z, seg_l1 - seg_l0, 0.05, plinth_h))
trims.append(raw_box(TRIMD, (seg_r0+seg_r1)/2, -FD/2 - 0.025, plinth_z, seg_r1 - seg_r0, 0.05, plinth_h))
trims.append(raw_box(TRIMD, 0, FD/2 + 0.025, plinth_z, FW + 0.10, 0.05, plinth_h))
trims.append(raw_box(TRIMD, -FW/2 - 0.025, 0, plinth_z, 0.05, FD + 0.10, plinth_h))
trims.append(raw_box(TRIMD, FW/2 + 0.025, 0, plinth_z, 0.05, FD + 0.10, plinth_h))
corner_boards(trims, SH)
wall.name = 'nh_base_wall'
uv_project(wall)
join_group('nh_base_trim', trims)
join_group('nh_base_sash', frames)
join_group('nh_base_glass', glasses)
join_group('nh_base_sill', sills)
join_group('nh_base_garage', garas)
d.name = 'nh_base_door'
# 竪樋(front-right / back-left)
def add_pipe_column(prefix, height):
    pipes = []
    for (ppx, ppy) in ((-FW/2 + 0.14, -FD/2 - 0.075), (FW/2 - 0.14, -FD/2 - 0.075), (-FW/2 + 0.34, FD/2 + 0.075)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.035, depth=height, location=(ppx, ppy, height/2))
        c = bpy.context.object
        c.data.materials.append(RAIL)
        pipes.append(c)
    return pipes
join_group('nh_base_pipe', add_pipe_column('base', SH))

# ============ MID (2F) ============
OPENINGS.clear()
wall = raw_box(WALL, 0, 0, SH/2, FW, FD, SH)
frames, glasses, sills, trims, rails = [], [], [], [], []
# バルコニーに面した掃き出し窓(正面中央左)
bx = -FW*0.10
window(wall, frames, glasses, sills, 'f', bx, 0.03, 1.65, 2.03, 'v')
window(wall, frames, glasses, sills, 'f', FW*0.36, 0.90, 0.60, 1.10, 'none', frosted=True)
window(wall, frames, glasses, sills, 'l', 0.10, 0.90, 1.65, 1.10)
window(wall, frames, glasses, sills, 'r', -0.15, 0.90, 1.65, 1.10)
window(wall, frames, glasses, sills, 'b', -FW*0.20, 0.90, 1.65, 1.10)
window(wall, frames, glasses, sills, 'b', FW*0.22, 0.90, 1.65, 1.10)
trims.append(raw_box(TRIMD, 0, 0, 0.05, FW + 0.08, FD + 0.08, 0.10))
corner_boards(trims, SH)
# バルコニー: 幅1820・持ち出し650mm・手すり壁H1100+アルミ笠木。
# アプリ側でフットプリントに比例させず実寸を保てるよう、独立ノード
# nh_balc(原点=取付壁面・階床レベル)としてエクスポートする
bw, bdp = 1.82, 0.65
balc = []
balc.append(raw_box(FASCIA, bx, -FD/2 - bdp/2, 0.07, bw, bdp, 0.14))
WALLP = 0.075
balc.append(raw_box(WALL, bx, -FD/2 - bdp + WALLP/2, 0.62, bw, WALLP, 1.10))
balc.append(raw_box(WALL, bx - bw/2 + WALLP/2, -FD/2 - bdp/2 - 0.02, 0.62, WALLP, bdp - 0.04, 1.10))
balc.append(raw_box(WALL, bx + bw/2 - WALLP/2, -FD/2 - bdp/2 - 0.02, 0.62, WALLP, bdp - 0.04, 1.10))
KASA = 0.04
balc.append(raw_box(RAIL, bx, -FD/2 - bdp + WALLP/2, 1.19, bw + 0.03, WALLP + 0.03, KASA))
balc.append(raw_box(RAIL, bx - bw/2 + WALLP/2, -FD/2 - bdp/2 - 0.02, 1.19, WALLP + 0.03, bdp - 0.02, KASA))
balc.append(raw_box(RAIL, bx + bw/2 - WALLP/2, -FD/2 - bdp/2 - 0.02, 1.19, WALLP + 0.03, bdp - 0.02, KASA))
balc.append(raw_box(TRIMD, bx, -FD/2 - bdp/2, -0.005, bw + 0.02, bdp + 0.02, 0.02))
balc_main = join_group('nh_balc_main', balc)
balc_empty = bpy.data.objects.get('nh_balc')
if balc_empty:
    bpy.data.objects.remove(balc_empty, do_unlink=True)
balc_empty = bpy.data.objects.new('nh_balc', None)
bpy.context.scene.collection.objects.link(balc_empty)
balc_empty.location = (bx, -FD/2, 0)
# 頂点データをアンカー(取付壁面・階床)基準のローカル座標へベイクする。
# オブジェクト変換に頼ると glTF エクスポート時に二重変位するため、
# メッシュ自体をローカル化し、子のローカル変換はゼロにする
import mathutils
balc_main.data.transform(mathutils.Matrix.Translation((-bx, FD/2, 0)) @ balc_main.matrix_world)
balc_main.matrix_world = mathutils.Matrix.Identity(4)
balc_main.parent = balc_empty
balc_main.matrix_parent_inverse.identity()
balc_main.location = (0, 0, 0)
wall.name = 'nh_mid_wall'
uv_project(wall)
join_group('nh_mid_trim', trims)
join_group('nh_mid_sash', frames)
join_group('nh_mid_glass', glasses)
join_group('nh_mid_sill', sills)
join_group('nh_mid_rail', rails)
vents = []
for (vx, vy, vz, rx, ry_) in ((FW*0.42, -FD/2 - 0.03, 2.15, math.radians(90), 0), (-FW*0.30, FD/2 + 0.03, 2.15, math.radians(90), 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.075, depth=0.06, location=(vx, vy, vz), rotation=(rx, ry_, 0))
    vc = bpy.context.object
    vc.data.materials.append(RAIL)
    vents.append(vc)
join_group('nh_mid_vent', vents)
join_group('nh_mid_pipe', add_pipe_column('mid', SH))

# ============ ROOF ============
me = bpy.data.meshes.new('nh_roof_mesh')
bm = bmesh.new()
hw, hd = FW/2 + OVER, FD/2 + OVER
ridge_half = max(0.0, (FW - FD) / 2)
b0 = bm.verts.new((-hw, -hd, 0)); b1 = bm.verts.new((hw, -hd, 0))
b2 = bm.verts.new((hw, hd, 0));  b3 = bm.verts.new((-hw, hd, 0))
t0 = bm.verts.new((-ridge_half, 0, ROOF_H)); t1 = bm.verts.new((ridge_half, 0, ROOF_H))
bm.faces.new((b0, b1, t1, t0))
bm.faces.new((b2, b3, t0, t1))
bm.faces.new((b1, b2, t1))
bm.faces.new((b3, b0, t0))
bm.faces.new((b3, b2, b1, b0))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me); bm.free()
rob = bpy.data.objects.new('nh_roof_hip', me)
bpy.context.scene.collection.objects.link(rob)
rob.data.materials.append(ROOF)
sol = rob.modifiers.new('Sol', 'SOLIDIFY'); sol.thickness = 0.10; sol.offset = 1
bpy.context.view_layer.objects.active = rob
bpy.ops.object.modifier_apply(modifier=sol.name)
uv_project(rob, size=2.7)
# 隅棟の棟包み(4本の斜めボックス)
hips = []
for (cx, cy, tx) in ((-hw, -hd, -ridge_half), (hw, -hd, ridge_half), (hw, hd, ridge_half), (-hw, hd, -ridge_half)):
    dx, dy, dz = tx - cx, 0 - cy, ROOF_H - 0
    ln = math.sqrt(dx*dx + dy*dy + dz*dz)
    mx, my, mz = (cx + tx)/2, cy/2, ROOF_H/2 + 0.06
    ang_z = math.atan2(dy, dx)
    ang_y = -math.asin(dz / ln)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(mx, my, mz), rotation=(0, ang_y, ang_z))
    hb = bpy.context.object
    hb.scale = (ln + 0.10, 0.16, 0.055)
    bpy.ops.object.transform_apply(scale=True)
    hb.data.materials.append(TRIMD)
    hips.append(hb)
join_group('nh_roof_hipcap', hips)
rtrims = []
rtrims.append(raw_box(FASCIA, 0, 0, -0.09, FW + OVER*2 - 0.04, FD + OVER*2 - 0.04, 0.18))
for sgn in (-1, 1):
    rtrims.append(raw_box(RAIL, 0, sgn*(FD/2 + OVER + 0.045), 0.02, FW + OVER*2 + 0.05, 0.11, 0.12))
    rtrims.append(raw_box(RAIL, sgn*(FW/2 + OVER + 0.045), 0, 0.02, 0.11, FD + OVER*2 + 0.05, 0.12))
join_group('nh_roof_eave', rtrims)
caps = [raw_box(TRIMD, 0, 0, ROOF_H + 0.035, ridge_half*2 + 0.28, 0.26, 0.09)]
join_group('nh_roof_cap', caps)
elbows = []
for (ppx, ppy, sgn) in ((-FW/2 + 0.14, -FD/2 - 0.075, -1), (FW/2 - 0.14, -FD/2 - 0.075, -1), (-FW/2 + 0.34, FD/2 + 0.075, 1)):
    gy = sgn * (FD/2 + OVER + 0.035)
    elbows.append(raw_box(RAIL, ppx, (gy + ppy)/2, -0.02, 0.055, abs(gy - ppy), 0.05))
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.035, depth=0.16, location=(ppx, ppy, -0.08))
    c = bpy.context.object
    c.data.materials.append(RAIL)
    elbows.append(c)
join_group('nh_roof_pipe', elbows)

print('HOUSE3_OK', len([o for o in bpy.data.objects if o.name.startswith('nh_')]))
