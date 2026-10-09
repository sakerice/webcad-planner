"""Repair and validate outward orientation per closed connected component.

Only polygon winding/normals may change. Native vertex positions, topology,
material assignments, face smoothness and each vertex/corner UV association
are verified exactly. Run after reopening production sources; do not rebuild.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0,str(HERE))
TARGETS = {'rpg-mansion-drum-library-table-01', 'rpg-mansion-baize-card-table-01',
           'rpg-mansion-oval-mirror-dressing-table-01', 'rpg-mansion-roll-top-writing-desk-01'}


def invariant(mesh):
    faces = []
    for face in mesh.polygons:
        corners = []
        for index in face.loop_indices:
            corners.append((mesh.loops[index].vertex_index,
                            tuple(tuple(layer.data[index].uv) for layer in mesh.uv_layers)))
        faces.append((face.material_index, face.use_smooth, tuple(sorted(corners))))
    record = {'vertices': [tuple(v.co) for v in mesh.vertices],
              'faces': sorted(faces), 'uvLayers': [layer.name for layer in mesh.uv_layers],
              'materials': [(m.name, m.get('finishChannel')) for m in mesh.materials]}
    return hashlib.sha256(repr(record).encode()).hexdigest()


def components(bm):
    unseen = set(bm.faces)
    result = []
    while unseen:
        pending = [unseen.pop()]
        faces = []
        while pending:
            face = pending.pop()
            faces.append(face)
            for edge in face.edges:
                for adjacent in edge.link_faces:
                    if adjacent in unseen:
                        unseen.remove(adjacent)
                        pending.append(adjacent)
        result.append(faces)
    return result


def volume(faces):
    vertices = {vert for face in faces for vert in face.verts}
    origin = sum((v.co for v in vertices), Vector()) / len(vertices)
    total = 0.0
    for face in faces:
        points = [v.co - origin for v in face.verts]
        for index in range(1, len(points)-1):
            total += points[0].dot(points[index].cross(points[index+1])) / 6.0
    return total


def repair_mesh_winding(obj, repair=True):
    mesh = obj.data
    before = invariant(mesh)
    determinant = obj.matrix_world.to_3x3().determinant()
    assert determinant > 0, (obj.name, 'Unexpected mirrored transform')
    bm = bmesh.new()
    bm.from_mesh(mesh)
    assert all(edge.is_manifold and edge.is_contiguous for edge in bm.edges), \
        (obj.name, 'Not a consistently oriented closed mesh')
    groups = components(bm)
    rows = []
    changed = False
    for faces in groups:
        previous = volume(faces) * determinant
        assert abs(previous) > 1e-14, (obj.name, 'Zero-volume closed component')
        flipped = previous < 0 and repair
        if flipped:
            # BMesh reverses loops along with vertices. The invariant below
            # independently verifies that UV data stayed with each corner.
            bmesh.ops.reverse_faces(bm, faces=faces)
            changed = True
        current = volume(faces) * determinant
        if repair:
            assert current > 0, (obj.name, 'Inward component remains')
        rows.append({'polygons': len(faces), 'signedVolumeBeforeM3': previous,
                     'signedVolumeAfterM3': current, 'flipped': flipped})
    if changed:
        bm.normal_update()
        bm.to_mesh(mesh)
        mesh.update()
    bm.free()
    assert invariant(mesh) == before, (obj.name, 'Shape/topology/UV/material association changed')
    return {'part': obj.name, 'components': rows, 'componentCount': len(rows),
            'flippedComponents': sum(row['flipped'] for row in rows),
            'shapeTopologyUvMaterialInvariant': before, 'shapeTopologyUvMaterialsPreserved': True}


def main():
    reports = []
    items = json.loads((HERE / 'descriptors.json').read_text())
    dry_run = '--dry-run' in sys.argv
    for item in items:
        if item['id'] not in TARGETS:
            continue
        for field in ['authoringBlend', 'sourceBlend']:
            path = ROOT / item[field]
            bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
            active = bpy.context.scene
            scenes = []
            for scene in bpy.data.scenes:
                parts = [repair_mesh_winding(ob, repair=not dry_run)
                         for ob in scene.objects if ob.type == 'MESH']
                scenes.append({'scene': scene.name, 'parts': parts,
                               'flippedComponents': sum(row['flippedComponents'] for row in parts)})
            if not dry_run:
                from sanitize_sources import sanitize_loaded
                sanitize_loaded(item['id'])
                bpy.context.window.scene = active
                bpy.context.preferences.filepaths.save_version = 0
                bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
            reports.append({'id': item['id'], 'field': field, 'path': item[field], 'scenes': scenes,
                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            print('OUTWARD_WINDING', item['id'], field,
                  sum(scene['flippedComponents'] for scene in scenes), flush=True)
    if not dry_run:
        (HERE / 'outward-winding-repair-qa.json').write_text(json.dumps(
            {'items': reports, 'flippedComponents': sum(scene['flippedComponents']
             for row in reports for scene in row['scenes']), 'errors': []}, indent=2) + '\n')


if __name__ == '__main__':
    main()
