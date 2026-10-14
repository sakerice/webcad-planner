"""One original integrated kitchen. No global normalization or external assets.
Blender -b --threads 1 --factory-startup --python-exit-code 1 -P this.py
-- --output-root /tmp/kominka-kitchen-replay
"""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ID = 'kominka-kitchen-run-2560-01'
SIZE = (2560, 650, 850)
sys.path.insert(0, str(HERE.parents[1]))
import model_kit as kit

spec = importlib.util.spec_from_file_location('kominka_base', HERE.parent / 'build.py')
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)
b, c, t, l = H.box, H.cyl, H.tube, H.lathe
CHANNELS = ['wood', 'stone', 'plaster', 'metal']


def shift(obj, dx=0, dy=0, dz=0):
    obj.data.transform(Matrix.Translation((dx, dy, dz)))
    return obj


def board_door(cx, width):
    H.planks(cx, -.287, .332, width, .027, .456, n=5, vertical=True)
    for z in (.127, .537):
        b('Door cross rail', cx, -.307, z, width, .023, .032, 'dark', r=.002)
    H.handle(cx + width * .28, -.295, .352, .058)
    for x in (cx-width/2+.028, cx+width/2-.028):
        for z in (.155, .512):
            b('Forged door hinge', x, -.308, z, .033, .008, .032, 'metal', r=.001)


