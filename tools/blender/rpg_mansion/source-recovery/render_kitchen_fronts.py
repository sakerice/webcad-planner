"""Render missing kitchen front QA without resaving or editing existing assets.
blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/source-recovery/render_kitchen_fronts.py
"""
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
ROOT = FAMILY.parents[2]
sys.path.insert(0, str(FAMILY))
import restore_sources as recovery
import bpy


def main():
    items = json.loads((ROOT / 'assets/models/packs/rpg-mansion/manifest.json').read_text())['items']
    kitchen = [item for item in items if item['id'].startswith('rpg-mansion-kitchen-') and item['id'] != 'rpg-mansion-kitchen-hutch-01']
    assert len(kitchen) == 5
    work = FAMILY / 'kitchen/work'
    inputs = []
    for item in kitchen:
        stem = item['id']
        inputs += [work / (stem+'.blend'), work / (stem+'-rear.png'), ROOT / item['validation']]
        inputs += [ROOT / item[key] for key in ('model', 'thumb', 'top')]
    before = {recovery.rel(path): recovery.sha(path) for path in inputs}
    paths = {}
    records = []
    for item in kitchen:
        stem = item['id']
        source = work / (stem+'.blend')
        front = work / (stem+'-front.png')
        bpy.ops.wm.open_mainfile(filepath=str(source))
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
        assert len(meshes) == 1 and meshes[0].name == stem
        recovery.render_qa(meshes[0], front, samples=24)
        paths[stem] = {'front': recovery.rel(front)}
        records.append({'id': stem, 'front': recovery.rel(front), 'front_sha256': recovery.sha(front),
                        'existing_source': recovery.rel(source), 'existing_source_sha256': recovery.sha(source),
                        'render': {'engine': 'Cycles', 'samples': 24, 'threads': 2, 'resolution': [512, 512], 'front_camera_blender': '-Y'},
                        'source_resaved': False})
        print('KITCHEN_FRONT_COMPLETE '+stem, flush=True)
    after = {recovery.rel(path): recovery.sha(path) for path in inputs}
    assert before == after, 'Existing kitchen asset bytes changed'
    recovery.write_json(HERE / 'kitchen-front-map.json', paths)
    recovery.write_json(HERE / 'kitchen-front-report.json', {'completed_front_images': len(records),
        'existing_source_rear_public_validation_hashes_preserved': before == after,
        'preserved_inputs_sha256': before, 'front_images': records, 'blender_version': bpy.app.version_string})
    print('KITCHEN_FRONT_FINISHED complete='+str(len(records))+' existing_bytes_preserved=True', flush=True)


if __name__ == '__main__':
    main()
