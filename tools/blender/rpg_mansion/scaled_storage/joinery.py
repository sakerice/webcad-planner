"""Targeted, reversible construction repairs for the existing storage designs.

Original named parts and exterior footprints are preserved. Drawer clearance
and board seams are intentional; real small trays, runners, sockets, and lid
battens connect those moving/seamed assemblies to their carcasses.
"""
from mathutils import Vector

VERSION = 'storage-joinery-2'


def bounds(obj):
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return (Vector(tuple(min(p[i] for p in points) for i in range(3))),
            Vector(tuple(max(p[i] for p in points) for i in range(3))))


def translate(obj, delta):
    delta = Vector(delta)
    inv = obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        vertex.co = inv @ (obj.matrix_world @ vertex.co + delta)
    obj.data.update()


def stretch_axis(obj, axis, low=None, high=None):
    lo, hi = bounds(obj)
    newlo = lo[axis] if low is None else low
    newhi = hi[axis] if high is None else high
    inv = obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        point = obj.matrix_world @ vertex.co
        point[axis] = newlo + (point[axis] - lo[axis]) / (hi[axis] - lo[axis]) * (newhi - newlo)
        vertex.co = inv @ point
    obj.data.update()


def repair(stem, B):
    scene = B.bpy.context.scene
    if scene.get('joineryRevision') == VERSION:
        return []
    parts = list(B.PARTS)
    notes = []
    slug = stem.removeprefix('rpg-mansion-').removesuffix('-01')
    find = lambda prefix: [o for o in parts if o.name.startswith(prefix)]

    if slug in {'linen-press', 'louver-cupboard', 'apothecary-chest',
                'glazed-credenza', 'tambour-music', 'letter-pigeonhole'}:
        for obj in find('Moulded crown cap'):
            lo, hi = bounds(obj)
            stretch_axis(obj, 2, low=lo.z - .005)
        notes.append('Crown underside seated 1 mm into carcass top; original top height unchanged')

    if slug == 'bow-commode':
        for obj in parts:
            if 'lock circular key escutcheon' in obj.name:
                translate(obj, (0, .003, 0))
        notes.append('Three lock escutcheons seated against convex drawer fronts')

    if slug == 'arched-vitrine':
        for obj in find('Shelf brass peg'):
            lo, hi = bounds(obj)
            translate(obj, (.046 if (lo.x + hi.x) > 0 else -.046, 0, .002))
        for obj in find('Cabinet brass latch'):
            lo, hi = bounds(obj)
            translate(obj, (-.010 if (lo.x + hi.x) > 0 else .010, 0, 0))
        for obj in find('Cornice upper overhang'):
            lo, hi = bounds(obj)
            stretch_axis(obj, 2, low=lo.z - .001)
        notes += ['Shelf pegs enter sideboards and bear against shelf undersides',
                  'Both latch roses overlap the door meeting stile',
                  'Upper overhang seated against lower cornice step']

    if slug == 'slant-bureau':
        for obj in parts:
            if obj.name.startswith('Bureau drawer') and ' ring ' in obj.name:
                translate(obj, (0, .0085, 0))
            if obj.name.startswith('Bureau drawer lock'):
                translate(obj, (0, .0145, 0))
            if obj.name.startswith('Bureau backboard tongue joint'):
                translate(obj, (0, -.007, 0))
        for i, (floorz, upper) in enumerate([(.2145, .367), (.4155, .569), (.6165, .773)], 1):
            B.box('Bureau drawer %d fitted tray bottom' % i, (-.417, -.222, floorz-.005), (.417, .208, floorz+.005), b=.001)
            for x in [-.410, .410]:
                B.centerbox('Bureau drawer %d tray side' % i, (x, -.007, (floorz+upper)/2), (.014, .430, upper-floorz), b=.001)
            B.box('Bureau drawer %d tray back' % i, (-.410, .194, floorz), (.410, .208, upper), b=.001)
        notes += ['Three hollow drawer trays bear on their original dust shelves',
                  'Brass drawer hardware seated on veneered fields',
                  'Rear applied tongue joints seated against backboard']

    if slug == 'blanket-coffer':
        for obj in find('Blanket chest block foot'):
            stretch_axis(obj, 2, high=.1645)
        B.centerbox('Blanket chest fitted bottom board', (0, 0, .157), (.994, .515, .016), b=.001)
        for y in [-.205, .205]:
            B.centerbox('Blanket lid underside cross batten', (0, y, .5505), (1.004, .030, .020), 'wood', .001)
        notes += ['Four block feet enter a fitted chest bottom, supporting the wall boards',
                  'Two narrow underside battens bind the five lid boards across intentional seams']

    if slug == 'arched-armoire':
        for obj in find('Armoire interior hanging rail'):
            stretch_axis(obj, 0, low=-.519, high=.519)
        for sign in [-1, 1]:
            B.rod('Armoire hanging rail brass socket', (sign*.514, .092, 1.763), (sign*.530, .092, 1.763), .020, n=12)
        notes.append('Hanging rail ends enter two compact brass sockets seated in sideboards')

    if slug == 'glazed-credenza':
        for x in [-.346, .346]:
            B.centerbox('Credenza center drawer wooden runner', (x, 0, .445), (.020, .360, .018), b=.001)
        B.box('Credenza center drawer fitted tray bottom', (-.329, -.178, .451), (.329, .156, .463), b=.001)
        for x in [-.323, .323]:
            B.box('Credenza center drawer tray side', (x-.006, -.178, .457), (x+.006, .156, .586), b=.001)
        B.box('Credenza center drawer tray back', (-.323, .142, .457), (.323, .156, .586), b=.001)
        notes.append('Hollow center drawer tray bears on paired runners housed in interior divisions')

    if slug == 'letter-pigeonhole':
        for obj in find('Lower correspondence drawer walnut front'):
            lo, hi = bounds(obj);x=(lo.x+hi.x)/2
            B.box('Correspondence drawer fitted tray bottom', (lo.x+.008, -.091, .200), (hi.x-.008, .094, .210), b=.001)
            for side in [lo.x+.014, hi.x-.014]:
                B.box('Correspondence drawer tray side', (side-.006, -.091, .205), (side+.006, .094, .373), b=.001)
            B.box('Correspondence drawer tray back', (lo.x+.014, .081, .205), (hi.x-.014, .094, .373), b=.001)
        notes.append('Two shallow hollow correspondence drawers bear on the lowest shelf')

    scene['joineryRevision'] = VERSION
    for obj in B.PARTS:
        if obj not in parts:
            obj['joineryRevision'] = VERSION
            obj['constructionPart'] = obj.name
    return notes


def planar_uv(parts):
    """One finite, nondegenerate world-space projection on every editable part."""
    for obj in parts:
        obj.data.update()
        uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
        for poly in obj.data.polygons:
            axes = [i for i in range(3) if i != max(range(3), key=lambda j: abs(poly.normal[j]))]
            for li in poly.loop_indices:
                point = obj.matrix_world @ obj.data.vertices[obj.data.loops[li].vertex_index].co
                uv.data[li].uv = (point[axes[0]], point[axes[1]])
        for layer in list(obj.data.uv_layers):
            if layer != uv:
                obj.data.uv_layers.remove(layer)
        uv.active_render = True
