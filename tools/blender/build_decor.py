"""生活小物(本・マグ・花器・かご・卓上の観葉・玄関の小物)を組み立てる。

作る約束(座標・原点・正面・UV・面数・登録)は tools/blender/README.md の
「カタログのモデルを作るときの約束」。検査は model_kit.run() が全点に掛ける。

  Blender --background --factory-startup --python tools/blender/build_decor.py [-- --no-icons]

■ なぜ作るのか
  docs/quality-bar.md は「リビングに生活小物2点以上」を求めている。1軒で4点
  要るのに在庫は5点で、しかも全部が洋風の置物だった。**玄関に置ける小物は
  1点も無い。** 数が足りないと、どの家にも同じ小物が並ぶ。

  掛け時計は作っていない。壁装飾は在庫24点で、うち3点が既に掛け時計であり、
  不足していない(node tools/catalogue_gap.mjs)。その枠を玄関の小物へ回した。

■ 寸法(mm)
  original-books-stack     250x180x220  平積み+立て掛け
  original-mug-tray        300x200x110  木のトレーとマグ2つ
  original-vase-tall       200x200x600  背の高い花器と枝もの
  original-basket-blanket  450x350x380  編みかごとブランケット
  original-plant-desk      180x180x300  卓上の観葉(小鉢)
  original-entry-tray      250x180x120  玄関のトレーと鍵

  卓上に置く小物は、床に落ちた状態で出てくると毎回持ち上げることになるので、
  decor-collection.json の defaultElevation で天板の高さを既定にしている。
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403

# Living accessories. Metres, Z-up, front = -Y. No textures or rescaling.
# run() owns UV generation, validation and export. Only the desk plant has
# open leaf plates. All other components are individually closed meshes.
# Triangle counts below count n-gons as n-2, before Blender's final validation.


def material(name, color, rough=.65, metal=0, channel=None):
    mat = matp(name, color, rough=rough, metal=metal)
    mat.use_backface_culling = False
    if channel:
        mat['finishChannel'] = channel
    return mat


def mesh_part(name, vertices, faces, mat, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def shift(obj, x=0, y=0, z=0):
    for v in obj.data.vertices:
        v.co.x += x
        v.co.y += y
        v.co.z += z
    obj.data.update()
    return obj


def lathe(name, rows, mat, x=0, y=0, sides=16):
    """Closed radial profile: (radius, z); no zero-radius/degenerate caps.

    Cardinal samples define exact X/Y bounds. Return down the inside for
    vessels; underside and interior floor are separate, nonzero-radius caps.
    Triangles = 2 * sides * len(rows) - 4.
    """
    rings = [[(x+r*math.cos(math.tau*i/sides),
               y+r*math.sin(math.tau*i/sides), z) for i in range(sides)]
             for r, z in rows]
    return shell(name, rings, [mat], [0]*(len(rows)-1))


def slab(name, w, d, z0, z1, mat, x=0, y=0, corner=.006, edge=.001):
    # Four explicit rings give a small edge chamfer and rounded XY corners.
    obj = profile(name, [(w-2*edge, d-2*edge, corner-edge, z0),
                         (w, d, corner, z0+edge),
                         (w, d, corner, z1-edge),
                         (w-2*edge, d-2*edge, corner-edge, z1)], mat, n=1)
    return shift(obj, x, y)


def loop(name, center, rx, ry, radius, mat, vertical=False, steps=12):
    """Closed four-sided cord around an ellipse; no capped overlapping ends.

    Used for mug handles (XZ) and key rings (XY), never to set model bounds.
    """
    vertices = []
    for i in range(steps):
        a = math.tau*i/steps
        for j in range(4):
            b = math.tau*j/4
            u = (rx+radius*math.cos(b))*math.cos(a)
            v = (ry+radius*math.cos(b))*math.sin(a)
            t = radius*math.sin(b)
            vertices.append((center[0]+u, center[1]+(t if vertical else v),
                             center[2]+(v if vertical else t)))
    faces = []
    for i in range(steps):
        for j in range(4):
            a, b = i*4+j, ((i+1) % steps)*4+j
            c, d = ((i+1) % steps)*4+(j+1) % 4, i*4+(j+1) % 4
            # XY torus ordering points outwards; XZ swaps two axes.
            faces.append((d, c, b, a) if vertical else (a, b, c, d))
    return mesh_part(name, vertices, faces, mat, True)


def twig(name, points, radii, mat, sides=6):
    # Horizontal rings keep the terminal cap at its explicitly designed Z.
    # Slender upward branches only; the top radius stays positive.
    rings = [[(x+r*math.cos(math.tau*i/sides),
               y+r*math.sin(math.tau*i/sides), z) for i in range(sides)]
             for (x, y, z), r in zip(points, radii)]
    return shell(name, rings, [mat], [0]*(len(rings)-1))


def tray(name, w, d, mat):
    # 4 mm bottom, 18 mm raised rim, 3 mm lip, generous rounded corners.
    return profile(name, [(w-.006, d-.006, .020, 0),
                          (w, d, .023, .003),
                          (w, d, .023, .015),
                          (w-.003, d-.003, .022, .018),
                          (w-.009, d-.009, .019, .018),
                          (w-.014, d-.014, .017, .014),
                          (w-.024, d-.024, .014, .004)], mat, n=2)


def book(name, w, d, thick, cover, paper):
    # A single closed stepped shell: bevel / cover / recessed page block /
    # cover / bevel. Front (-Y) page-block band is the coloured book spine.
    rows = [(w-.001, d-.001, .003, 0), (w, d, .0035, .0005),
            (w, d, .0035, .002), (w-.004, d-.005, .002, .0025),
            (w-.004, d-.005, .002, thick-.0025),
            (w, d, .0035, thick-.002), (w, d, .0035, thick-.0005),
            (w-.001, d-.001, .003, thick)]
    rings = [rounded_rect(0, 0, a, b, r, z, n=1) for a, b, r, z in rows]
    # A very slight curl at the fore-edge, with a planar bottom contact.
    # All top rings share the same warp so cover thickness stays positive.
    for ring in rings[4:]:
        for v in ring:
            v.z -= .0006*((v.y+d/2)/d)**2
    obj = shell(name, rings, [cover, paper], [0, 0, 0, 1, 0, 0, 0])
    obj.data.polygons[1+3*8+5].material_index = 0
    return obj


def books_stack():
    paper = material('Decor warm paper edges', '#e5dec9', .92)
    covers = [material('Decor book cover '+str(i), c, .72, channel='accent')
              for i, c in enumerate(('#526963', '#ba795d', '#d2b781', '#697180'))]
    parts = []
    for i, (w, d, t, x, y, z) in enumerate([
            (.250, .180, .022, 0, 0, 0),
            (.218, .162, .019, -.010, .003, .022),
            (.198, .149, .024, -.019, -.002, .041),
            (.178, .132, .021, -.025, .003, .065)]):
        parts.append(shift(book('Stacked book '+str(i), w, d, t,
                                covers[i], paper), x, y, z))
    # Two inclined books rest on the upper stack, one partly supporting the
    # other. Vertex-based translation sets the highest actual cover to 220 mm.
    for i, (w, d, t, angle, x, y, top) in enumerate([
            (.140, .100, .018, -70, .039, .018, .220),
            (.132, .096, .016, -64, .060, -.014, .212)]):
        obj = book('Leaning book '+str(i), w, d, t, covers[i], paper)
        a = math.radians(angle)
        for v in obj.data.vertices:
            px, pz = v.co.x, v.co.z-t/2
            v.co.x = px*math.cos(a)+pz*math.sin(a)
            v.co.z = -px*math.sin(a)+pz*math.cos(a)
        shift(obj, x, y, top-max(v.co.z for v in obj.data.vertices))
        parts.append(obj)
    return combine(parts)  # 744 triangles


def mug_tray():
    wood = material('Decor serving tray oak', '#bd9467', .58, channel='wood')
    ceramic = material('Decor ivory glazed ceramic', '#eee9dd', .23)
    parts = [tray('Thin serving tray with raised rim', .300, .200, wood)]
    for i, (x, y) in enumerate(((-.064, -.026), (.059, .023))):
        parts.append(lathe('Open mug '+str(i), [
            (.024, .004), (.029, .007), (.033, .092), (.034, .108),
            (.0335, .110), (.0315, .110), (.031, .107),
            (.030, .092), (.026, .013)], ceramic, x, y, sides=12))
        parts.append(loop('Ring mug handle '+str(i), (x+.039, y, .061),
                          .022, .028, .004, ceramic, vertical=True))
    return combine(parts)  # 780 triangles


def vase_tall():
    body = material('Decor sand stoneware vase', '#c1ad91', .62, channel='body')
    bark = material('Decor branch bark', '#6b5540', .94)
    foliage = [material('Decor branch leaf '+str(i), c, .74)
               for i, c in enumerate(('#5d7a48', '#6e8b55'))]
    parts = [lathe('Narrow neck and flared open vase', [
        (.068, 0), (.086, .006), (.100, .060), (.097, .160),
        (.070, .250), (.042, .302), (.043, .328), (.051, .345),
        (.047, .348), (.039, .328), (.038, .303), (.061, .252),
        (.085, .158), (.087, .061), (.067, .013)], body)]
    branches = [([(0, 0, .060), (.009, .003, .345), (.036, .013, .480),
                  (.052, .021, .600)], [.006, .004, .002, .0008]),
                ([(-.009, .003, .090), (-.015, .008, .340),
                  (-.052, .012, .449), (-.072, .030, .538)], [.005, .0035, .002, .0008]),
                ([(.004, -.006, .090), (.007, -.014, .342),
                  (.026, -.043, .445), (.010, -.061, .515)], [.004, .003, .0018, .0007]),
                ([(.027, .010, .443), (.069, -.002, .504),
                  (.082, -.015, .553)], [.002, .0013, .0006]),
                ([(-.037, .010, .406), (-.070, -.020, .463),
                  (-.085, -.027, .481)], [.0018, .0011, .0006])]
    for i, (points, radii) in enumerate(branches):
        parts.append(twig('Branch '+str(i), points, radii, bark, sides=4))
        # 枝の上半分へ、互い違いに小さい葉を付ける。1枚4三角形の折れた板。
        for k in range(9):
            t = .46+.54*(k+.5)/9
            span = (len(points)-1)*t
            a = min(int(span), len(points)-2)
            f = span-a
            at = tuple(points[a][j]*(1-f)+points[a+1][j]*f for j in range(3))
            ahead = tuple(points[a+1][j]-points[a][j] for j in range(3))
            n = math.sqrt(sum(c*c for c in ahead)) or 1
            ahead = tuple(c/n for c in ahead)
            az = (i*2.39996)+k*1.7
            # 枝と直交する向きへ出す(枝に沿って寝かせると見えない)
            out = (math.cos(az)*.85-ahead[0]*.3, math.sin(az)*.85-ahead[1]*.3, .30)
            m = math.sqrt(sum(c*c for c in out)) or 1
            out = tuple(c/m for c in out)
            length = .030 if k < 5 else .024
            # **外形の箱(200x200)からはみ出させない。** はみ出すと原点が
            # 中心から外れ、3Dで花器だけ横へずれて置かれる。
            for axis in (0, 1):
                if abs(out[axis]) > 1e-6:
                    room = (.098 if out[axis] > 0 else -.098) - at[axis]
                    length = min(length, max(0., room/out[axis]))
            if length < .006:
                continue
            tip = tuple(at[j]+out[j]*length for j in range(3))
            mid = tuple(at[j]*.45+tip[j]*.55 for j in range(3))
            side = (-out[1]*length*.34, out[0]*length*.34, 0)
            ridge = (mid[0], mid[1], mid[2]+length*.14)
            vertices = [at, tuple(mid[j]+side[j] for j in range(3)), tip,
                        tuple(mid[j]-side[j] for j in range(3)), ridge]
            parts.append(mesh_part('Branch leaf %d-%d' % (i, k), vertices,
                                   [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)],
                                   foliage[k % 2]))
    return combine(parts)  # 枝5本 x 葉9枚 = 180三角形 + 枝と花器


def basket_blanket():
    body = material('Decor woven willow', '#b28a5c', .88, channel='body')
    weave = material('Decor willow weave highlights', '#c29a6a', .88, channel='body')
    fabric = material('Decor oatmeal blanket', '#bdae94', .99, channel='fabric')
    parts = [profile('Open tapered basket and rolled rim', [
        (.360, .260, .055, 0), (.372, .272, .060, .008),
        (.440, .340, .073, .288), (.450, .350, .078, .295),
        (.450, .350, .078, .304), (.438, .338, .074, .312),
        (.418, .318, .064, .306), (.414, .314, .062, .293),
        (.349, .249, .049, .022)], body, n=2)]
    # Five closed, shallow zigzag belts suggest over/under woven reeds.
    # Each sits partly embedded in the supporting basket wall, without
    # coplanar faces or open strip edges. They never exceed the rolled rim.
    for k in range(6):
        z = .030+k*.045
        rings = []
        for dz, extra in ((0, .002), (.003, .010), (.022, .010), (.025, .002)):
            t = (z+dz-.008)/.280
            w, d, r = .372+.068*t, .272+.068*t, .060+.013*t
            ring = rounded_rect(0, 0, w+extra, d+extra, r, z+dz, n=1)
            for i, v in enumerate(ring):
                v.z += .003 if (i+k) % 2 else -.003
            rings.append(ring)
        # Cyclic loft closes the belt without disks across the opening.
        vertices = [tuple(v) for ring in rings for v in ring]
        faces = []
        for j in range(4):
            for i in range(8):
                faces.append((j*8+i, j*8+(i+1) % 8,
                              ((j+1) % 4)*8+(i+1) % 8, ((j+1) % 4)*8+i))
        parts.append(mesh_part('Coiled willow round '+str(k), vertices, faces, weave, True))
    # Narrow upright reeds cross the horizontal belts. Both ends have
    # rounded 8-vertex sections; 14 reeds add only 392 triangles.
    for sign in (-1, 1):
        for x in (-.120, -.040, .040, .120):
            rings = [rounded_rect(x*.82, sign*.139, .009, .0028, .001, .022, n=1),
                     rounded_rect(x, sign*.1702, .009, .0028, .001, .289, n=1)]
            parts.append(shell('Basket front or rear upright reed', rings, [weave], [0]))
        for y in (-.070, 0, .070):
            rings = [rounded_rect(sign*.189, y*.82, .0028, .009, .001, .022, n=1),
                     rounded_rect(sign*.2202, y, .0028, .009, .001, .289, n=1)]
            parts.append(shell('Basket side upright reed', rings, [weave], [0]))
    parts.append(slab('Lower folded blanket', .290, .216, .274, .323,
                      fabric, x=.009, y=.012, corner=.048, edge=.014))
    parts.append(slab('Upper folded blanket', .268, .197, .326, .380,
                      fabric, x=.014, y=.014, corner=.052, edge=.010))
    # Thick cloth cross-sections swept from the fold over the FRONT rim.
    # Rounded width corners and several bends make a drape, not a flat box.
    rings = []
    for y, z, depth in ((.070, .342, .012), (-.090, .342, .012),
                        (-.144, .328, .014), (-.166, .291, .014),
                        (-.168, .242, .014), (-.158, .214, .010)):
        # rounded_rect lies in XY; rotate the section to XZ (normal -Y).
        ring = rounded_rect(.008, 0, .174, depth, .004, 0, n=1)
        rings.append([(v.x, y, z+v.y) for v in ring])
    parts.append(shell('Blanket draped over front rim', rings, [fabric], [0]*5))
    return combine(parts)  # 1136 triangles


def plant_desk():
    body = material('Decor desk planter clay', '#c3ab92', .79, channel='body')
    soil = material('Decor potting soil', '#40372b', 1)
    stem = material('Decor green stems', '#476c39', .85)
    leaves = [material('Decor living leaf '+str(i), c, .72)
              for i, c in enumerate(('#3b673c', '#568048'))]
    parts = [lathe('Tapered open desk pot', [
        (.046, 0), (.050, .004), (.063, .092), (.065, .098),
        (.064, .104), (.058, .104), (.057, .096), (.045, .014)], body),
        lathe('Recessed soil', [(.054, .083), (.055, .087)], soil, sides=12)]
    # Four cardinal tips define +/-90 mm exactly; an upright leaf reaches
    # Z=300 mm. All other vertices remain strictly inside that envelope.
    tips = [(.090, 0, .200), (0, .090, .220), (-.090, 0, .207),
            (0, -.090, .182), (.050, .050, .262), (-.047, .048, .268),
            (-.050, -.046, .246), (.053, -.045, .239), (.012, .008, .300)]
    for i, tip in enumerate(tips):
        a = i*math.tau/4 if i < 4 else i*2.39996
        base = (.009*math.cos(a), .009*math.sin(a), .126+(i % 3)*.023)
        root = (0, 0, .087)
        parts.append(twig('Leaf petiole '+str(i), [root, base], [.002, .0012], stem))
        mid = tuple(base[j]*.43+tip[j]*.57 for j in range(3))
        width = .018 if i < 8 else .013
        side = (-math.sin(a)*width, math.cos(a)*width, -.006)
        ridge = (mid[0], mid[1], mid[2]+.008)
        vertices = [base, tuple(mid[j]+side[j] for j in range(3)), tip,
                    (mid[0]-side[0], mid[1]-side[1], mid[2]-.006), ridge]
        parts.append(mesh_part('Folded pointed leaf '+str(i), vertices,
                               [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], leaves[i % 2]))
    return combine(parts)  # 512 triangles; leaf plates deliberately open


def entry_tray():
    wood = material('Decor entry tray walnut', '#8d6447', .61, channel='wood')
    silver = material('Decor nickel keys', '#a9afb0', .28, metal=.85)
    bottle = material('Decor small opaque ivory bottle', '#e9e4d8', .3)
    cap = material('Decor bottle brass cap', '#aa9161', .4, metal=.7)
    paper = material('Decor folded mail paper', '#e7ddc6', .94)
    parts = [tray('Entry catchall tray', .250, .180, wood)]
    parts.append(lathe('Small shoulder bottle', [
        (.019, .004), (.023, .008), (.023, .079), (.014, .093),
        (.011, .096), (.011, .108)], bottle, .072, .028, sides=8))
    parts.append(lathe('Rounded bottle cap', [
        (.011, .106), (.012, .108), (.012, .118), (.010, .120)],
        cap, .072, .028, sides=12))
    parts.append(slab('Folded letter lower layer', .113, .082, .004, .010,
                      paper, x=-.044, y=.024, corner=.004, edge=.0007))
    parts.append(slab('Folded letter upper layer', .109, .078, .010, .014,
                      paper, x=-.045, y=.024, corner=.004, edge=.0007))
    parts.append(loop('Key bunch split ring', (-.034, -.044, .009),
                      .014, .011, .0018, silver))
    for i, (x, y) in enumerate(((-.012, -.045), (-.020, -.059))):
        parts.append(loop('Key bow '+str(i), (x, y, .007), .009, .006,
                          .002, silver, steps=8))
        # One continuous toothed blade, with a 0.3 mm edge bevel. The
        # concave outline replaces separate boxes and keeps the budget low.
        outline = [(0, -.0025), (.016, -.0025), (.016, -.008),
                   (.020, -.008), (.020, -.0025), (.026, -.0025),
                   (.026, -.007), (.030, -.007), (.030, -.0025),
                   (.034, -.0025), (.034, .0025), (0, .0025)]
        rings = []
        for z, scale in ((.004, .96), (.0043, 1), (.0067, 1), (.007, .96)):
            rings.append([(x+.005+.017+(px-.017)*scale, y+py*scale, z)
                          for px, py in outline])
        parts.append(shell('Bevelled toothed key blade '+str(i), rings, [silver], [0]*3))
    return combine(parts)  # 876 triangles



if __name__ == '__main__':
    run([('original-books-stack', (250, 180, 220), books_stack, 'accent', 900),
         ('original-mug-tray', (300, 200, 110), mug_tray, 'wood', 900),
         ('original-vase-tall', (200, 200, 600), vase_tall, 'body', 1200, True),
         ('original-basket-blanket', (450, 350, 380), basket_blanket, {'body', 'fabric'}, 1200),
         ('original-plant-desk', (180, 180, 300), plant_desk, 'body', 1400, True),
         ('original-entry-tray', (250, 180, 120), entry_tray, 'wood', 900)])
