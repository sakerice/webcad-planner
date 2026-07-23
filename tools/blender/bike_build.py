import bpy, math
from mathutils import Vector

def matp(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

for ob in list(bpy.data.objects):
    if ob.name.startswith('bk_'):
        bpy.data.objects.remove(ob, do_unlink=True)

FRAME = matp('BkFrame', (0.16, 0.24, 0.38), rough=0.35, metal=0.4)   # 濃紺
TIRE  = matp('BkTire', (0.04, 0.04, 0.045), rough=0.95)
SILVER= matp('BkSilver', (0.75, 0.76, 0.78), rough=0.3, metal=0.85)
DARK  = matp('BkDark', (0.12, 0.12, 0.13), rough=0.6, metal=0.2)
BASKET= matp('BkBasket', (0.35, 0.36, 0.38), rough=0.5, metal=0.6)
SADDLE= matp('BkSaddle', (0.10, 0.09, 0.09), rough=0.8)

WR = 0.31      # タイヤ半径(26インチ相当)
FA = Vector((0, 0.575, WR))    # 前輪軸
RA = Vector((0, -0.575, WR))   # 後輪軸
BB = Vector((0, -0.02, 0.27))  # ボトムブラケット
HT = Vector((0, 0.50, 0.95))   # ヘッド上端
ST = Vector((0, -0.42, 0.86))  # シート上端

def cyl_between(name, mat, p1, p2, r, verts=10):
    p1 = Vector(p1); p2 = Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length,
        location=((p1+p2)/2))
    ob = bpy.context.object; ob.name = name
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = d.to_track_quat('Z', 'Y')
    ob.data.materials.append(mat)
    return ob

def wheel(prefix, center):
    bpy.ops.mesh.primitive_torus_add(major_radius=WR-0.014, minor_radius=0.016,
        location=center, rotation=(0, math.radians(90), 0),
        major_segments=36, minor_segments=8)
    t = bpy.context.object; t.name = prefix + '_tire'
    t.data.materials.append(TIRE)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR-0.030, minor_radius=0.006,
        location=center, rotation=(0, math.radians(90), 0),
        major_segments=32, minor_segments=6)
    r = bpy.context.object; r.name = prefix + '_rim'
    r.data.materials.append(SILVER)
    # スポーク(8本)
    for k in range(8):
        a = k * math.tau / 8
        p1 = Vector(center)
        p2 = Vector((center[0], center[1] + math.cos(a)*(WR-0.035), center[2] + math.sin(a)*(WR-0.035)))
        cyl_between(prefix + '_sp%d' % k, SILVER, p1, p2, 0.0022, 6)
    # ハブ
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.022, depth=0.07,
        location=center, rotation=(0, math.radians(90), 0))
    h = bpy.context.object; h.name = prefix + '_hub'
    h.data.materials.append(SILVER)
    # フェンダー(上半分の泥除け): トーラスを板状にスケールして上半分だけ残す
    bpy.ops.mesh.primitive_torus_add(major_radius=WR+0.012, minor_radius=0.013,
        location=center, rotation=(0, math.radians(90), 0),
        major_segments=28, minor_segments=6)
    f = bpy.context.object; f.name = prefix + '_fender'
    # ホイール軸方向(回転後のワールドX=ローカルZ)にだけ広げて泥除け断面にする
    f.scale = (1.0, 1.0, 2.2)
    bpy.ops.object.transform_apply(scale=True)
    # 下半分カット
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center[0], center[1], center[2] - 0.45))
    c = bpy.context.object
    c.scale = (1.0, 1.2, 0.9)
    bpy.ops.object.transform_apply(scale=True)
    boo = f.modifiers.new('C', 'BOOLEAN'); boo.operation = 'DIFFERENCE'; boo.object = c
    bpy.context.view_layer.objects.active = f
    bpy.ops.object.modifier_apply(modifier=boo.name)
    bpy.data.objects.remove(c, do_unlink=True)
    f.data.materials.clear()
    f.data.materials.append(SILVER)

wheel('bk_wf', FA)
wheel('bk_wr', RA)

# フレーム(ママチャリのスタッガード型)
cyl_between('bk_fork_l', SILVER, (0.045, HT.y+0.02, HT.z-0.08), (0.045, FA.y, FA.z), 0.011)
cyl_between('bk_fork_r', SILVER, (-0.045, HT.y+0.02, HT.z-0.08), (-0.045, FA.y, FA.z), 0.011)
cyl_between('bk_head', FRAME, (0, HT.y+0.035, HT.z+0.06), (0, HT.y-0.02, HT.z-0.14), 0.021)
# ダウンチューブ(緩いカーブを2本で近似)
cyl_between('bk_dt1', FRAME, (0, HT.y-0.02, HT.z-0.16), (0, 0.20, 0.42), 0.019)
cyl_between('bk_dt2', FRAME, (0, 0.20, 0.42), BB, 0.019)
# シートチューブ+シートポスト
cyl_between('bk_stube', FRAME, BB, (0, ST.y+0.02, ST.z-0.10), 0.019)
cyl_between('bk_spost', SILVER, (0, ST.y+0.01, ST.z-0.12), ST, 0.012)
# チェーンステー/シートステー(左右)
for s in (-1, 1):
    cyl_between('bk_cs%d' % max(s,0), FRAME, (s*0.03, BB.y, BB.z), (s*0.045, RA.y, RA.z), 0.010)
    cyl_between('bk_ss%d' % max(s,0), FRAME, (s*0.02, ST.y+0.03, ST.z-0.13), (s*0.045, RA.y, RA.z), 0.010)
