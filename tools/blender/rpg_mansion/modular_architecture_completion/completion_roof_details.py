"""Editable hollow chimney, glazed shed dormer, and its local cut roof host."""
from itertools import product

from reference_mansard_roofs import patch
from reference_walls_floors import ring
from completion_roofs import annulus, square, variable_patch, folded_seam


def _bevelled_box(g, name, lo, hi, amount, mat):
    """Explicit one-segment chamfer cube: 24 vertices and 44 triangles."""
    centre = [(a+b)/2 for a, b in zip(lo, hi)]
    radius = [(b-a)/2 for a, b in zip(lo, hi)]
    assert 0 < amount < min(radius)
    verts, lookup = [], {}
    for signs in product((-1, 1), repeat=3):
        for axis in range(3):
            lookup[(signs, axis)] = len(verts)
            verts.append(tuple(centre[i]+signs[i]*(radius[i]-(0 if i == axis else amount))
                               for i in range(3)))
    faces = []
    order = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for axis in range(3):
        other = [i for i in range(3) if i != axis]
        for s in (-1, 1):
            face = []
            for a, b in order:
                signs = [0, 0, 0]
                signs[axis], signs[other[0]], signs[other[1]] = s, a, b
                face.append(lookup[(tuple(signs), axis)])
            faces.append(tuple(face))
    for axis in range(3):
        a, b = [i for i in range(3) if i != axis]
        for sa, sb in product((-1, 1), repeat=2):
            ends = []
            for s in (-1, 1):
                signs = [0, 0, 0]
                signs[axis], signs[a], signs[b] = s, sa, sb
                ends.append(tuple(signs))
            faces.append((lookup[(ends[0], a)], lookup[(ends[1], a)],
                          lookup[(ends[1], b)], lookup[(ends[0], b)]))
    for signs in product((-1, 1), repeat=3):
        faces.append(tuple(lookup[(signs, axis)] for axis in range(3)))
    return g.mesh(name, verts, faces, mat)


def chimney(g):
    """1780 mm hollow masonry chimney with an unobstructed 400 mm flue."""
    annulus(g, 'Chimney sloping annular flashing and bearing shoe',
            square(.34), square(.20), lambda x, y: .012*(y+.34),
            lambda x, y: .05, 'metal')
    annulus(g, 'Chimney continuous hollow mortar core', square(.28), square(.20),
            lambda x, y: .05, lambda x, y: 1.40, 'mortar')
    for row in range(10):
        z0, z1 = .05+row*.135+.003, .05+(row+1)*.135-.003
        front_cuts = ([-.31, 0, .31] if row % 2 == 0
                      else [-.31, -.155, .155, .31])
        side_cuts = ([-.28, -.14, .14, .28] if row % 2 == 0
                     else [-.28, 0, .28])
        for side in (-1, 1):
            y0, y1 = (-.31, -.28) if side < 0 else (.28, .31)
            for col, (a, b) in enumerate(zip(front_cuts, front_cuts[1:])):
                _bevelled_box(g, 'Brick chimney face %s course %02d brick %02d' %
                             (side, row+1, col+1),
                             (a+.003, y0, z0), (b-.003, y1, z1), .0015, 'brick')
            x0, x1 = (-.31, -.28) if side < 0 else (.28, .31)
            for col, (a, b) in enumerate(zip(side_cuts, side_cuts[1:])):
                _bevelled_box(g, 'Brick chimney return %s course %02d brick %02d' %
                             (side, row+1, col+1),
                             (x0, a+.003, z0), (x1, b-.003, z1), .0015, 'brick')
    annulus(g, 'Chimney stone crown with open four hundred millimetre flue',
            square(.36), square(.20), lambda x, y: 1.40,
            lambda x, y: 1.48, 'stone')
    hood_bottom = lambda x, y: 1.73-(.04/.36)*max(abs(x), abs(y))
    for sx, sy in product((-1, 1), repeat=2):
        a, b = (sx*.22, sy*.22), (sx*.30, sy*.22)
        c, d = (sx*.30, sy*.30), (sx*.22, sy*.30)
        # The top breaks across the hip; two closed wedges touch on that line.
        for index, triangle in enumerate(([a, b, c], [a, c, d])):
            variable_patch(g, 'Chimney fitted hood leg %s %s wedge %s' % (sx, sy, index),
                           [[(x, y, hood_bottom(x, y)) for x, y in triangle]],
                           lambda x, y, z: 1.48, 'stone')
    rim = square(.36)
    hood = [[(0, 0, 1.78), (*rim[i], 1.74), (*rim[(i+1) % 4], 1.74)]
            for i in range(4)]
    patch(g, 'Chimney hollow four-sided ventilated weather hood', hood, .05, 'stone')


