"""外構(庭木・デッキ・テラス・フェンス・車止め・立水栓)を組み立てる。

作る約束(座標・原点・正面・UV・面数・登録)は tools/blender/README.md の
「カタログのモデルを作るときの約束」。検査は model_kit.run() が全点に掛ける。

  Blender --background --factory-startup --python tools/blender/build_garden.py [-- --no-icons]

■ なぜ作るのか
  **3Dの外観は、建物より外構で決まる。** docs/quality-bar.md は
  「オープン外構・門柱・黒縦格子・土間コン・タイルアプローチ・駐車2.5x5.0m・
  シンボルツリー」を求めているが、外構は全部で11点しか無く、
  名指しされている黒縦格子の目隠しは1点も無かった。

■ 寸法(mm)
  original-tree-symbol    2000x2000x4000  シンボルツリー(高木・落葉)
  original-tree-evergreen 1200x1200x2200  中木(常緑・目隠し・株立ち)
  original-shrub           900x 900x 500  低木・下草のまとまり
  original-deck-1820      1820x 910x 450  ウッドデッキ(1間x半間)
  original-terrace-tile   1820x1820x 150  タイルテラス(600角x9枚)
  original-fence-lattice  1820x  60x1800  縦格子フェンス(1スパン)
  original-car-stop        600x 100x 100  駐車場の車止め
  original-standpipe       300x 300x 900  屋外水栓(立水栓・パン付き)

■ 葉について
  葉は両面表示の薄板で、**閉じたメッシュではない**。裏に同じ板を重ねると
  面数が倍になるだけなので重ねない。その代わり run() の多様体検査を
  この3点だけ免除する(第6要素を True にする)。

  目隠しの常緑は、枝に沿って葉を並べると幹が透けて冬の落葉樹に見えた。
  **目隠しは向こうが見えないことが役目**なので、枝ぶりより葉の塊を優先し、
  葉は楕円体の殻へ配って幹の頂点より上まで届かせている。
"""
import json
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403
from exterior_build import add_tube, add_plank_y, new_object


def material(name, color, rough=.7, metal=0, channel=None):
    mat = matp(name, color, rough=rough, metal=metal)
    mat.use_backface_culling = False
    if channel:
        mat['finishChannel'] = channel
    return mat


def block(name, lo, hi, mat):
    return box(name, lo, hi, mat, radius=0)


def tube(name, points, radii, mat, sides=8):
    bm = bmesh.new()
    add_tube(bm, 0, points, radii, sides)
    return new_object(name, bm, [mat])


def fit_plant(obj, target):
    """Fit organic geometry on each axis, BEFORE UVs; no hidden bound markers.

    normalize_to preserves XY aspect and cannot make a random crown hit both
    targets. Only plants use this explicit small organic proportion adjustment.
    Manufactured parts below are built to exact coordinates without resizing.
    """
    lo = [min(v.co[i] for v in obj.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in obj.data.vertices) for i in range(3)]
    scales = [target[i]/(hi[i]-lo[i]) for i in range(3)]
    for v in obj.data.vertices:
        for i in range(3):
            origin = lo[i] if i == 2 else (lo[i]+hi[i])/2
            v.co[i] = (v.co[i]-origin)*scales[i]
    obj.data.update()
    obj['organic_fit_scale_xyz'] = scales
    return obj


def leaf(bm, center, direction, length, width, index, roll):
    """Pointed planar diamond: two triangles, no duplicate backside geometry."""
    along = direction.normalized()
    side = along.cross(Vector((0, 0, 1)))
    if side.length < .01:
        side = along.cross(Vector((0, 1, 0)))
    side.normalize()
    normal = along.cross(side).normalized()
    side = side*math.cos(roll) + normal*math.sin(roll)
    vs = [bm.verts.new(center + delta) for delta in
          (-along*length/2, -side*width/2, along*length/2, side*width/2)]
    bm.faces.new(vs).material_index = index


