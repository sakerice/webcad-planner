import bpy, math

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
    if not obs: return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob

for ob in list(bpy.data.objects):
    if ob.name.startswith('bd_'):
        bpy.data.objects.remove(ob, do_unlink=True)

PANEL = matp('BdPanel', (0.60, 0.61, 0.63), rough=0.85)
PANEL2= matp('BdPanelDark', (0.33, 0.35, 0.38), rough=0.85)
FRAME = matp('BdFrame', (0.13, 0.14, 0.16), rough=0.45, metal=0.55)
GLASS = matp('BdGlass', (0.38, 0.50, 0.60), rough=0.08, metal=0.25)
GLASSD= matp('BdGlassDoor', (0.30, 0.42, 0.50), rough=0.08, metal=0.25)
SPAN  = matp('BdSpandrel', (0.46, 0.48, 0.51), rough=0.8)
EQUIP = matp('BdEquip', (0.72, 0.71, 0.68), rough=0.85)
SIGN  = matp('BdSign', (0.23, 0.36, 0.52), rough=0.6)

FW, FD, SH = 5.2, 3.6, 2.7
PARA = 0.45

# ============ BASE ============
walls, frames, glasses, spans = [], [], [], []
# wall with recessed front bay: build as full box; the front glazing sits 0.12 inside
walls.append(raw_box(PANEL2, 0, 0.06, SH/2, FW, FD - 0.12, SH))
walls.append(raw_box(FRAME, 0, 0, 0.06, FW + 0.08, FD + 0.08, 0.12))
# recessed entrance: glass doors + sidelights set into front plane
ry = -FD/2 + 0.02   # recessed glazing plane
frames.append(raw_box(FRAME, 0, ry, 1.30, 2.00, 0.06, 2.50))
glasses.append(raw_box(GLASSD, -0.46, ry - 0.012, 1.25, 0.82, 0.05, 2.36))
glasses.append(raw_box(GLASSD, 0.46, ry - 0.012, 1.25, 0.82, 0.05, 2.36))
frames.append(raw_box(FRAME, 0, ry - 0.02, 1.25, 0.05, 0.06, 2.36))
for s in (-1, 1):  # door handles
    frames.append(raw_box(FRAME, s*0.16, ry - 0.055, 1.10, 0.03, 0.03, 0.55))
# shopfront glazing at wall plane each side of entrance, floor to 2.5
for sx in (-1.72, 1.72):
    frames.append(raw_box(FRAME, sx, -FD/2 - 0.02, 1.36, 1.55, 0.06, 2.42))
    glasses.append(raw_box(GLASS, sx, -FD/2 - 0.032, 1.33, 1.42, 0.05, 2.28))
    frames.append(raw_box(FRAME, sx, -FD/2 - 0.045, 1.33, 0.045, 0.05, 2.28))   # vertical mullion
    frames.append(raw_box(FRAME, sx, -FD/2 - 0.045, 0.72, 1.42, 0.05, 0.045))   # transom
# side windows: 開口を彫って奥に納める
wall0 = walls[0]
NICHE = 0.12
for sgn in (-1, 1):
    wf = sgn * FW/2
    cut(wall0, wf - sgn*NICHE/2 + sgn*0.1, 0.06, 1.55, NICHE + 0.2, 2.3, 1.5)
    inner = wf - sgn*NICHE
    frames.append(raw_box(FRAME, inner + sgn*0.05, 0.06, 1.55, 0.055, 2.28, 1.48))
    glasses.append(raw_box(GLASS, inner + sgn*0.03, 0.06, 1.55, 0.02, 2.16, 1.36))
    frames.append(raw_box(FRAME, inner + sgn*0.05, 0.06, 1.55, 0.06, 0.045, 1.36))
    frames.append(raw_box(FRAME, inner + sgn*0.05, 0.06 - 0.72, 1.55, 0.06, 0.045, 1.36))
    frames.append(raw_box(FRAME, inner + sgn*0.05, 0.06 + 0.72, 1.55, 0.06, 0.045, 1.36))
# canopy + sign band
spans.append(raw_box(FRAME, 0, -FD/2 - 0.42, 2.62, 2.75, 0.88, 0.07))
sign = raw_box(SIGN, 0, -FD/2 - 0.05, 2.95, FW - 0.35, 0.09, 0.42)
for k in range(4):  # abstract lettering blocks on sign
    frames.append(raw_box(FRAME, -1.35 + k*0.55, -FD/2 - 0.105, 2.95, 0.30, 0.02, 0.20))
join_group('bd_base_wall', walls)
join_group('bd_base_frame', frames)
join_group('bd_base_glass', glasses)
join_group('bd_base_span', spans)
sign.name = 'bd_base_sign'