def dormer(g):
    """Shed dormer, front -Y, with physical 8 mm glass and no filled opening."""
    base = lambda y: .825+.7*y
    top = lambda y: 1.2+.04*(y+.5)
    cheek = [(-.5, base(-.5)), (.5, base(.5)),
             (.5, top(.5)), (-.5, top(-.5))]
    for a, b in ((-.45, -.4), (.4, .45)):
        g.prism('Dormer sloping-bottom timber cheek '+str(a), cheek,
                'X', a, b, 'wood')
    g.prism('Dormer rear fitted timber wall',
            [(.5, base(.5)), (.55, base(.55)),
             (.55, top(.55)), (.5, top(.5))], 'X', -.45, .45, 'wood')
    g.prism('Dormer sloping-bottom stone sill',
            [(-.6, base(-.6)), (-.5, base(-.5)), (-.5, .525), (-.6, .525)],
            'X', -.45, .45, 'stone')
    ring(g, 'Dormer continuous mitred fixed timber window frame',
         [(-.45, .525), (.45, .525), (.45, 1.18), (-.45, 1.18)],
         [(-.39, .585), (.39, .585), (.39, 1.12), (-.39, 1.12)],
         'Y', -.55, -.5, 'wood_trim')
    g.box('Dormer fixed central timber mullion', (-.012, -.55, .585),
          (.012, -.5, 1.12), 'wood_trim')
    for i, (a, b) in enumerate(((-.39, -.012), (.012, .39))):
        g.box('Dormer actual eight millimetre glass pane '+str(i+1),
              (a, -.53, .585), (b, -.522, 1.12), 'glass')
    g.prism('Dormer fitted sloping window head plate',
            [(-.55, 1.18), (-.5, 1.18), (-.5, top(-.5)), (-.55, top(-.55))],
            'X', -.45, .45, 'wood_trim')
    for name, low, high, mat in [
            ('Dormer hollow fifty-five millimetre timber roof', 0, .055, 'roof_deck'),
            ('Dormer six millimetre metal roof pan', .055, .061, 'metal')]:
        g.prism(name, [(-.625, top(-.625)+low), (.625, top(.625)+low),
                       (.625, top(.625)+high), (-.625, top(-.625)+high)],
                'X', -.54, .54, mat)
    for x in (-.36, 0, .36):
        folded_seam(g, 'Dormer folded standing seam '+str(x), -.625, .625,
                    lambda y, w, lift, x=x: (x+w, y, top(y)+.061+lift))


def dormer_host(g):
    """Local source copy of the original span, cut for the paired dormer."""
    import bpy
    import bmesh

    first = len(g.PARTS)
    g.roof()
    parts = list(g.PARTS[first:])

    def cutter(name, x0, x1, y0, y1):
        # Cutter is deliberately not added to the deliverable PARTS registry.
        verts = [(x, y, z) for z in (-.3, 2.) for y in (y0, y1) for x in (x0, x1)]
        faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4),
                 (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        return obj

    deck_cutter = cutter('Temporary true dormer deck opening cutter', .5, 1.5, -.4, .4)
    slate_cutter = cutter('Temporary wider dormer slate cutback cutter', .45, 1.60, -.45, .45)
    try:
        for obj in parts:
            name = obj.get('constructionPart', obj.name)
            target = deck_cutter if name == 'Continuous hollow pitched timber weather deck' else (
                slate_cutter if name.startswith('Lapped staggered slate slope') else None)
            if target is not None:
                xs = [v.co.x for v in obj.data.vertices]
                ys = [v.co.y for v in obj.data.vertices]
                tx = [v.co.x for v in target.data.vertices]
                ty = [v.co.y for v in target.data.vertices]
                if max(xs) > min(tx) and min(xs) < max(tx) and max(ys) > min(ty) and min(ys) < max(ty):
                    g.kit.activate(obj)
                    mod = obj.modifiers.new('Applied paired dormer through opening', 'BOOLEAN')
                    mod.operation = 'DIFFERENCE'
                    mod.solver = 'EXACT'
                    mod.object = target
                    bpy.ops.object.modifier_apply(modifier=mod.name)
            if len(obj.data.polygons) == 0:
                g.PARTS.remove(obj)
                data = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                if data.users == 0:
                    bpy.data.meshes.remove(data)
                continue
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=2e-6)
            bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=2e-6)
            bmesh.ops.dissolve_limit(bm, angle_limit=1e-5,
                                     verts=list(bm.verts), edges=list(bm.edges))
            bmesh.ops.triangulate(bm, faces=list(bm.faces))
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(obj.data)
            bm.free()
            for face in obj.data.polygons:
                face.material_index = 0
            obj.data.update()
    finally:
        for obj in (deck_cutter, slate_cutter):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data.users == 0:
                bpy.data.meshes.remove(data)
