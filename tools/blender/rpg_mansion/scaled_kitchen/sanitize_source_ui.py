"""Clear unused saved file-browser directories; preserve all authored asset data.

Run in Blender. No mesh, UV, material, custom property, GLB or PNG is changed.
Each source is compressed, reopened and checked against its pre-save content.
"""
from pathlib import Path
import hashlib
import json
import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bpy.types.ID):
        return {'id_type': value.bl_rna.identifier, 'name': value.name}
    if hasattr(value, 'items'):
        return {str(key): plain(val) for key, val in sorted(value.items())}
    try:
        return [plain(val) for val in value]
    except TypeError:
        return str(value)


def properties(value):
    return {key: plain(value[key]) for key in sorted(value.keys())}


def content_signature():
    meshes, objects, materials, scenes = [], [], [], []
    for mesh in sorted(bpy.data.meshes, key=lambda value: value.name):
        mesh.calc_loop_triangles()
        meshes.append({'name': mesh.name, 'properties': properties(mesh),
                       'vertices': [tuple(value.co) for value in mesh.vertices],
                       'edges': [tuple(value.vertices) for value in mesh.edges],
                       'polygons': [(tuple(value.vertices), value.material_index, value.use_smooth) for value in mesh.polygons],
                       'triangles': [(tuple(value.vertices), tuple(value.loops), value.material_index) for value in mesh.loop_triangles],
                       'corner_normals': [tuple(value.vector) for value in mesh.corner_normals],
                       'uv_layers': [(layer.name, layer.active_render, [tuple(value.uv) for value in layer.data]) for layer in mesh.uv_layers],
                       'active_uv': mesh.uv_layers.active_index,
                       'materials': [value.name if value else None for value in mesh.materials]})
    for obj in sorted(bpy.data.objects, key=lambda value: value.name):
        objects.append({'name': obj.name, 'type': obj.type, 'data': obj.data.name if obj.data else None,
                        'properties': properties(obj), 'matrix_world': [list(value) for value in obj.matrix_world],
                        'matrix_basis': [list(value) for value in obj.matrix_basis],
                        'parent': obj.parent.name if obj.parent else None,
                        'modifiers': [(value.name, value.type) for value in obj.modifiers]})
    for mat in sorted(bpy.data.materials, key=lambda value: value.name):
        material = {'name': mat.name, 'properties': properties(mat), 'diffuse_color': list(mat.diffuse_color),
                    'roughness': mat.roughness, 'metallic': mat.metallic, 'use_nodes': mat.use_nodes,
                    'use_backface_culling': mat.use_backface_culling, 'surface_render_method': mat.surface_render_method}
        if mat.node_tree:
            material['nodes'] = [{'name': node.name, 'type': node.bl_idname,
                                  'properties': properties(node),
                                  'inputs': [(socket.identifier, plain(socket.default_value)) for socket in node.inputs if hasattr(socket, 'default_value')]}
                                 for node in sorted(mat.node_tree.nodes, key=lambda value: value.name)]
            material['links'] = sorted((link.from_node.name, link.from_socket.identifier,
                                         link.to_node.name, link.to_socket.identifier) for link in mat.node_tree.links)
        materials.append(material)
    for scene in sorted(bpy.data.scenes, key=lambda value: value.name):
        scenes.append({'name': scene.name, 'properties': properties(scene),
                       'objects': sorted(value.name for value in scene.objects),
                       'units': [scene.unit_settings.system, scene.unit_settings.scale_length],
                       'render_path': scene.render.filepath})
    collections = [{'name': value.name, 'properties': properties(value),
                     'objects': sorted(obj.name for obj in value.objects)} for value in sorted(bpy.data.collections, key=lambda value: value.name)]
    return hashlib.sha256(json.dumps({'meshes': meshes, 'objects': objects, 'materials': materials,
                                     'scenes': scenes, 'collections': collections,
                                     'active_scene': bpy.context.scene.name}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def main():
    items = json.loads((HERE / 'descriptors.json').read_text())['items']
    immutable = {item[key]: sha256(ROOT / item[key]) for item in items for key in ['model', 'thumb', 'top', 'front', 'rear']}
    report = {'method': 'Unused saved FILE_BROWSER directory normalization to a relative folder, with full authored-data signature and immutable GLB/PNG byte checks',
              'items': [], 'errors': []}
    for item in items:
        path = ROOT / item['sourceBlend']
        old_hash = sha256(path)
        bpy.ops.wm.open_mainfile(filepath=str(path))
        before = content_signature()
        changed = 0
        for screen in bpy.data.screens:
            for area in screen.areas:
                for space in area.spaces:
                    if space.type == 'FILE_BROWSER' and space.params and space.params.directory != b'//':
                        space.params.directory = b'//'
                        changed += 1
        assert content_signature() == before, 'Authored asset content changed during UI cleanup'
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(path))
        assert content_signature() == before, 'Authored asset content changed after saved source reopening'
        assert all(sha256(ROOT / name) == digest for name, digest in immutable.items()), 'GLB or PNG bytes changed'
        report['items'].append({'id': item['id'], 'sourcePath': item['sourceBlend'],
                                'previousSourceSha256': old_hash, 'sourceSha256': sha256(path),
                                'browserDirectoriesNormalized': changed,
                                'authoredDataSignature': before, 'authoredDataPreserved': True,
                                'glbAndPngBytesPreserved': True})
        (HERE / 'source-ui-cleanup-report.json').write_text(json.dumps(report, indent=2) + '\n')
        print('SOURCE_UI_SANITIZED', item['id'], changed, flush=True)


if __name__ == '__main__':
    main()