# ハンドル: ステム+セミアップバー
cyl_between('bk_stem', SILVER, (0, HT.y+0.03, HT.z+0.05), (0, HT.y+0.01, HT.z+0.12), 0.013)
cyl_between('bk_bar', SILVER, (-0.26, HT.y-0.02, HT.z+0.14), (0.26, HT.y-0.02, HT.z+0.14), 0.011)
for s in (-1, 1):
    cyl_between('bk_grip%d' % max(s,0), DARK, (s*0.26, HT.y-0.02, HT.z+0.14), (s*0.30, HT.y-0.12, HT.z+0.15), 0.014)
# サドル
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.09, location=(0, ST.y-0.02, ST.z+0.02))
sad = bpy.context.object; sad.name = 'bk_saddle'
sad.scale = (0.75, 1.5, 0.35)
bpy.ops.object.transform_apply(scale=True)
sad.data.materials.append(SADDLE)
bpy.ops.object.shade_smooth()
# 前カゴ(格子)
bx, by, bz = 0.36, 0.30, 0.22
bcy, bcz = 0.62, 0.78
parts = []
def bar(name, p1, p2, r=0.005):
    parts.append(cyl_between(name, BASKET, p1, p2, r, 6))
for sx in (-1, 1):
    bar('bk_bkv%d' % max(sx,0), (sx*bx/2, bcy-by/2, bcz), (sx*bx/2, bcy+by/2, bcz))
    bar('bk_bkv2%d' % max(sx,0), (sx*bx/2, bcy-by/2, bcz+bz), (sx*bx/2, bcy+by/2, bcz+bz))
    for k in range(4):
        yy = bcy - by/2 + by*k/3
        bar('bk_bkp%d%d' % (max(sx,0), k), (sx*bx/2, yy, bcz), (sx*bx/2, yy, bcz+bz), 0.004)
for sy in (-1, 1):
    bar('bk_bkh%d' % max(sy,0), (-bx/2, bcy+sy*by/2, bcz), (bx/2, bcy+sy*by/2, bcz))
    bar('bk_bkh2%d' % max(sy,0), (-bx/2, bcy+sy*by/2, bcz+bz), (bx/2, bcy+sy*by/2, bcz+bz))
    for k in range(5):
        xx = -bx/2 + bx*k/4
        bar('bk_bkq%d%d' % (max(sy,0), k), (xx, bcy+sy*by/2, bcz), (xx, bcy+sy*by/2, bcz+bz), 0.004)
# カゴ底
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, bcy, bcz))
bot = bpy.context.object; bot.name = 'bk_bkbottom'
bot.scale = (bx, by, 0.008)
bpy.ops.object.transform_apply(scale=True)
bot.data.materials.append(BASKET)
# リアラック
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.62, 0.72))
rack = bpy.context.object; rack.name = 'bk_rack'
rack.scale = (0.14, 0.36, 0.012)
bpy.ops.object.transform_apply(scale=True)
rack.data.materials.append(DARK)
cyl_between('bk_rackleg1', DARK, (0.05, -0.75, 0.71), (0.045, RA.y, RA.z), 0.007)
cyl_between('bk_rackleg2', DARK, (-0.05, -0.75, 0.71), (-0.045, RA.y, RA.z), 0.007)
# クランク+ペダル
bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.016, depth=0.12,
    location=BB, rotation=(0, math.radians(90), 0))
crk = bpy.context.object; crk.name = 'bk_crankaxle'; crk.data.materials.append(SILVER)
for s in (-1, 1):
    cyl_between('bk_crank%d' % max(s,0), DARK, (s*0.06, BB.y, BB.z), (s*0.06, BB.y + s*0.13, BB.z - s*0.05), 0.009)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(s*0.10, BB.y + s*0.13, BB.z - s*0.05))
    ped = bpy.context.object; ped.name = 'bk_pedal%d' % max(s,0)
    ped.scale = (0.08, 0.07, 0.018)
    bpy.ops.object.transform_apply(scale=True)
    ped.data.materials.append(DARK)
# チェーンカバー(ママチャリらしさ)
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.10, depth=0.02,
    location=(0.045, BB.y, BB.z), rotation=(0, math.radians(90), 0))
cc = bpy.context.object; cc.name = 'bk_chaincase'; cc.data.materials.append(FRAME)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.045, (BB.y+RA.y)/2, (BB.z+RA.z)/2 + 0.02))
cc2 = bpy.context.object; cc2.name = 'bk_chaincase2'
cc2.scale = (0.02, 0.52, 0.09)
cc2.rotation_euler = (math.radians(-4), 0, 0)
bpy.ops.object.transform_apply(scale=True, rotation=True)
cc2.data.materials.append(FRAME)
# スタンド
cyl_between('bk_stand', DARK, (-0.05, RA.y-0.02, RA.z-0.02), (-0.09, RA.y-0.10, 0.01), 0.008)
print('BIKE_OK', len([o for o in bpy.data.objects if o.name.startswith('bk_')]))
