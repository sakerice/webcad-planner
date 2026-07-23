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
SASH  = matp('NhSash',  (0.13, 0.14, 0.16), rough=0.45, metal=0.5)
GLASS = matp('NhGlass', (0.36, 0.48, 0.58), rough=0.06, metal=0.2)
DOOR  = matp('NhDoor',  (0.33, 0.21, 0.12), rough=0.55)
ROOF  = matp('NhRoof',  (0.16, 0.155, 0.17), rough=0.65)
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

def window(wall, frames, glasses, sills, face, u, z, w, h, mullion='cross'):
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
        gy = inner + sgn*0.035
        frames.append(raw_box(SASH, u, fy, z + h/2, w - 0.015, 0.06, h - 0.015))
        glasses.append(raw_box(GLASS, u, gy, z + h/2, w - fr*2, 0.02, h - fr*2))
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
        gx = inner + sgn*0.035
        frames.append(raw_box(SASH, fx, u, z + h/2, 0.06, w - 0.015, h - 0.015))
        glasses.append(raw_box(GLASS, gx, u, z + h/2, 0.02, w - fr*2, h - fr*2))
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

GARA  = matp('NhGarage', (0.30, 0.30, 0.31), rough=0.9)
GARAF = matp('NhGarageFloor', (0.55, 0.55, 0.54), rough=0.95)
wall = raw_box(WALL2, 0, 0, SH/2, FW, FD, SH)
frames, glasses, sills, trims = [], [], [], []
# 掃き出し窓(正面左)
window(wall, frames, glasses, sills, 'f', -1.75, 0.03, 1.40, 2.00, 'v')
window(wall, frames, glasses, sills, 'l', 0.50, 0.95, 1.20, 1.05)
window(wall, frames, glasses, sills, 'r', 0.05, 0.95, 1.20, 1.05)
window(wall, frames, glasses, sills, 'b', -FW*0.18, 0.95, 1.40, 1.05)
window(wall, frames, glasses, sills, 'b', FW*0.25, 1.30, 0.55, 0.55, 'none')
# 玄関(掃き出し窓とガレージの間): 開口を彫って奥にドアを納める
px = -0.35
reg_open('f', px, 0.0, 1.10, 2.26)
cut(wall, px, -FD/2 - 0.1 + NICHE/2 + 0.001, 1.13, 1.10, NICHE + 0.2, 2.26)
inner = -FD/2 + NICHE
frames.append(raw_box(SASH, px, inner + 0.02, 1.12, 1.02, 0.05, 2.24))
d = raw_box(DOOR, px, inner + 0.045, 1.10, 0.86, 0.045, 2.18)
glasses.append(raw_box(GLASS, px - 0.25, inner + 0.075, 1.35, 0.13, 0.02, 1.40))
frames.append(raw_box(SASH, px + 0.29, inner + 0.08, 1.05, 0.03, 0.03, 0.30))
trims.append(raw_box(TRIMD, px, -FD/2 - 0.14, 0.045, 1.20, 0.30, 0.09))
trims.append(raw_box(TRIMD, px, -FD/2 - 0.22, 2.36, 1.26, 0.58, 0.055))
trims.append(raw_box(TRIMD, px - 0.58, -FD/2 - 0.09, 2.24, 0.05, 0.24, 0.05))
trims.append(raw_box(TRIMD, px + 0.58, -FD/2 - 0.09, 2.24, 0.05, 0.24, 0.05))
# ── インナーガレージ(正面右): 車が入る貫通開口 ──
GX, GW, GH_, GD = 1.30, 2.30, 2.25, FD - 0.15   # 中心x, 幅, 高さ, 奥行(奥壁0.15残し)
reg_open('f', GX, 0.0, GW, GH_ + 0.15)
cut(wall, GX, -FD/2 + GD/2 - 0.101, GH_/2 + 0.02, GW, GD + 0.2, GH_)
gz0 = -FD/2 + GD   # 奥壁の内面y
# 内装ライナー(暗色): 奥壁・左右壁・天井
garas = []
garas.append(raw_box(GARA, GX, gz0 - 0.015, GH_/2 + 0.02, GW - 0.02, 0.03, GH_ - 0.02))
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
    for (ppx, ppy) in ((-FW/2 + 0.14, -FD/2 - 0.075), (-FW/2 + 0.34, FD/2 + 0.075)):
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
window(wall, frames, glasses, sills, 'f', bx, 0.03, 1.80, 2.05, 'v')
window(wall, frames, glasses, sills, 'f', FW*0.36, 1.10, 0.75, 0.90)
window(wall, frames, glasses, sills, 'l', 0.10, 0.90, 1.20, 1.05)
window(wall, frames, glasses, sills, 'r', -0.15, 0.90, 1.20, 1.05)
window(wall, frames, glasses, sills, 'b', -FW*0.20, 0.90, 1.30, 1.05)
window(wall, frames, glasses, sills, 'b', FW*0.22, 0.90, 1.30, 1.05)
trims.append(raw_box(TRIMD, 0, 0, 0.05, FW + 0.08, FD + 0.08, 0.10))
corner_boards(trims, SH)
# バルコニー(掃き出し窓の正面、幅=窓+余裕)
bw, bdp, bz = 2.55, 0.85, 0.0
rails.append(raw_box(FASCIA, bx, -FD/2 - bdp/2, bz + 0.07, bw, bdp, 0.14))
rails.append(raw_box(RAIL, bx, -FD/2 - bdp + 0.03, bz + 1.10, bw, 0.05, 0.05))
rails.append(raw_box(RAIL, bx - bw/2 + 0.025, -FD/2 - bdp/2, bz + 1.10, 0.05, bdp - 0.05, 0.05))
rails.append(raw_box(RAIL, bx + bw/2 - 0.025, -FD/2 - bdp/2, bz + 1.10, 0.05, bdp - 0.05, 0.05))
nb = int(bw / 0.125)
for i in range(nb + 1):
    xx = bx - bw/2 + i * bw/nb
    rails.append(raw_box(RAIL, xx, -FD/2 - bdp + 0.03, bz + 0.62, 0.022, 0.022, 0.96))