def firemouth(cx):
    # A closed arched cutter makes a real recessed hearth, rather than a decal.
    r, z0 = .143, .266
    outline = [(-r, .075), (r, .075), (r, z0)]
    outline += [(r*math.cos(math.pi*j/16), z0+r*math.sin(math.pi*j/16))
                for j in range(1, 17)]
    n = len(outline)
    verts = [(cx+x, y, z) for y in (-.36, -.177) for x, z in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    cutter = H.mesh('Temporary arched hearth cutter', verts, faces, 'fire')
    H.P.remove(cutter)
    kit.activate(cutter)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    body = next(o for o in H.P if o.name == 'Integrated lime plaster stove')
    kit.activate(body)
    mod = body.modifiers.new('Actual recessed fire chamber', 'BOOLEAN')
    mod.operation, mod.solver, mod.object = 'DIFFERENCE', 'EXACT', cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    b('Sooted chamber back', cx, -.182, .235, .283, .007, .30, 'fire', r=.012)
    b('Hearth ash bed', cx, -.233, .077, .281, .125, .014, 'ash', r=.002)
    for x in (cx-.166, cx+.166):
        b('Stone portal foot', x, -.295, .170, .042, .050, .190, 'stone', r=.004)
    for j in range(12):
        a = math.pi*j/11
        center = Vector((cx+.164*math.cos(a), -.296, .266+.164*math.sin(a)))
        obj = b('Stone arch voussoir', *center, .048, .049, .036, 'stone', r=.004)
        rot = Matrix.Rotation(a-math.pi/2, 3, 'Y')
        for v in obj.data.vertices:
            v.co = center + rot @ (v.co-center)
    b('Hearth threshold', cx, -.277, .045, .377, .095, .09, 'stone', r=.007)


def build():
    H.materials()
    # Preserve set 1's brass/soot/ash appearance, with this order's four channels.
    H.M['brass']['finishChannel'] = 'metal'
    H.M['fire']['finishChannel'] = 'plaster'
    H.M['ash']['finishChannel'] = 'stone'
    # Cabinet sized in metres. The full-width board envelope determines W/D.
    b('Recessed wooden plinth', -.50, .008, .0375, 1.52, .558, .075, 'dark', r=.004)
    for x in (-1.241, -.470, .269):
        b('Cabinet stile', x, .004, .348, .040, .586, .596, 'dark', r=.003)
    H.planks(-.50, .296, .362, 1.53, .036, .592, n=15, vertical=True, mat='dark')
    b('Lower cabinet shelf', -.49, .005, .097, 1.51, .561, .035, r=.003)
    b('Front bottom rail', -.49, -.286, .084, 1.51, .040, .036, 'dark')
    board_door(-1.046, .335)
    board_door(-.678, .335)
    b('Sink cabinet upper rail', -.865, -.280, .596, .732, .040, .065, 'wood')
    H.drawers(-.082, -.277, .110, .661, .506, n=3)
    # 54 mm continuous slab around the basin opening; no seam at cabinet bays.
    for name, x, y, w, d in [
        ('Continuous front slab', -.4975, -.301, 1.565, .048),
        ('Continuous rear slab', -.4975, .2885, 1.565, .073),
        ('Left slab end', -1.2475, -.012, .065, .529),
        ('Unbroken preparation slab', -.111, -.012, .792, .529)]:
        b(name, x, y, .663, w, d, .054, 'wood', r=.003)
    b('Low timber rear upstand', -.4975, .307, .727, 1.565, .036, .074, 'dark')
    b('Low plaster rear upstand', .7825, .307, .727, .995, .036, .074, 'plaster')
    # Closed continuous terrazzo vessel with an open, visibly deep interior.
    sink = H.profile('Grey terrazzo basin', [
        (.712, .535, .049, .570), (.712, .535, .049, .628),
        (.712, .535, .049, .694), (.606, .429, .038, .694),
        (.560, .380, .046, .596)], 'stone', cy=-.012, n=6)
    shift(sink, dx=-.865)
    c('Brass basin drain', -.865, -.020, .599, .026, .006, 'brass', sides=24)
    # A circular 24 mm tube, with a symmetric arch reaching exactly 850 mm.
    pts = [(-.865, .218, .705), (-.865, .218, .747)]
    pts += [(-.865, .142+.076*math.cos(math.pi*j/16),
             .762+.076*math.sin(math.pi*j/16)) for j in range(17)]
    pts += [(-.865, .066, .744)]
    t('Brass gooseneck faucet', pts, .012, 'brass', sides=16)
    c('Faucet mounting rose', -.865, .218, .705, .032, .022, 'brass', sides=24)
    c('Tap valve spindle', -.793, .218, .731, .014, .045, 'brass', sides=16)
    b('Tap cross handle', -.793, .218, .757, .078, .021, .012, 'brass', r=.004)
    # Same lime plaster and portal detailing as the first two sets.
    stove = H.profile('Integrated lime plaster stove', [
        (.995, .630, .048, 0), (.995, .630, .048, .095),
        (.975, .618, .050, .623), (.995, .630, .048, .690)],
        'plaster', cy=.010, n=6)
    shift(stove, dx=.7825)
    for cx in (.515, 1.030):
        firemouth(cx)
        l('Flanged iron hagama', [(.133, .611), (.163, .635),
            (.188, .701), (.216, .712), (.216, .729),
            (.184, .737), (.176, .787)], 'metal', cx=cx, cy=-.005, n=40)
        c('Solid wood rice pot lid', cx, -.005, .805, .193, .032, 'wood', sides=40)
        b('Rice pot lid cross grip', cx, -.005, .835, .286, .034, .030, 'dark', r=.003)
    obj = kit.combine(H.P)
    kit.activate(obj)
    bpy.ops.object.material_slot_remove_unused()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    mod = obj.modifiers.new('Explicit export triangulation', 'TRIANGULATE')
    mod.quad_method = 'BEAUTY'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj['provenance'] = 'original'
    obj['frontAxis'], obj['upAxis'], obj['pivot'] = '+Z', '+Y', 'bottom-center'
    obj['design'] = 'Direct metre geometry; no fit/normalize/nonuniform scaling'
    return obj


def entry():
    tags = json.loads((ROOT/'assets/models/tags.json').read_text())['kinds']
    return dict(id=ID, name='一体型の台所（古民家）', group='住設', kind='cooktop',
        category=tags['cooktop']['ja'], w=2560, d=650, h=850,
        defaultElevation=0, provenance='original',
        model=f'assets/models/packs/kominka/models/{ID}.glb',
        thumb=f'assets/models/packs/kominka/previews/{ID}-thumb.png',
        top=f'assets/models/packs/kominka/previews/{ID}-top.png',
        finishChannels=[dict(key=k, label=('金物' if k=='metal' else H.PALETTE[k][0]),
            default=H.PALETTE[k][1]) for k in CHANNELS])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output-root', type=Path, default=ROOT)
    p.add_argument('--append-manifest', action='store_true')
    a = p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out = a.output_root.resolve()
    kit.GLB_DIR = out/'assets/models/packs/kominka/models'
    kit.WORK_DIR = out/'tools/blender/kominka/set3/sources'
    kit.run([(ID, SIZE, build, set(CHANNELS), 20000)], do_export=True, do_icons=False)
    report = json.loads((kit.WORK_DIR/f'{ID}-validation.json').read_text())
    assert report['uv']['excluded_triangles'] == 0, report['uv']
    if a.append_manifest:
        path = out/'assets/models/packs/kominka/manifest.json'
        baseline = (path if path.exists() else ROOT/'assets/models/packs/kominka/manifest.json').read_text()
        manifest = json.loads(baseline)
        assert ID not in {i['id'] for i in manifest['items']}, 'Refuse to change an existing entry'
        tail = '  }\n ]\n}\n'
        assert baseline.endswith(tail), 'Unexpected manifest formatting'
        # Append exactly one compact row, leaving all existing rows byte-for-byte.
        row = json.dumps(entry(), ensure_ascii=False, separators=(',', ':'))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(baseline[:-len(tail)]+'  },\n  '+row+'\n ]\n}\n')


if __name__ == '__main__':
    main()
