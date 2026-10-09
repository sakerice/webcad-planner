"""Repair existing named parts, rebuild canonical sources, and export one scene.

Run from Blender in background mode. Paths recorded in all reports are relative
to this delivery root. Never touches a manifest, remote, application, or network.
"""
import sys, json, hashlib
from pathlib import Path
import bpy

H = Path(__file__).resolve().parent
ROOT = H.parents[3]
sys.path.insert(0, str(H));sys.path.insert(0, str(H.parent))
import build as B
import joinery
import qa_support as qa
from shape_kit import unwrap
from export_contract import export

qa.ROOT = ROOT
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
descriptor = H / 'storage-items.json'
manifest = json.loads(descriptor.read_text())
checkpoint = H / 'repair-checkpoint.json'
if checkpoint.exists():
    state = json.loads(checkpoint.read_text())
else:
    state = {'revision': joinery.VERSION, 'status': 'repairing', 'baseline': {}, 'items': []}
    for item in manifest['items']:
        doc, binary = qa.load_glb(ROOT / item['model'])
        state['baseline'][item['id']] = {
            'geometrySignature': qa.shape_signature(doc, qa.scene_geometry(doc, binary)),
            'files': {item[k]: digest(ROOT / item[k]) for k in ['model', 'sourceBlend', 'authoringBlend', 'thumb', 'top', 'front', 'rear']}}
    checkpoint.write_text(json.dumps(state, indent=2)+'\n')


def sanitize():
    for scene in bpy.data.scenes:
        scene.render.filepath = '//renders/'
    for text in list(bpy.data.texts):
        bpy.data.texts.remove(text)
    for image in list(bpy.data.images):
        if image.source == 'FILE' and image.filepath:
            raise ValueError('Unexpected external image dependency: '+image.name)
    assert not bpy.data.libraries
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0


for item in manifest['items']:
    source = ROOT / item['sourceBlend']
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    native = next(scene for scene in bpy.data.scenes if scene.name.startswith('Native authoring parts'))
    bpy.context.window.scene = native
    for scene in list(bpy.data.scenes):
        if scene != native:
            for obj in list(scene.objects):
                if obj.name not in native.objects:
                    bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.scenes.remove(scene)
    B.PARTS = [obj for obj in native.objects if obj.type == 'MESH']
    palettes = {'wood':'Mansion walnut heartwood', 'trim':'Mansion walnut mouldings',
                'inset':'Mansion walnut veneered fields', 'brass':'Mansion patinated brass',
                'glass':'Mansion clear antique glazing', 'leather':'Mansion teal writing leather'}
    B.M = {key: next(mat for mat in bpy.data.materials if mat.name.startswith(prefix))
           for key, prefix in palettes.items() if any(mat.name.startswith(prefix) for mat in bpy.data.materials)}
    notes = joinery.repair(item['id'], B)
    if not notes:
        notes = next((r['repairs'] for r in state['items'] if r['id']==item['id']), [])
    joinery.planar_uv(B.PARTS)
    native.unit_settings.system = 'METRIC';native.unit_settings.scale_length = 1
    bpy.ops.object.select_all(action='DESELECT')
    sanitize()
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/item['authoringBlend']), compress=True)
    bpy.ops.scene.new(type='FULL_COPY')
    active = bpy.context.scene;active.name = 'Validated export mesh '+item['id']
    obj = B.kit.combine([o for o in active.objects if o.type == 'MESH'])
    obj.name = item['id']
    unwrap(obj)
    uv = B.kit.uv_report(obj)
    assert not uv['degenerate_world'] and not uv['degenerate_uv']
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = [min(p[a] for p in points) for a in range(3)]
    hi = [max(p[a] for p in points) for a in range(3)]
    dimensions = [(hi[a]-lo[a])*1000 for a in range(3)]
    assert max(abs(a-b) for a,b in zip(dimensions,[item['w'],item['d'],item['h']])) < 1
    sanitize()
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    path = ROOT / item['model']
    export(obj, str(path));B.stamp(path, item['id'])
    doc, binary = qa.load_glb(path)
    assert len(doc['meshes']) == len(doc['scenes']) == 1
    signature = qa.shape_signature(doc, qa.scene_geometry(doc, binary))
    changed = signature['point_support'] != state['baseline'][item['id']]['geometrySignature']['point_support']
    item['sha256'] = digest(path);item['sourceSha256'] = digest(source)
    item['joineryRevision'] = joinery.VERSION
    validation = {'model':item['id'], 'dimensions_mm':dimensions, 'bounds_m':[lo,hi],
                  'triangles':uv['total_triangles'], 'uv':uv,
                  'materials':{m.name:m.get('finishChannel') for m in obj.data.materials},
                  'front_blender':'-Y','front_gltf':'+Z','glb_bytes':path.stat().st_size,
                  'strictMeshCount':1,'strictSceneCount':1,'joineryRevision':joinery.VERSION}
    (ROOT/item['validation']).write_text(json.dumps(validation,indent=2)+'\n')
    row = {'id':item['id'],'status':'sources-exported','geometryChanged':changed,
           'nativeParts':sum(o.type=='MESH' for o in native.objects),'repairs':notes,
           'sourceSha256':item['sourceSha256'],'glbSha256':item['sha256']}
    state['items'] = [r for r in state['items'] if r['id'] != item['id']] + [row]
    checkpoint.write_text(json.dumps(state, indent=2)+'\n')
    descriptor.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('REPAIR_READY',item['id'],changed,len(notes),flush=True)

state['status'] = 'sources-exported-awaiting-contact-qa-and-changed-renders'
checkpoint.write_text(json.dumps(state,indent=2)+'\n')
