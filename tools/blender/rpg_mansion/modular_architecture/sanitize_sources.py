"""Remove private saved paths without changing any geometry, UVs or materials.

Run in Blender after production. Sources are saved compressed. Appended native
meshes are copied and remapped solely to remove their weak-library provenance;
the original geometry is retained and checked exactly before and after saving.
"""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def digest_array(collection, property_name, width, dtype):
    values = np.empty(len(collection) * width, dtype=dtype)
    collection.foreach_get(property_name, values)
    return hashlib.sha256(values.tobytes()).hexdigest()


def scene_fingerprints():
    result = {}
    for scene in bpy.data.scenes:
        parts = []
        for obj in sorted(scene.objects, key=lambda value: value.name):
            if obj.type != 'MESH':
                continue
            mesh = obj.data
            parts.append({
                'object': obj.name,
                'mesh': mesh.name,
                'matrix': [list(row) for row in obj.matrix_world],
                'vertices': digest_array(mesh.vertices, 'co', 3, np.float32),
                'loop_vertices': digest_array(mesh.loops, 'vertex_index', 1, np.int32),
                'loop_edges': digest_array(mesh.loops, 'edge_index', 1, np.int32),
                'polygon_starts': digest_array(mesh.polygons, 'loop_start', 1, np.int32),
                'polygon_lengths': digest_array(mesh.polygons, 'loop_total', 1, np.int32),
                'polygon_materials': digest_array(mesh.polygons, 'material_index', 1, np.int32),
                'smooth_faces': digest_array(mesh.polygons, 'use_smooth', 1, np.bool_),
                'uv_layers': {layer.name: digest_array(layer.data, 'uv', 2, np.float32)
                              for layer in mesh.uv_layers},
                'materials': [(mat.name, mat.get('finishChannel')) for mat in mesh.materials],
                'object_properties': dict(obj.items()),
            })
        result[scene.name] = parts
    return result


def sanitize_loaded(asset_id):
    paths_changed = 0
    for scene in bpy.data.scenes:
        clean_path = '//' + asset_id + '-render.png'
        if scene.render.filepath != clean_path:
            paths_changed += 1
        scene.render.filepath = clean_path
    browser_paths = 0
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type != 'FILE_BROWSER' or space.params is None:
                    continue
                # RNA string assignment may retain old bytes after the first
                # NUL. Fill the complete fixed-length buffer with benign bytes
                # before assigning the real relative browser directory.
                space.params.directory = b'//' + b' ' * 1021
                space.params.directory = b'//'
                browser_paths += 1
    assert not bpy.data.libraries, 'No linked-library source is allowed'
    assert not [im for im in bpy.data.images if im.source == 'FILE' and im.filepath], \
        'No external-image source is allowed'
    replaced = 0
    for block in list(bpy.data.user_map()):
        if getattr(block, 'library_weak_reference', None) is None:
            continue
        # Blender copies do not retain library_weak_reference. user_remap keeps
        # all consumers, UV layers, material assignments and named native parts.
        old_name = block.name
        replacement = block.copy()
        assert replacement.library_weak_reference is None
        block.user_remap(replacement)
        bpy.data.batch_remove(ids=[block])
        replacement.name = old_name
        replaced += 1
    purged = bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    assert not any(getattr(block, 'library_weak_reference', None)
                   for block in bpy.data.user_map())
    return {'relativeRenderPaths': paths_changed, 'relativeBrowserPaths': browser_paths,
            'removedWeakReferences': replaced,
            'purgedOrphanDatablocks': purged}


def main():
    items = json.loads((HERE / 'descriptors.json').read_text())
    prior_path = HERE / 'source-sanitization-qa.json'
    prior = {(row['id'], row['field']): row for row in
             json.loads(prior_path.read_text())['items']} if prior_path.exists() else {}
    reports = []
    for item in items:
        for field in ['authoringBlend', 'sourceBlend']:
            path = ROOT / item[field]
            bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
            active_name = bpy.context.scene.name
            before = scene_fingerprints()
            info = sanitize_loaded(item['id'])
            old_info = prior.get((item['id'], field), {})
            for key in ['relativeRenderPaths', 'removedWeakReferences', 'purgedOrphanDatablocks']:
                info[key] += old_info.get(key, 0)
            assert scene_fingerprints() == before, 'In-memory native geometry changed'
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
            bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
            assert bpy.context.scene.name == active_name
            assert scene_fingerprints() == before, 'Saved native geometry/UVs changed'
            if field == 'sourceBlend':
                assert len([ob for ob in bpy.context.scene.objects if ob.type == 'MESH']) == 1
                assert 'Native authoring parts' in bpy.data.scenes
                assert len(bpy.data.scenes) == 2
            else:
                assert len([ob for ob in bpy.context.scene.objects if ob.type == 'MESH']) > 1
            fingerprint = hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest()
            row = dict(id=item['id'], field=field, path=item[field], **info,
                       exactGeometryUvMaterialFingerprint=fingerprint,
                       exactGeometryUvMaterialsPreserved=True,
                       bytes=path.stat().st_size,
                       sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            reports.append(row)
            (HERE / 'source-sanitization-qa.json').write_text(
                json.dumps({'items': reports, 'errors': [], 'complete': len(reports) == len(items)*2},
                           indent=2) + '\n')
            print('SANITIZED', item['id'], field, info, flush=True)
    print('SANITIZED_SOURCES', len(reports), flush=True)


if __name__ == '__main__':
    main()
