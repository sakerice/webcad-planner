"""Normalize unused saved UI directories without changing authored content.

Run in Blender. Both canonical two-scene and separate part-only checkpoints
are compactly saved and reopened. No geometry regeneration, export or render
runs. Exact authored-data signatures and all GLB/PNG byte hashes must match.
"""
from pathlib import Path
import hashlib
import json
import sys
import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {'bytes': value.hex()}
    if isinstance(value, bpy.types.ID):
        return {'id_type': value.bl_rna.identifier, 'name': value.name}
    if hasattr(value, 'items'):
        return {str(key): plain(val) for key, val in sorted(value.items())}
    if isinstance(value, set):
        return sorted(value)
    try:
        return [plain(val) for val in value]
    except TypeError:
        return str(value)


def properties(value):
    return {key: plain(value[key]) for key in sorted(value.keys())}


def rna_values(value):
    """Capture authored scalar/array settings and named ID references."""
    result = {}
    for prop in value.bl_rna.properties:
        if prop.identifier == 'rna_type' or prop.is_readonly:
            continue
        if prop.type in {'BOOLEAN', 'INT', 'FLOAT', 'STRING', 'ENUM'}:
            result[prop.identifier] = plain(getattr(value, prop.identifier))
        elif prop.type == 'POINTER':
            target = getattr(value, prop.identifier)
            if target is None or isinstance(target, bpy.types.ID):
                result[prop.identifier] = plain(target)
    return result


def node_tree_values(tree):
    if tree is None:
        return None
    nodes = []
    for node in sorted(tree.nodes, key=lambda value: value.name):
        sockets = {}
        for key in ('inputs', 'outputs'):
            sockets[key] = [{'identifier': socket.identifier,
                             'type': socket.bl_idname,
                             'settings': rna_values(socket),
                             'default': plain(socket.default_value) if hasattr(socket, 'default_value') else None}
                            for socket in getattr(node, key)]
        nodes.append({'name': node.name, 'type': node.bl_idname,
                      'settings': rna_values(node), 'properties': properties(node),
                      'parent': node.parent.name if node.parent else None, **sockets})
    return {'name': tree.name, 'properties': properties(tree), 'settings': rna_values(tree),
            'nodes': nodes, 'links': sorted((link.from_node.name, link.from_socket.identifier,
                                          link.to_node.name, link.to_socket.identifier) for link in tree.links)}


def content_payload():
    meshes, objects, materials, scenes = [], [], [], []
    for mesh in sorted(bpy.data.meshes, key=lambda value: value.name):
        mesh.calc_loop_triangles()
        meshes.append({'name': mesh.name, 'properties': properties(mesh), 'settings': rna_values(mesh),
                       'vertices': [tuple(value.co) for value in mesh.vertices],
                       'edges': [tuple(value.vertices) for value in mesh.edges],
                       'loops': [(value.vertex_index, value.edge_index) for value in mesh.loops],
                       'polygons': [(tuple(value.vertices), value.material_index, value.use_smooth) for value in mesh.polygons],
                       'triangles': [(tuple(value.vertices), tuple(value.loops), value.material_index) for value in mesh.loop_triangles],
                       'has_custom_normals': mesh.has_custom_normals,
                       'corner_normals': [tuple(value.vector) for value in mesh.corner_normals],
                       'uv_layers': [(layer.name, layer.active_render, [tuple(value.uv) for value in layer.data]) for layer in mesh.uv_layers],
                       'active_uv': mesh.uv_layers.active_index,
                       'attributes': [{'name': attr.name, 'type': attr.data_type, 'domain': attr.domain,
                                       'values': [rna_values(value) for value in attr.data]}
                                      for attr in mesh.attributes],
                       'materials': [value.name if value else None for value in mesh.materials]})
    for obj in sorted(bpy.data.objects, key=lambda value: value.name):
        objects.append({'name': obj.name, 'type': obj.type, 'data': obj.data.name if obj.data else None,
                        'properties': properties(obj), 'settings': rna_values(obj),
                        'matrix_world': [list(value) for value in obj.matrix_world],
                        'matrix_basis': [list(value) for value in obj.matrix_basis],
                        'parent': obj.parent.name if obj.parent else None,
                        'modifiers': [{'name': value.name, 'type': value.type, 'settings': rna_values(value)} for value in obj.modifiers],
                        'constraints': [{'name': value.name, 'type': value.type, 'settings': rna_values(value)} for value in obj.constraints]})
    for mat in sorted(bpy.data.materials, key=lambda value: value.name):
        materials.append({'name': mat.name, 'properties': properties(mat),
                          'settings': rna_values(mat), 'node_tree': node_tree_values(mat.node_tree)})
    for scene in sorted(bpy.data.scenes, key=lambda value: value.name):
        scenes.append({'name': scene.name, 'properties': properties(scene), 'settings': rna_values(scene),
                       'objects': sorted(value.name for value in scene.objects),
                       'units': rna_values(scene.unit_settings), 'render': rna_values(scene.render),
                       'node_tree': node_tree_values(scene.node_tree),
                       'view_layers': [{'name': value.name, 'settings': rna_values(value)} for value in scene.view_layers]})
    collections = [{'name': value.name, 'properties': properties(value), 'settings': rna_values(value),
                    'objects': sorted(obj.name for obj in value.objects), 'children': sorted(child.name for child in value.children)}
                   for value in sorted(bpy.data.collections, key=lambda value: value.name)]
    worlds = [{'name': value.name, 'properties': properties(value), 'settings': rna_values(value),
               'node_tree': node_tree_values(value.node_tree)} for value in sorted(bpy.data.worlds, key=lambda value: value.name)]
    images = [{'name': value.name, 'properties': properties(value), 'settings': rna_values(value)}
              for value in sorted(bpy.data.images, key=lambda value: value.name)]
    texts = [{'name': value.name, 'filepath': value.filepath, 'text': value.as_string(), 'properties': properties(value)}
             for value in sorted(bpy.data.texts, key=lambda value: value.name)]
    extras = {key: [{'name': value.name, 'properties': properties(value), 'settings': rna_values(value)} for value in sorted(getattr(bpy.data, key), key=lambda value: value.name)]
              for key in ('cameras', 'lights', 'curves', 'armatures', 'shape_keys')}
    return {'meshes': meshes, 'objects': objects, 'materials': materials, 'scenes': scenes,
            'collections': collections, 'worlds': worlds, 'images': images, 'texts': texts,
            'node_groups': [node_tree_values(value) for value in sorted(bpy.data.node_groups, key=lambda value: value.name)],
            'libraries': [value.filepath for value in bpy.data.libraries], 'extras': extras,
            'active_scene': bpy.context.scene.name}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def normalize_unused_ui():
    counts = {'browserDirectoriesNormalized': 0, 'browserSearchHistoriesCleared': 0,
              'browserBookmarkHistoriesNormalized': 0, 'spacesInspected': 0}
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:  # Includes inactive spaces retained by each area.
                counts['spacesInspected'] += 1
                if space.type != 'FILE_BROWSER':
                    continue
                params = space.params
                if params is not None:
                    if params.directory != b'//':
                        params.directory = b'//'
                        counts['browserDirectoriesNormalized'] += 1
                    for key in ('filename', 'filter_search'):
                        if getattr(params, key):
                            setattr(params, key, '')
                            counts['browserSearchHistoriesCleared'] += 1
                # User-saved lists only. Generated system folders are runtime state.
                for key in ('bookmarks', 'recent_folders'):
                    for bookmark in getattr(space, key):
                        if bookmark.path and not bookmark.path.startswith('//'):
                            bookmark.path = '//'
                            counts['browserBookmarkHistoriesNormalized'] += 1
    return counts