# ============ MID ============
walls, frames, glasses, spans = [], [], [], []
# spandrel band bottom + wall band top, glazing strip 0.85..2.35 recessed
walls.append(raw_box(PANEL, 0, 0, 0.425, FW, FD, 0.85))
walls.append(raw_box(PANEL, 0, 0, SH - 0.175, FW, FD, 0.35))
spans.append(raw_box(SPAN, 0, 0, 0.14, FW + 0.06, FD + 0.06, 0.28))
# recessed glazing walls (inset 0.08)
gz0, gz1 = 0.85, SH - 0.35
gh = gz1 - gz0
IN = 0.10
walls.append(raw_box(PANEL2, 0, 0, gz0 + gh/2, FW - IN*2, FD - IN*2, gh))  # dark core behind glass
def band(face):
    if face in ('f', 'b'):
        sgn = -1 if face == 'f' else 1
        y = sgn * (FD/2 - IN + 0.02)
        glasses.append(raw_box(GLASS, 0, y, gz0 + gh/2, FW - 0.36, sgn*0.05, gh))
        frames.append(raw_box(FRAME, 0, y, gz0 + 0.025, FW - 0.30, 0.07, 0.05))
        frames.append(raw_box(FRAME, 0, y, gz1 - 0.025, FW - 0.30, 0.07, 0.05))
        nmul = 7
        for i in range(nmul + 1):
            xx = -(FW - 0.36)/2 + i * (FW - 0.36)/nmul
            frames.append(raw_box(FRAME, xx, y, gz0 + gh/2, 0.045, 0.07, gh))
        # top/bottom reveal panels bridging recess
        spans.append(raw_box(SPAN, 0, sgn*(FD/2 - IN/2), gz0 - 0.02, FW, IN, 0.06))
        spans.append(raw_box(SPAN, 0, sgn*(FD/2 - IN/2), gz1 + 0.02, FW, IN, 0.06))
    else:
        sgn = -1 if face == 'l' else 1
        x = sgn * (FW/2 - IN + 0.02)
        glasses.append(raw_box(GLASS, x, 0, gz0 + gh/2, sgn*0.05, FD - 0.36, gh))
        frames.append(raw_box(FRAME, x, 0, gz0 + 0.025, 0.07, FD - 0.30, 0.05))
        frames.append(raw_box(FRAME, x, 0, gz1 - 0.025, 0.07, FD - 0.30, 0.05))
        nmul = 5
        for i in range(nmul + 1):
            yy = -(FD - 0.36)/2 + i * (FD - 0.36)/nmul
            frames.append(raw_box(FRAME, x, yy, gz0 + gh/2, 0.07, 0.045, gh))
        spans.append(raw_box(SPAN, sgn*(FW/2 - IN/2), 0, gz0 - 0.02, IN, FD, 0.06))
        spans.append(raw_box(SPAN, sgn*(FW/2 - IN/2), 0, gz1 + 0.02, IN, FD, 0.06))
for f in ('f', 'b', 'l', 'r'):
    band(f)
# corner pilasters full height
for sx in (-1, 1):
    for sy in (-1, 1):
        walls.append(raw_box(PANEL, sx*(FW/2 - 0.10), sy*(FD/2 - 0.10), SH/2, 0.26, 0.26, SH))
join_group('bd_mid_wall', walls)
join_group('bd_mid_frame', frames)
join_group('bd_mid_glass', glasses)
join_group('bd_mid_span', spans)

# ============ TOP ============
walls, spans, equips = [], [], []
walls.append(raw_box(PANEL, 0, -FD/2 + 0.09, PARA/2, FW, 0.18, PARA))
walls.append(raw_box(PANEL, 0, FD/2 - 0.09, PARA/2, FW, 0.18, PARA))
walls.append(raw_box(PANEL, -FW/2 + 0.09, 0, PARA/2, 0.18, FD - 0.36, PARA))
walls.append(raw_box(PANEL, FW/2 - 0.09, 0, PARA/2, 0.18, FD - 0.36, PARA))
spans.append(raw_box(SPAN, 0, 0, PARA + 0.035, FW + 0.12, FD + 0.12, 0.07))
spans.append(raw_box(SPAN, 0, 0, 0.025, FW - 0.3, FD - 0.3, 0.05))
# penthouse + door
ph = raw_box(PANEL2, FW*0.26, FD*0.20, PARA*0.5 + 0.62, 1.35, 1.15, 1.24)
equips.append(ph)
equips.append(raw_box(FRAME, FW*0.26 - 0.69, FD*0.20, PARA*0.5 + 0.42, 0.04, 0.68, 0.80))
# AC units with louver hints
for (ux, uy, uw, ud, uh) in ((-FW*0.22, FD*0.10, 1.00, 0.62, 0.60), (-FW*0.05, -FD*0.16, 0.70, 0.48, 0.44)):
    u = raw_box(EQUIP, ux, uy, PARA*0.5 + uh/2 + 0.05, uw, ud, uh)
    equips.append(u)
    for k in range(3):
        equips.append(raw_box(SPAN, ux, uy - ud/2 - 0.008, PARA*0.5 + 0.12 + k*0.13, uw - 0.10, 0.012, 0.03))
# roof safety fence
fr = []
fx, fy = FW/2 - 0.35, FD/2 - 0.35
fr.append(raw_box(EQUIP, 0, -fy, PARA + 0.62, fx*2, 0.03, 0.03))
fr.append(raw_box(EQUIP, 0, fy, PARA + 0.62, fx*2, 0.03, 0.03))
fr.append(raw_box(EQUIP, -fx, 0, PARA + 0.62, 0.03, fy*2, 0.03))
fr.append(raw_box(EQUIP, fx, 0, PARA + 0.62, 0.03, fy*2, 0.03))
np_ = 7
for i in range(np_ + 1):
    xx = -fx + i * fx*2/np_
    fr.append(raw_box(EQUIP, xx, -fy, PARA + 0.33, 0.028, 0.028, 0.62))
    fr.append(raw_box(EQUIP, xx, fy, PARA + 0.33, 0.028, 0.028, 0.62))
for i in range(1, 5):
    yy = -fy + i * fy*2/5
    fr.append(raw_box(EQUIP, -fx, yy, PARA + 0.33, 0.028, 0.028, 0.62))
    fr.append(raw_box(EQUIP, fx, yy, PARA + 0.33, 0.028, 0.028, 0.62))
equips.extend(fr)
join_group('bd_top_wall', walls)
join_group('bd_top_span', spans)
join_group('bd_top_equip', equips)

print('BLDG2_OK', len([o for o in bpy.data.objects if o.name.startswith('bd_')]))