for s in (-1, 1):
    for k in range(4):
        yy = -FD/2 - bdp + 0.03 + (k+1)*(bdp-0.06)/4
        rails.append(raw_box(RAIL, bx + s*(bw/2 - 0.025), yy, bz + 0.62, 0.022, 0.022, 0.96))
wall.name = 'nh_mid_wall'
uv_project(wall)
join_group('nh_mid_trim', trims)
join_group('nh_mid_sash', frames)
join_group('nh_mid_glass', glasses)
join_group('nh_mid_sill', sills)
join_group('nh_mid_rail', rails)
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
rtrims = []
rtrims.append(raw_box(FASCIA, 0, 0, -0.09, FW + OVER*2 - 0.04, FD + OVER*2 - 0.04, 0.18))
for sgn in (-1, 1):
    rtrims.append(raw_box(RAIL, 0, sgn*(FD/2 + OVER + 0.035), 0.02, FW + OVER*2 + 0.05, 0.09, 0.10))
join_group('nh_roof_eave', rtrims)
caps = [raw_box(TRIMD, 0, 0, ROOF_H + 0.035, ridge_half*2 + 0.28, 0.26, 0.09)]
join_group('nh_roof_cap', caps)
elbows = []
for (ppx, ppy, sgn) in ((-FW/2 + 0.14, -FD/2 - 0.075, -1), (-FW/2 + 0.34, FD/2 + 0.075, 1)):
    gy = sgn * (FD/2 + OVER + 0.035)
    elbows.append(raw_box(RAIL, ppx, (gy + ppy)/2, -0.02, 0.055, abs(gy - ppy), 0.05))
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.035, depth=0.16, location=(ppx, ppy, -0.08))
    c = bpy.context.object
    c.data.materials.append(RAIL)
    elbows.append(c)
join_group('nh_roof_pipe', elbows)

print('HOUSE3_OK', len([o for o in bpy.data.objects if o.name.startswith('nh_')]))
