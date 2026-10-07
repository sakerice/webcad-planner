"""Five original mansion kitchen shapes, additive to the existing fifty.

Uses the project model_kit validation, UV/export and preview renderer. Geometry
is authored at its final size, without fitting a tall cabinet into a base unit.
These are manual decorative assets, not replacements for functional kitchens.

blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/kitchen/build.py
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
ROOT = FAMILY.parents[2]
sys.path.insert(0, str(FAMILY))
sys.path.insert(0, str(FAMILY.parent))
import build as old
import importlib.util
spec = importlib.util.spec_from_file_location('mansion_expansion', FAMILY / 'expansion/build.py')
exp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exp)
from model_kit import bpy
from build_decor import mesh_part, loop, lathe
from mathutils import Matrix, Vector
kit = old.kit
WORK = HERE / 'work'
P = {}


def box(name, center, size, material='wood', bevel=.003):
    return old.block(name, center, size, material, bevel)


def prism(name, polygon, bottom, top, material='wood', bevel=.003):
    """Closed CCW polygon extrusion, including the concave corner footprint."""
    n = len(polygon)
    verts = [(x, y, z) for z in (bottom, top) for x, y in polygon]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    obj = mesh_part(name, verts, faces, P[material])
    return kit.bevel(obj, bevel, 1) if bevel else obj


def door(center, width, height, angle=0, pulls=1):
    """Raised walnut field and brass hardware on a physically closed frame."""
    before = set(bpy.context.scene.objects)
    exp.panel('Framed walnut door', 0, 0, center[2], width, height)
    for x in ([0] if pulls == 1 else [-width * .23, width * .23]):
        exp.knob(x, -.045, center[2])
    rot = Matrix.Rotation(angle, 4, 'Z')
    for obj in set(bpy.context.scene.objects) - before:
        for vertex in obj.data.vertices:
            vertex.co = rot @ vertex.co + Vector((center[0], center[1], 0))
        obj.data.update()


def base(drawers=False):
    w = .45 if drawers else .60
    box('Recessed continuous toe plinth', (0, .020, .060), (w - .06, .58, .12), 'trim')
    box('Base carcass', (0, .0125, .4575), (w - .04, .585, .715))
    box('Stone countertop', (0, 0, .835), (w, .650, .030), 'stone')
    for x in [-w / 2 + .026, w / 2 - .026]:
        box('Front pilaster', (x, -.278, .461), (.034, .036, .700), 'trim')
        for z in [.147, .775]:
            box('Pilaster brass collar', (x, -.298, z), (.036, .006, .012), 'brass', .001)
    if drawers:
        for z, h in [(.701, .190), (.456, .282), (.171, .240)]:
            door((0, -.262, z), w - .092, h, pulls=1)
    else:
        for x in [-.132, .132]:
            door((x, -.262, .464), .254, .670)


CORNER = [(-.45, -.20), (-.20, -.20), (-.20, -.45), (.45, -.45), (.45, .45), (-.45, .45)]


def corner():
    # An actual 250mm return notch, never a solid square relabelled as a corner.
    prism('L-shaped recessed plinth', [(x * .94, y * .94) for x, y in CORNER], 0, .115, 'trim')
    # The carcass is recessed behind all three doors. A solid full-footprint
    # extrusion would bury the mouldings and leave floating-looking knobs.
    carcass = [(-.43, -.11), (-.11, -.11), (-.11, -.36), (.43, -.36), (.43, .43), (-.43, .43)]
    prism('L-shaped cupboard carcass', carcass, .10, .818)
    prism('Continuous L-shaped stone worktop', CORNER, .82, .85, 'stone')
    door((.130, -.369, .465), .546, .668, pulls=2)
    door((-.122, -.260, .465), .194, .668, angle=-math.pi / 2)
    door((-.325, -.122, .465), .194, .668)
    box('Return upright', (-.111, -.120, .465), (.022, .022, .690), 'trim')
    for x in [-.404, .401]:
        box('Corner outer pilaster', (x, -.135 if x < 0 else -.382, .465), (.033, .035, .690), 'trim')


def wall_cupboard():
    box('Wall cupboard back', (0, .140, .35), (.54, .040, .64))
    for x in [-.265, .265]:
        box('Wall cupboard side', (x, .015, .350), (.040, .30, .650))
    for z in [.036, .338, .651]:
        box('Shelf board', (0, .030, z), (.54, .25, .030), 'trim')
    box('Moulded lower rail', (0, .0125, .022), (.58, .325, .044), 'trim')
    box('Moulded crown', (0, 0, .675), (.60, .35, .050), 'trim')
    for x in [-.133, .133]:
        door((x, -.1025, .350), .245, .584)
    # A real pair of fixed rear mounting plates. Placement still requires a wall.
    for x in [-.21, .21]:
        box('Rear mounting plate', (x, .169, .580), (.055, .012, .080), 'brass', .001)


def pan_rack():
    # Wall-hung utensil display: three visibly different, closed cookware profiles.
    box('Carved walnut mounting rail', (0, .064, .490), (.80, .052, .120), 'trim')
    for x in [-.335, .335]:
        kit.cylinder('Rail mounting medallion', (x, .030, .490), .030, .015, P['brass'], 'Y', 16)
    exp.rod('Brass hanging rail', (-.37, -.015, .455), (.37, -.015, .455), .015)
    for x in [-.34, .34]:
        exp.rod('Wall bracket', (x, .040, .455), (x, -.015, .455), .012)
    for x, radius, z, material in [(-.240, .095, .157, 'iron'), (0, .120, .132, 'brass'), (.255, .080, .217, 'iron')]:
        # Create a continuous revolved shallow pan, then orient its open face forward.
        before = set(bpy.context.scene.objects)
        obj = lathe('Open hanging pan', [(radius * .80, 0), (radius, .008), (radius, .034),
                                        (radius - .012, .040), (radius - .025, .013),
                                        (min(radius * .72, radius - .032), .013)], P[material], sides=20)
        for vertex in obj.data.vertices:
            q = vertex.co.copy()
            vertex.co = Vector((q.x + x, -q.z -.025, q.y + z))
        obj.data.update()
        exp.rod('Cookware handle', (x, -.033, z + radius * .80), (x, -.033, .392), .011, material)
        loop('Cookware hanging eye', (x, -.033, .405), .017, .025, .006, P[material], vertical=True, steps=12)
        exp.rod('Supported brass hook', (x, -.015, .455), (x, -.033, .411), .007)
    # Lowest copper pan has an explicit 12mm low rim, with overall height set by rail.


SPECS = [
    ('kitchen-base-cupboard', '石天板の低い洋館キッチン戸棚', (600, 650, 850), lambda: base(False), 'floor', 0,
     'Closed double-door base storage; full stone counter at 850mm. Static doors, no sink or appliance.', ['wood', 'metal', 'stone']),
    ('kitchen-drawer-base', '石天板の三段引出しキッチン台', (450, 650, 850), lambda: base(True), 'floor', 0,
     'Three different-height drawer fronts with a full 850mm stone counter. Static drawers, no dishwasher.', ['wood', 'metal', 'stone']),
    ('kitchen-corner-base', 'L字天板のコーナーキッチン戸棚', (900, 900, 850), corner, 'floor', 0,
     'L-shaped counter with a 250mm return notch and three cupboard fronts on two orientations. Left return; static doors.', ['wood', 'metal', 'stone']),
    ('kitchen-wall-cupboard', '壁付けの浅型食器戸棚', (600, 350, 700), wall_cupboard, 'wall', 1400,
     'Wall installation required. Bottom defaults to 1400mm; align rear with the wall and check clearance manually. Static doors.', ['wood', 'metal']),
    ('kitchen-pan-rack', '壁付け真鍮レールの鍋掛け', (800, 180, 550), pan_rack, 'wall', 1450,
     'Wall installation required. Bottom defaults to 1450mm; align rear mounting rail with wall manually. Cookware is fixed decoration.', ['wood', 'metal']),
]


def build(fn, size):
    global P
    old.P = old.palette()
    P = old.P
    P['stone'] = kit.matp('RPG warm limestone', '#b8ad96', .90, 0)
    P['stone']['finishChannel'] = 'stone'
    P['iron'] = kit.matp('RPG cast iron', '#343b3b', .62, .65)
    P['iron']['finishChannel'] = 'metal'
    exp.P = P
    fn()
    obj = kit.combine([o for o in bpy.context.scene.objects if o.type == 'MESH'])
    # Bake all join transforms into vertices, matching the existing exported pack.
    matrix = obj.matrix_world.copy()
    for vertex in obj.data.vertices:
        vertex.co = matrix @ vertex.co
    obj.matrix_world.identity()
    # Rack depth is authored as 180mm envelope; centre all shape pivots only.
    if fn == pan_rack:
        pts = [v.co.copy() for v in obj.data.vertices]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        # Only the decorative rack uses envelope fitting; storage support heights
        # and corner topology are never rescaled by this branch.
        for v in obj.data.vertices:
            for i in range(3):
                v.co[i] = (v.co[i] - lo[i]) / (hi[i] - lo[i]) * size[i] / 1000 - (size[i] / 2000 if i < 2 else 0)
    obj.data.update()
    return obj


def main():
    from render_config import configure
    from png_metadata import strip_metadata
    configure()
    kit.WORK_DIR = WORK
    manifest_path = old.PACK / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    original = manifest['items'][:50]
    existing = {item['id']: item for item in manifest['items']}
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
    for slug, name, size, fn, placement, elevation, note, channels in SPECS:
        if only and slug not in only:
            continue
        stem = 'rpg-mansion-' + slug + '-01'
        obj = kit.run([(stem, size, lambda fn=fn, size=size: build(fn, size), set(channels), 6000)])[0]
        path = kit.GLB_DIR / (stem + '.glb')
        b = path.read_bytes()
        n = struct.unpack_from('<I', b, 12)[0]
        gltf = json.loads(b[20:20 + n])
        gltf['asset']['extras'] = {'front': '+Z', 'up': '+Y', 'units': 'metres', 'origin': 'bottom-centre',
                                 'packId': 'rpg-mansion', 'provenance': 'Original procedural Blender geometry; no imported geometry or imagery',
                                 'source': 'tools/blender/rpg_mansion/kitchen/build.py'}
        raw = json.dumps(gltf, separators=(',', ':')).encode()
        raw += b' ' * ((-len(raw)) % 4)
        rest = b[20 + n:]
        path.write_bytes(struct.pack('<III', 0x46546c67, 2, 20 + len(raw) + len(rest)) + struct.pack('<II', len(raw), 0x4e4f534a) + raw + rest)
        report = WORK / (stem + '-validation.json')
        validation = json.loads(report.read_text())
        validation.update(glb_bytes=path.stat().st_size, glb_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                          placement_hint=placement, installation=note, support_height_mm=850 if placement == 'floor' else None)
        report.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
        if '--no-icons' not in sys.argv:
            for image in [kit.PREVIEW_DIR / (stem + '-thumb.png'), kit.PREVIEW_DIR / (stem + '-top.png'), WORK / (stem + '-rear.png')]:
                strip_metadata(image)
        rel = lambda p: str(p.relative_to(ROOT))
        desc = [{'key': key, 'label': {'wood': '木部', 'metal': '金属', 'stone': '石材'}[key],
                 'default': {'wood': '#493025', 'metal': '#b29455', 'stone': '#b8ad96'}[key]} for key in sorted(channels)]
        existing[stem] = dict(id=stem, name=name, packId='rpg-mansion', group='家具', category='キッチン',
                             sourceFolder='BlenderRpgMansion', model=rel(path), thumb=rel(kit.PREVIEW_DIR / (stem + '-thumb.png')),
                             top=rel(kit.PREVIEW_DIR / (stem + '-top.png')), rear=rel(WORK / (stem + '-rear.png')),
                             sourceBlend=rel(WORK / (stem + '.blend')), validation=rel(report), w=size[0], d=size[1], h=size[2],
                             defaultElevation=elevation, provenance='original', builder=rel(HERE / 'build.py'), finishChannels=desc,
                             placementHint=placement, placementNotes=note, front='+Z', previewVersion=1)
        manifest.update(version='0.3.0', status='integrated-review', items=list(existing.values()))
        assert manifest['items'][:50] == original, 'Existing pack entries must stay unchanged'
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        print('KITCHEN_COMPLETE ' + stem, flush=True)


if __name__ == '__main__':
    main()