def plant(kind):
    rng = random.Random({'symbol': 411, 'evergreen': 721, 'shrub': 913}[kind])
    evergreen = kind == 'evergreen'
    shrub = kind == 'shrub'
    mats = [material('Natural bark', '#70604d', .95)]
    colors = (['#254c32', '#365f3b', '#487448'] if evergreen else
              ['#42643a', '#567c43', '#729653'])
    mats += [material('Natural leaf '+str(i), color, .78) for i, color in enumerate(colors)]
    bm = bmesh.new()
    stem_tops = []
    # Single leader for deciduous tree; five stems for evergreen; seven low fans.
    stems = 7 if shrub else 4 if evergreen else 1
    branch_count = 4 if shrub else 0 if evergreen else 16
    leaves_per_branch = 30 if shrub else 34 if evergreen else 60
    target = (.9, .9, .5) if shrub else (1.2, 1.2, 2.2) if evergreen else (2, 2, 4)
    for s in range(stems):
        az = s*2.39996
        height = (.28 + .08*rng.random() if shrub else
                  1.55 + .4*rng.random() if evergreen else 3.62)
        lean = .19 if evergreen else .16 if shrub else .045
        base = Vector((.025*math.cos(az), .025*math.sin(az), 0))
        # First segment vertical keeps the root cap exactly horizontal.
        pts = [base, base+Vector((0, 0, height*.12)),
               Vector((lean*.6*math.cos(az), lean*.6*math.sin(az), height*.55)),
               Vector((lean*math.cos(az), lean*math.sin(az), height))]
        radius = .008 if shrub else .024 if evergreen else .072
        add_tube(bm, 0, pts, [radius*1.3, radius, radius*.65, .003], 6)
        stem_tops.append(height)
        for b in range(branch_count):
            t = (.28 if shrub else .43) + .52*(b+.4)/branch_count
            base_branch = pts[2].lerp(pts[3], max(0, (t-.55)/.45)) if t >= .55 else pts[1].lerp(pts[2], (t-.12)/.43)
            angle = (s*branch_count+b)*2.39996 + rng.uniform(-.25, .25)
            reach = (.22 if shrub else .39 if evergreen else .78)*(1-.4*max(0, (t-.7)/.3))
            delta = Vector((math.cos(angle)*reach, math.sin(angle)*reach,
                            (.09 if shrub else .24 if evergreen else .42)))
            tip = base_branch+delta
            add_tube(bm, 0, [base_branch, base_branch+delta*.55+Vector((0,0,.03)), tip],
                     [radius*.40, radius*.22, .0015], 4)
            # Staggered leafy shoots around each branch; empty space between tiers.
            for j in range(0 if evergreen else leaves_per_branch):
                u = rng.uniform(.32, 1.14)
                spread = .08 if shrub else .20 if evergreen else .21
                center = base_branch + delta*u + Vector((rng.uniform(-spread, spread),
                         rng.uniform(-spread, spread), rng.uniform(-spread*.5, spread*.7)))
                direction = Vector((math.cos(angle+rng.uniform(-1.4,1.4)),
                                    math.sin(angle+rng.uniform(-1.4,1.4)), rng.uniform(-.3,.7)))
                length = (rng.uniform(.05,.08) if shrub else
                          rng.uniform(.045,.075) if evergreen else rng.uniform(.11,.18))
                leaf(bm, center, direction, length, length*(.40 if evergreen else .57),
                     rng.choices([1,2,3], [2,5,2])[0], rng.uniform(-.9,.9))
    # 目隠しの常緑は、枝に沿って葉を並べると幹が透けて「冬の落葉樹」に見えた。
    # **葉を楕円体の殻へ配る。** 目隠しは向こうが見えないことが役目なので、
    # 枝ぶりより「葉の塊が足元から立ち上がっていること」が先に効く。
    plates = 0 if evergreen else stems*branch_count*leaves_per_branch
    if evergreen:
        # **葉の塊が、いちばん高い要素でなければならない。** 幹より低いと、
        # 正規化したときに幹の先が塊の上へ突き出て、枯れ木に見える。
        top = max(stem_tops)
        cz, rz, rx = top*.66, top*.44, .32
        for j in range(1000):
            # 殻へ寄せる: 半径方向は 0.55〜1.0。内側は見えないので置かない。
            az = rng.uniform(0, math.tau)
            el = math.asin(rng.uniform(-1, 1))
            u = rng.uniform(.55, 1) ** .5
            out = Vector((math.cos(el)*math.cos(az)*rx*u,
                          math.cos(el)*math.sin(az)*rx*u, math.sin(el)*rz*u))
            center = Vector((0, 0, cz)) + out
            length = rng.uniform(.055, .085)
            leaf(bm, center, out + Vector((0, 0, rng.uniform(-.1, .1))), length,
                 length*.52, rng.choices([1, 2, 3], [2, 5, 2])[0], rng.uniform(-.9, .9))
            plates += 1
    obj = new_object('Open leaf canopy', bm, mats)
    obj['leaf_plates'] = plates
    return fit_plant(obj, target)


