"""Kitchen-local reopened-source QA with active-scene-only GLB re-exports.

The shared delivery checker remains unchanged. Its pure actual-byte/signature
utilities are reused; only this family-local source audit controls export scope.
Sources are opened read-only and never saved. Temporary exports are not delivery.
"""
from pathlib import Path
import argparse
import json
import sys
import numpy as np
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
import qa_asset_delivery as qa
qa.ROOT = ROOT
sha256 = qa.sha256
native_scene_signature = qa.native_scene_signature
native_seat_component_measurement = qa.native_seat_component_measurement
APPROVED_CHANGES = qa.APPROVED_CHANGES

def blender_sources(args):
    import bpy
    import bmesh
    items = json.loads(args.source_request.read_text())
    result = []
    for item in items:
        row = {'id': item['id'], 'source': item['source'], 'errors': []}
        try:
            path = Path(item['source'])
            bpy.ops.wm.open_mainfile(filepath=str(path))
            scene = bpy.context.scene
            meshes = [obj for obj in scene.objects if obj.type == 'MESH']
            row.update(source_sha256=sha256(path), mesh_objects=len(meshes), metric_system=scene.unit_settings.system,
                       scale_length=scene.unit_settings.scale_length,
                       scene_names=[value.name for value in bpy.data.scenes], active_scene=scene.name,
                       linked_libraries=[lib.filepath for lib in bpy.data.libraries],
                       external_images=[image.filepath for image in bpy.data.images if image.source == 'FILE' and image.filepath],
                       render_paths={value.name: value.render.filepath for value in bpy.data.scenes})
            if len(meshes) != 1:
                raise ValueError('Editable source must have exactly one mesh object')
            obj = meshes[0]
            mesh = obj.data
            authoring = next((value for value in bpy.data.scenes if value.name.startswith('Native authoring parts')), None)
            if authoring:
                authoring_signature = native_scene_signature(authoring)
                export_signature = native_scene_signature(scene)
                row['authoring_parts_mesh_objects'] = sum(value.type == 'MESH' for value in authoring.objects)
                row['authoring_parts_point_support_matches_validated_mesh'] = authoring_signature['point_support'] == export_signature['point_support']
                row['authoring_parts_triangle_counts_match_validated_mesh'] = authoring_signature['triangle_counts'] == export_signature['triangle_counts']
                if not row['authoring_parts_point_support_matches_validated_mesh'] or not row['authoring_parts_triangle_counts_match_validated_mesh']:
                    row['errors'].append('Independent native authoring parts do not reproduce validated mesh geometry/material support')
            mesh.calc_loop_triangles()
            points = np.asarray([tuple(obj.matrix_world @ vertex.co) for vertex in mesh.vertices])
            # Independent Blender Z-up/-Y-front to glTF Y-up/+Z-front mapping.
            gltf_points = points[:, [0, 2, 1]].copy()
            gltf_points[:, 2] *= -1
            lo, hi = gltf_points.min(axis=0), gltf_points.max(axis=0)
            row.update(vertices=len(mesh.vertices), polygons=len(mesh.polygons), triangles=len(mesh.loop_triangles),
                       uv_layers=[layer.name for layer in mesh.uv_layers],
                       actual_bounds_gltf_m=[lo.tolist(), hi.tolist()],
                       actual_dimensions_wdh_mm=((hi-lo)[[0, 2, 1]]*1000).tolist(),
                       object_matrix=[list(value) for value in obj.matrix_world],
                       modifiers=[mod.type for mod in obj.modifiers],
                       material_channels={mat.name: mat.get('finishChannel') for mat in mesh.materials if mat})
            if item['id'] in APPROVED_CHANGES:
                seat = native_seat_component_measurement(obj)
                row['seat_component_vertex_measurement'] = seat
                expected_cushions = 3 if item['id'] == 'rpg-mansion-sofa-01' else 1
                if seat['cushion_count'] != expected_cushions or any(abs(part['seat_surface_top_mm']-460) > .01 for part in seat['cushions']):
                    row['errors'].append('Actual native cushion component bounds do not support a 460 mm seat')
            bm = bmesh.new()
            bm.from_mesh(mesh)
            row['nonmanifold_edges'] = sum(not edge.is_manifold for edge in bm.edges)
            bm.free()
            if row['metric_system'] != 'METRIC' or abs(row['scale_length']-1) > 1e-9: row['errors'].append('Source unit setting is not metric metres')
            if len(mesh.uv_layers) != 1: row['errors'].append('Source does not have exactly one UV layer')
            if row['nonmanifold_edges']: row['errors'].append('Source has nonmanifold edges')
            if row['linked_libraries'] or row['external_images']: row['errors'].append('Source depends on linked libraries or external imagery')
            if any(not value.startswith('//') for value in row['render_paths'].values()):
                row['errors'].append('Source has a non-relative render output path')
            if row['active_scene'] != 'Validated export':
                row['errors'].append('Canonical source opens in the wrong active scene')
            if row['modifiers']: row['errors'].append('Source has unapplied modifiers; raw vertex comparison is insufficient')
            # Re-export from reopened native editable mesh, without saving it.
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            exported = args.output/'regenerated'/(item['id']+'.glb')
            exported.parent.mkdir(parents=True, exist_ok=True)
            bpy.ops.export_scene.gltf(filepath=str(exported), export_format='GLB', use_selection=True,
                                      use_active_scene=True, export_yup=True, export_extras=True, export_texcoords=True,
                                      export_normals=True, export_materials='EXPORT',
                                      export_animations=False, export_skins=False, export_morph=False)
            row['source_reexport'] = str(exported)
        except Exception as error:
            row['errors'].append(type(error).__name__+': '+str(error))
        result.append(row)
        args.source_response.write_text(json.dumps(result, indent=2)+'\n')
        print('SOURCE_QA '+item['id']+' '+('FAIL' if row['errors'] else 'PASS'), flush=True)
    return int(any(row['errors'] for row in result))



if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-request', type=Path, required=True)
    parser.add_argument('--source-response', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    raise SystemExit(blender_sources(args))