def main():
    items = json.loads((HERE / 'storage-items.json').read_text())['items']
    if '--' in sys.argv:
        ids = set(sys.argv[sys.argv.index('--') + 1:])
        if ids:
            items = [item for item in items if item['id'] in ids]
    immutable = {item[key]: sha256(ROOT / item[key]) for item in json.loads((HERE / 'storage-items.json').read_text())['items']
                 for key in ('model', 'thumb', 'top', 'front', 'rear')}
    report_path = HERE / 'source-ui-cleanup-report.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {
        'revision': 'storage-source-ui-1',
        'scope': 'Metadata/UI-only source changes; no geometry, UV, corner normal, material graph, custom property, GLB or image change',
        'method': 'Normalize unused FILE_BROWSER directories and saved search/bookmark histories across active and inactive spaces; compressed save/reopen with exact authored-data signatures',
        'items': [], 'immutableFiles': [{'path': name, 'sha256': value} for name, value in sorted(immutable.items())], 'errors': []}
    assert {row['path']: row['sha256'] for row in report['immutableFiles']} == immutable
    for item in items:
        for key in ('sourceBlend', 'authoringBlend'):
            path = ROOT / item[key]
            previous = next((row for row in report['items'] if row['sourcePath'] == item[key]), None)
            if previous and previous['sourceSha256'] == sha256(path):
                continue
            original = path.read_bytes()
            bpy.ops.wm.open_mainfile(filepath=str(path))
            before = content_payload()
            signature = digest(before)
            counts = normalize_unused_ui()
            assert digest(content_payload()) == signature, 'Authored content changed while normalizing saved UI'
            bpy.context.preferences.filepaths.save_version = 0
            try:
                bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
                bpy.ops.wm.open_mainfile(filepath=str(path))
                after = content_payload()
                changed = [category for category in before if digest(before[category]) != digest(after[category])]
                assert not changed, 'Authored content changed after saved-source reopening: ' + ', '.join(changed)
                assert all(sha256(ROOT / name) == value for name, value in immutable.items()), 'GLB or PNG bytes changed'
            except Exception:
                path.write_bytes(original)
                raise
            row = {'id': item['id'], 'kind': key, 'sourcePath': item[key],
                   'previousSourceSha256': hashlib.sha256(original).hexdigest(), 'sourceSha256': sha256(path),
                   'beforeSourceBytes': len(original), 'sourceBytes': path.stat().st_size,
                   **counts, 'authoredDataSignature': signature,
                   'reopenedAuthoredDataSignature': digest(after),
                   'authoredDataPreserved': True, 'glbAndPngBytesPreserved': True,
                   'activeScene': bpy.context.scene.name, 'sceneCount': len(bpy.data.scenes),
                   'meshDatablocks': len(bpy.data.meshes), 'compressedAndReopened': True}
            report['items'] = [value for value in report['items'] if value['sourcePath'] != item[key]] + [row]
            report['items'].sort(key=lambda value: value['sourcePath'])
            report_path.write_text(json.dumps(report, indent=2) + '\n')
            print('STORAGE_SOURCE_UI_SANITIZED', item['id'], key, counts, flush=True)


if __name__ == '__main__':
    main()