def deck():
    wood = [material('Deck timber '+str(i), color, .78, channel='wood')
            for i, color in enumerate(('#886044','#92694b','#80593f'))]
    frame = material('Deck structural timber', '#705039', .85, channel='wood')
    stone = material('Deck concrete feet', '#99978e', .94)
    bm = bmesh.new()
    width = (1.820-15*.005)/16
    for i in range(16):
        x = -.910+i*(width+.005)
        add_plank_y(bm, i%3, x, x+width, -.455, .455, .420, .450, .002)
    parts = [new_object('Sixteen individually chamfered deck boards', bm, wood)]
    for y in (-.33, 0, .33):
        parts.append(block('Deck joist', (-.885,y-.0225,.30), (.885,y+.0225,.42),frame))
    for x in (-.72, 0, .72):
        for y in (-.33, .33):
            parts += [block('Concrete footing', (x-.065,y-.065,0), (x+.065,y+.065,.045),stone),
                      block('Timber post', (x-.045,y-.045,.045), (x+.045,y+.045,.30),frame)]
    parts += [block('Front fascia', (-.896,-.441,.33), (.896,-.423,.42),frame),
              block('Left fascia', (-.896,-.423,.33), (-.878,.455,.42),frame),
              block('Right fascia', (.878,-.423,.33), (.896,.455,.42),frame)]
    return combine(parts)


def terrace():
    grout = material('Terrace grout and foundation', '#79796f', .95)
    tiles = [material('Terrace stone '+str(i), c, .83, channel='stone')
             for i,c in enumerate(('#b7b4a9','#bdb9af','#b1afa5'))]
    parts = [block('Recessed terrace foundation', (-.91,-.91,0), (.91,.91,.129),grout)]
    # Exactly 3*600 + 2*10 = 1820 mm. Individual 21 mm slabs, 10 mm joints.
    for row in range(3):
        for col in range(3):
            x, y = -.91+col*.61, -.91+row*.61
            parts.append(box('600 mm stone tile', (x,y,.129), (x+.6,y+.6,.15),
                             tiles[(row+col)%3], .0015, 1))
    return combine(parts)


def fence():
    metal = material('Black powder coated aluminium', '#252a2c', .43, .65, 'metal')
    parts = []
    for x in (-.89,.89):
        parts.append(block('60 mm end post', (x-.02,-.03,0), (x+.02,.03,1.8),metal))
    # Front (-Y): 21 slats, 30 mm face, 80 mm pitch, 50 mm clear gap.
    for i in range(21):
        x = -.8+i*.08
        parts.append(block('Vertical aluminium slat', (x-.015,-.03,.08), (x+.015,0,1.78),metal))
    for z in (.29,1.48):
        parts.append(block('Rear horizontal rail', (-.87,0,z), (.87,.03,z+.04),metal))
    return combine(parts)


def car_stop():
    concrete = material('Precast concrete', '#aaa99f', .95)
    reflector = material('Amber reflector', '#dfb85d', .38)
    # Broad sloping shoulders give the 100 mm wheel block its recognizable section.
    bm = bmesh.new()
    section = [(-.05,0),(.05,0),(.05,.055),(.027,.10),(-.027,.10),(-.05,.055)]
    rings = [[bm.verts.new((x,y,z)) for y,z in section] for x in (-.3,.3)]
    for i in range(6):
        j = (i+1)%6
        bm.faces.new((rings[0][i],rings[0][j],rings[1][j],rings[1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    parts = [new_object('Chamfered wheel stop',bm,[concrete])]
    # Reflectors sit 0.3 mm above the sloped shoulder, inside the overall box.
    # No coplanar overlays on concrete (which would flicker in the app).
    bm = bmesh.new()
    for x in (-.20,.20):
        coords = [(x+dx, -.05+(z-.055)*(.023/.045)-.0003, z)
                  for dx,z in ((-.035,.067),(.035,.067),(.035,.086),(-.035,.086))]
        front = [bm.verts.new(v) for v in coords]
        back = [bm.verts.new((a,b+.001,c)) for a,b,c in coords]
        bm.faces.new(front)
        bm.faces.new(list(reversed(back)))
        for i in range(4):
            j = (i+1)%4
            bm.faces.new((front[i],back[i],back[j],front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    parts.append(new_object('Two shoulder reflectors',bm,[reflector]))
    return combine(parts)


def standpipe():
    metal = material('Satin stainless water fittings', '#a6afb2', .28, .88, 'metal')
    pan = material('Warm grey cast stone pan', '#b0afa7', .89)
    dark = material('Drain and aerator interior', '#333b3d', .82)
    parts = [profile('Hollow pan with rolled rim', [
        (.280,.280,.040,0),(.300,.300,.050,.012),(.300,.300,.050,.086),
        (.294,.294,.047,.095),(.250,.250,.039,.095),(.240,.240,.035,.083),
        (.220,.220,.030,.028),(.206,.206,.027,.024)], pan, n=3)]
    parts.append(box('Square water column', (-.032,.070,.025),(.032,.134,.893),metal,.004,1))
    parts.append(box('Column top cap', (-.034,.068,.89),(.034,.136,.900),metal,.002,1))
    parts.append(tube('Front faucet neck', [(0,.07,.75),(0,.033,.75),(0,-.050,.75),
                     (0,-.075,.735),(0,-.075,.708)], [.014]*5, metal))
    parts.append(tube('Tap valve', [(0,.012,.745),(0,.012,.794)], [.016,.012],metal))
    parts.append(box('Cross handle', (-.040,.005,.791),(.040,.019,.805),metal,.003,1))
    parts.append(box('Cross handle short arm', (-.007,-.015,.791),(.007,.039,.805),metal,.003,1))
    parts.append(tube('Dark recessed aerator', [(0,-.075,.707),(0,-.075,.709)], [.009,.009],dark))
    parts.append(tube('Drain surround', [(0,-.04,.024),(0,-.04,.027)], [.022,.022],metal,12))
    parts.append(tube('Drain opening', [(0,-.04,.027),(0,-.04,.028)], [.013,.013],dark,12))
    return combine(parts)


if __name__ == '__main__':
    run([('original-tree-symbol', (2000, 2000, 4000), lambda: plant('symbol'), None, 3000, True),
         ('original-tree-evergreen', (1200, 1200, 2200), lambda: plant('evergreen'), None, 3000, True),
         ('original-shrub', (900, 900, 500), lambda: plant('shrub'), None, 3000, True),
         ('original-deck-1820', (1820, 910, 450), deck, 'wood', 1500),
         ('original-terrace-tile', (1820, 1820, 150), terrace, 'stone', 1500),
         ('original-fence-lattice', (1820, 60, 1800), fence, 'metal', 1500),
         ('original-car-stop', (600, 100, 100), car_stop, None, 1500),
         ('original-standpipe', (300, 300, 900), standpipe, 'metal', 1500)])
