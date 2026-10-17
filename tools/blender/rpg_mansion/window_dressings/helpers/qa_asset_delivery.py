#!/usr/bin/env python3
"""Independent actual-byte and reopened-source QA for the RPG mansion pack.

No application code or source asset is modified. Reports and optional temporary
source re-exports are written only below --output. Blender source inspection is
invoked with --sources after the production assets are ready. Bounds are measured
from actual decoded vertex data; accessor min/max and manifest assertions are not
used as evidence. This script does not perform application runtime visual QA.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import struct
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEFAULT_OUTPUT = HERE / 'polish' / 'qa'
PINNED_HEAD = '58523db9a119d051df7dfbfaa79ef9c903fa2264'
APPROVED_CHANGES = {'rpg-mansion-sofa-01', 'rpg-mansion-wing-chair-01'}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_blob_sha(path):
    content = path.read_bytes()
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


def load_glb(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    if magic != 0x46546c67 or version != 2 or length != len(raw):
        raise ValueError('Invalid GLB v2 header or declared byte length')
    chunks = []
    offset = 12
    while offset < len(raw):
        size, kind = struct.unpack_from('<II', raw, offset)
        if size % 4 or offset + 8 + size > len(raw):
            raise ValueError('Invalid GLB chunk length')
        chunks.append((kind, raw[offset + 8:offset + 8 + size]))
        offset += 8 + size
    document = json.loads(next(data for kind, data in chunks if kind == 0x4e4f534a))
    binary = next((data for kind, data in chunks if kind == 0x004e4942), b'')
    return document, binary


def accessor(document, binary, index):
    acc = document['accessors'][index]
    if 'sparse' in acc:
        raise ValueError('Sparse accessor requires explicit support')
    count = acc['count']
    arity = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    dtype = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[acc['componentType']]
    view = document['bufferViews'][acc['bufferView']]
    if view.get('buffer', 0) != 0:
        raise ValueError('External GLB buffer is unsupported')
    item_bytes = np.dtype(dtype).itemsize
    offset = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride', arity * item_bytes)
    last = offset + (count - 1) * stride + arity * item_bytes if count else offset
    if last > len(binary) or last > view.get('byteOffset', 0) + view['byteLength']:
        raise ValueError('Accessor exceeds binary buffer view')
    values = np.ndarray((count, arity), dtype=dtype, buffer=binary, offset=offset,
                        strides=(stride, item_bytes)).copy()
    if acc.get('normalized') and acc['componentType'] != 5126:
        limits = np.iinfo(values.dtype)
        values = values.astype(float) / limits.max
        if limits.min < 0:
            values = np.maximum(values, -1)
    return values


def local_matrix(node):
    if 'matrix' in node:
        return np.asarray(node['matrix'], float).reshape((4, 4), order='F')
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    rot = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                    [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                    [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    result = np.eye(4)
    result[:3, :3] = rot @ np.diag(node.get('scale', [1, 1, 1]))
    result[:3, 3] = node.get('translation', [0, 0, 0])
    return result


def scene_geometry(document, binary):
    result = []
    nodes = document.get('nodes', [])
    roots = document.get('scenes', [{'nodes': list(range(len(nodes)))}])[document.get('scene', 0)].get('nodes', [])
    def walk(index, parent, ancestors):
        if index in ancestors:
            raise ValueError('Scene node cycle')
        node = nodes[index]
        world = parent @ local_matrix(node)
        if 'mesh' in node:
            for primitive in document['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode', 4) != 4:
                    raise ValueError('Non-triangle primitive')
                attrs = primitive['attributes']
                pos = accessor(document, binary, attrs['POSITION']).astype(float)
                world_positions = (np.c_[pos, np.ones(len(pos))] @ world.T)[:, :3]
                indices = accessor(document, binary, primitive['indices']).reshape(-1).astype(int) if 'indices' in primitive else np.arange(len(pos))
                if len(indices) % 3 or (len(indices) and (indices.min() < 0 or indices.max() >= len(pos))):
                    raise ValueError('Invalid triangle indices')
                uv = accessor(document, binary, attrs['TEXCOORD_0']).astype(float) if 'TEXCOORD_0' in attrs else None
                result.append({'positions': world_positions, 'indices': indices.reshape((-1, 3)), 'uv': uv,
                               'material': primitive.get('material'), 'attributes': sorted(attrs), 'node': index})
        for child in node.get('children', []):
            walk(child, world, ancestors | {index})
    for root in roots:
        walk(root, np.eye(4), set())
    return result


def uv_statistics(geometry):
    densities, world_bad, uv_bad, missing, total = [], 0, 0, 0, 0
    nonfinite_positions, nonfinite_uvs = 0, 0
    for primitive in geometry:
        indices = primitive['indices']
        total += len(indices)
        points = primitive['positions'][indices]
        nonfinite_positions += int((~np.isfinite(primitive['positions']).all(axis=1)).sum())
        world_area = np.linalg.norm(np.cross(points[:, 1]-points[:, 0], points[:, 2]-points[:, 0]), axis=1) / 2
        world_bad += int((world_area <= 1e-14).sum())
        if primitive['uv'] is None:
            missing += len(indices)
            continue
        uv = primitive['uv'][indices]
        nonfinite_uvs += int((~np.isfinite(primitive['uv']).all(axis=1)).sum())
        a, b = uv[:, 1]-uv[:, 0], uv[:, 2]-uv[:, 0]
        uv_area = np.abs(a[:, 0]*b[:, 1]-a[:, 1]*b[:, 0]) / 2
        uv_bad += int((uv_area <= 1e-14).sum())
        valid = np.isfinite(world_area) & np.isfinite(uv_area) & (world_area > 1e-14) & (uv_area > 1e-14)
        densities.extend(np.sqrt(world_area[valid]/uv_area[valid]).tolist())
    densities.sort()
    result = {'triangles': total, 'valid_triangles': len(densities), 'degenerate_world': world_bad,
              'degenerate_uv': uv_bad, 'missing_uv_triangles': missing,
              'nonfinite_position_vertices': nonfinite_positions, 'nonfinite_uv_vertices': nonfinite_uvs}
    if densities:
        p05 = densities[int(.05*(len(densities)-1))]
        p95 = densities[int(.95*(len(densities)-1))]
        result.update(p05=p05, p95=p95, p95_p05=p95/p05, median=float(np.median(densities)))
    return result


def png_report(path):
    from PIL import Image
    raw = path.read_bytes()
    chunks, offset = [], 8
    while offset + 12 <= len(raw):
        size = struct.unpack_from('>I', raw, offset)[0]
        kind = raw[offset+4:offset+8].decode('ascii')
        chunks.append(kind)
        offset += 12 + size
        if kind == 'IEND':
            break
    with Image.open(path) as image:
        rgba = np.asarray(image.convert('RGBA'))
        alpha = rgba[:, :, 3]
        ys, xs = np.nonzero(alpha > 0)
        visible_y, visible_x = np.nonzero(alpha > 16)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()+1), int(ys.max()+1)] if len(xs) else None
        useful_bbox = [int(visible_x.min()), int(visible_y.min()), int(visible_x.max()+1), int(visible_y.max()+1)] if len(visible_x) else None
        return {'path': str(path.relative_to(ROOT)), 'sha256': sha256(path), 'size': list(image.size), 'mode': image.mode,
                'alpha_min': int(alpha.min()), 'alpha_max': int(alpha.max()), 'nonempty_pixels': len(xs),
                'pixel_bbox_alpha_gt_0': bbox, 'pixel_bbox_alpha_gt_16': useful_bbox,
                'edge_nontransparent_pixels': int((alpha[0] > 16).sum()+(alpha[-1] > 16).sum()+(alpha[:, 0] > 16).sum()+(alpha[:, -1] > 16).sum()),
                'chunks': chunks, 'metadata_keys': sorted(image.info)}


def shape_signature(document, geometry):
    """Compare physical point support per material and triangle counts, order-free.

    Vertex splitting for normals/UV does not change this signature. Six-decimal
    metre rounding allows exporter float precision while staying far below the
    one-millimetre dimensional acceptance tolerance. Surface triangulation is
    also checked separately when exporters choose equivalent quad diagonals.
    """
    points_by_material, counts_by_material, faces_by_material, uv_faces_by_material = {}, {}, {}, {}
    for primitive in geometry:
        mat_index = primitive['material']
        material = document.get('materials', [])[mat_index] if mat_index is not None else {}
        key = material.get('name', '<none>') + '|' + str(material.get('extras', {}).get('finishChannel', ''))
        points = np.round(primitive['positions'], 6)
        points[points == 0] = 0
        uvs = np.round(primitive['uv'], 6) if primitive['uv'] is not None else None
        if uvs is not None: uvs[uvs == 0] = 0
        point_set = points_by_material.setdefault(key, set())
        point_set.update(tuple(row) for row in points[np.unique(primitive['indices'])])
        counts_by_material[key] = counts_by_material.get(key, 0) + len(primitive['indices'])
        face_set = faces_by_material.setdefault(key, [])
        uv_face_set = uv_faces_by_material.setdefault(key, [])
        for tri in primitive['indices']:
            face_set.append(tuple(sorted(tuple(points[index]) for index in tri)))
            if uvs is not None:
                uv_face_set.append(tuple(sorted(tuple(points[index])+tuple(uvs[index]) for index in tri)))
    def digest(rows):
        return hashlib.sha256(repr(sorted(rows)).encode()).hexdigest()
    return {'point_support': {key: {'points': len(rows), 'digest': digest(rows)} for key, rows in sorted(points_by_material.items())},
            'triangle_counts': dict(sorted(counts_by_material.items())),
            'triangle_surfaces': {key: digest(rows) for key, rows in sorted(faces_by_material.items())},
            'uv_triangle_mapping': {key: digest(rows) for key, rows in sorted(uv_faces_by_material.items())}}


def seat_vertex_measurement(item, document, geometry):
    """Measure the exposed central/front seating region, independent of metadata.

    This geometric crop deliberately excludes upholstered backs and arms. The
    reported highest fabric vertex is an actual seat surface height in metres.
    """
    half_width = .7 if item['id'] == 'rpg-mansion-sofa-01' else .20
    selected = []
    top_triangles = []
    for primitive in geometry:
        material = document['materials'][primitive['material']]
        if material.get('extras', {}).get('finishChannel') != 'fabric':
            continue
        points = primitive['positions']
        crop = (np.abs(points[:, 0]) < half_width) & (points[:, 2] > .02)
        selected.extend(points[crop].tolist())
        for tri in primitive['indices']:
            q = points[tri]
            if np.all(np.abs(q[:, 1]-.460) < 1e-6) and np.any(crop[tri]):
                top_triangles.append(q.tolist())
    if not selected:
        return {'error': 'No actual fabric vertices in the measured seating region'}
    points = np.asarray(selected)
    return {'method': 'Actual GLB fabric vertices inside central front crop, excluding arm/back regions',
            'crop_gltf_m': {'abs_x_less_than': half_width, 'z_greater_than': .02},
            'measured_vertices': len(points), 'seat_surface_top_mm': float(points[:, 1].max()*1000),
            'seat_top_horizontal_triangle_count': len(top_triangles),
            'cropped_fabric_bounds_m': [points.min(axis=0).tolist(), points.max(axis=0).tolist()]}


def audit_item(item):
    path = ROOT / item['model']
    document, binary = load_glb(path)
    geometry = scene_geometry(document, binary)
    positions = np.concatenate([part['positions'] for part in geometry])
    lo, hi = positions.min(axis=0), positions.max(axis=0)
    dimensions = (hi-lo)[[0, 2, 1]] * 1000
    expected = np.asarray([item[key] for key in ('w', 'd', 'h')])
    used_materials = sorted({part['material'] for part in geometry if part['material'] is not None})
    materials = [document.get('materials', [])[index] for index in used_materials]
    channels = sorted({mat.get('extras', {}).get('finishChannel') for mat in materials if mat.get('extras', {}).get('finishChannel')})
    expected_channels = sorted(ch['key'] for ch in item['finishChannels'])
    uv = uv_statistics(geometry)
    errors, warnings = [], []
    if not np.isfinite(positions).all(): errors.append('Non-finite actual vertex coordinates')
    if max(abs(dimensions-expected)) >= 1: errors.append('Actual vertex bounds differ from manifest by >=1 mm')
    if max(abs(lo[[0, 2]]+hi[[0, 2]])) >= 1e-6 or abs(lo[1]) >= 1e-6: errors.append('Actual model is not bottom-centred at the origin')
    if channels != expected_channels: errors.append('Used GLB material finish channels differ from manifest')
    if len(document.get('meshes', [])) != 1: errors.append('GLB does not contain exactly one mesh')
    if any('TEXCOORD_1' in part['attributes'] for part in geometry): errors.append('GLB has more than one UV channel')
    if uv['missing_uv_triangles'] or uv['degenerate_world'] or uv['degenerate_uv']: errors.append('Missing UV or degenerate actual triangles')
    if uv['nonfinite_uv_vertices']: errors.append('Non-finite actual UV coordinates')
    if uv.get('p95_p05', math.inf) >= 2: errors.append('Actual triangle UV density p95/p05 is >=2')
    if uv['triangles'] > 6000: errors.append('Actual triangle count exceeds existing 6000 budget')
    if uv['triangles'] > 3000: warnings.append('Above the default 3000 triangle guide, within the inherited explicit 6000 budget')
    if document.get('images') or document.get('textures'): errors.append('GLB embeds or references image textures')
    for mat in materials:
        pbr = mat.get('pbrMetallicRoughness', {})
        if not (0 <= pbr.get('metallicFactor', 1) <= 1 and 0 <= pbr.get('roughnessFactor', 1) <= 1): errors.append('Material factor is outside [0,1]')
        if any(ord(char) > 127 for char in mat.get('name', '')): errors.append('Material name is not English/ASCII')
    previews = [png_report(ROOT/item[key]) for key in ('thumb', 'top')]
    for preview in previews:
        if preview['size'] != [512, 512]: errors.append('Preview is not 512x512: '+preview['path'])
        if preview['mode'] != 'RGBA' or preview['alpha_min'] != 0: errors.append('Preview has no transparent RGBA background: '+preview['path'])
        if not preview['nonempty_pixels']: errors.append('Empty preview: '+preview['path'])
        if preview['edge_nontransparent_pixels']: errors.append('Preview has visible alpha on image edges (possible clipping): '+preview['path'])
        if any(kind in preview['chunks'] for kind in ('tEXt', 'zTXt', 'iTXt', 'eXIf')): errors.append('Preview contains production metadata: '+preview['path'])
    extras = document.get('asset', {}).get('extras', {})
    if extras.get('front') != '+Z' or extras.get('up') != '+Y' or extras.get('units') != 'metres' or extras.get('origin') != 'bottom-centre':
        errors.append('GLB axis/unit/origin extras contract is missing or inconsistent')
    seat = seat_vertex_measurement(item, document, geometry) if item['id'] in APPROVED_CHANGES else None
    if extras.get('seatTopMm') == 460 and (not seat or abs(seat.get('seat_surface_top_mm', 0)-460) > .01 or not seat.get('seat_top_horizontal_triangle_count')):
        errors.append('Actual seat-region vertex height does not support the claimed 460 mm seat')
    return {'id': item['id'], 'model': item['model'], 'seat_vertex_measurement': seat, 'sha256': sha256(path), 'git_blob_sha': git_blob_sha(path), 'bytes': path.stat().st_size,
            'actual_bounds_gltf_m': [lo.tolist(), hi.tolist()], 'actual_dimensions_wdh_mm': dimensions.tolist(),
            'dimension_error_mm': (dimensions-expected).tolist(), 'triangles': uv['triangles'], 'uv': uv,
            'actual_materials': materials, 'actual_finish_channels': channels, 'manifest_finish_channels': expected_channels,
            'asset_extras': extras, 'previews': previews, 'geometry_signature': shape_signature(document, geometry),
            'errors': errors, 'warnings': warnings}


def find_source(item):
    if item.get('sourceBlend') and (ROOT/item['sourceBlend']).exists():
        return ROOT/item['sourceBlend']
    validation = item.get('validation')
    if validation:
        candidate = (ROOT/validation).with_name(item['id']+'.blend')
        if candidate.exists():
            return candidate
    candidates = list(HERE.rglob(item['id']+'.blend'))
    candidates = [path for path in candidates if 'qa' not in path.parts]
    return candidates[0] if len(candidates) == 1 else None


def native_scene_signature(scene):
    """Build independent geometry primitives from a Blender authoring scene."""
    materials, material_indices, primitives = [], {}, []
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        points = np.asarray([tuple(obj.matrix_world @ vertex.co) for vertex in mesh.vertices])
        positions = points[:, [0, 2, 1]].copy()
        positions[:, 2] *= -1
        grouped = {}
        for tri in mesh.loop_triangles:
            grouped.setdefault(tri.material_index, []).append(tuple(tri.vertices))
        for local_index, triangles in grouped.items():
            material = mesh.materials[local_index]
            key = (material.name, material.get('finishChannel'))
            if key not in material_indices:
                material_indices[key] = len(materials)
                materials.append({'name': key[0], 'extras': {'finishChannel': key[1]}})
            primitives.append({'positions': positions, 'indices': np.asarray(triangles), 'uv': None,
                               'material': material_indices[key]})
    return shape_signature({'materials': materials}, primitives)


def native_seat_component_measurement(obj):
    """Measure disconnected cushion components from reopened mesh vertices.

    Selection uses actual component size, placement, and fabric assignment, not
    the component names or the builder's claimed seatTopMm value.
    """
    mesh = obj.data
    points = np.asarray([tuple(obj.matrix_world @ vertex.co) for vertex in mesh.vertices])
    adjacent = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacent[a].append(b)
        adjacent[b].append(a)
    components, component_of = [], {}
    for seed in range(len(points)):
        if seed in component_of:
            continue
        number, vertices, pending = len(components), [], [seed]
        component_of[seed] = number
        while pending:
            current = pending.pop()
            vertices.append(current)
            for neighbour in adjacent[current]:
                if neighbour not in component_of:
                    component_of[neighbour] = number
                    pending.append(neighbour)
        components.append({'vertices': vertices, 'channels': set()})
    for polygon in mesh.polygons:
        mat = mesh.materials[polygon.material_index]
        components[component_of[polygon.vertices[0]]]['channels'].add(mat.get('finishChannel'))
    cushions = []
    for part in components:
        values = points[part['vertices']]
        lo, hi = values.min(axis=0), values.max(axis=0)
        if (part['channels'] == {'fabric'} and .32 < lo[2] < .40 and .45 < hi[2] < .48
                and hi[0]-lo[0] > .15 and hi[1]-lo[1] > .3):
            cushions.append({'vertices': len(values), 'bounds_blender_m': [lo.tolist(), hi.tolist()],
                             'seat_surface_top_mm': float(hi[2]*1000)})
    return {'method': 'Connected components of reopened native mesh; actual fabric assignment and vertex bounds',
            'mesh_connected_components': len(components), 'cushions': cushions,
            'cushion_count': len(cushions)}


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
                       external_images=[image.filepath for image in bpy.data.images if image.source == 'FILE' and image.filepath])
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
            if row['modifiers']: row['errors'].append('Source has unapplied modifiers; raw vertex comparison is insufficient')
            # Re-export from reopened native editable mesh, without saving it.
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            exported = args.output/'regenerated'/(item['id']+'.glb')
            exported.parent.mkdir(parents=True, exist_ok=True)
            bpy.ops.export_scene.gltf(filepath=str(exported), export_format='GLB', use_selection=True,
                                      use_active_scene=True, export_animations=False,
                                      export_skins=False, export_morph=False,
                                      export_yup=True, export_extras=True, export_texcoords=True,
                                      export_normals=True, export_materials='EXPORT')
            row['source_reexport'] = str(exported)
        except Exception as error:
            row['errors'].append(type(error).__name__+': '+str(error))
        result.append(row)
        args.source_response.write_text(json.dumps(result, indent=2)+'\n')
        print('SOURCE_QA '+item['id']+' '+('FAIL' if row['errors'] else 'PASS'), flush=True)
    return int(any(row['errors'] for row in result))


def compare_source_reports(source_results, actual_items):
    """Check cached reopened-source exports without reopening unchanged files."""
    by_id = {row['id']: row for row in actual_items}
    for source in source_results:
        original = by_id.get(source['id'])
        if original is None:
            source['errors'].append('Source checkpoint ID is absent from evaluated item descriptors')
            continue
        if not Path(source['source']).exists() or sha256(Path(source['source'])) != source['source_sha256']:
            source['errors'].append('Native source bytes changed after independent reopening; checkpoint is stale')
        if not source.get('source_reexport'):
            source['errors'].append('No independent source re-export was produced')
            continue
        document, binary = load_glb(Path(source['source_reexport']))
        geometry = scene_geometry(document, binary)
        signature = shape_signature(document, geometry)
        source['reexport_uv_statistics'] = uv_statistics(geometry)
        expected = original['geometry_signature']
        for name, signature_key in [('point_support', 'point_support'), ('triangle_counts', 'triangle_counts'),
                                    ('triangle_surfaces', 'triangle_surfaces'), ('uv_mapping', 'uv_triangle_mapping')]:
            source['reexport_'+name+'_matches_actual_glb'] = signature[signature_key] == expected[signature_key]
        # Keep the original report spelling for downstream evidence readers.
        source['reexport_triangle_counts_match_actual_glb'] = source['reexport_triangle_counts_matches_actual_glb']
        source['reexport_triangle_surfaces_match_actual_glb'] = source['reexport_triangle_surfaces_matches_actual_glb']
        source_uv = source['reexport_uv_statistics']
        if (source_uv['missing_uv_triangles'] or source_uv['degenerate_uv'] or source_uv['degenerate_world']
                or source_uv['nonfinite_position_vertices'] or source_uv['nonfinite_uv_vertices']
                or source_uv.get('p95_p05', math.inf) >= 2):
            source['errors'].append('Reopened source re-export has non-finite/missing/degenerate UV or inconsistent UV density')
        if source['reexport_triangle_surfaces_matches_actual_glb'] and not source['reexport_uv_mapping_matches_actual_glb']:
            source['errors'].append('Reopened native source UV mapping does not reproduce delivered GLB')
        if not source['reexport_point_support_matches_actual_glb'] or not source['reexport_triangle_counts_matches_actual_glb']:
            source['errors'].append('Reopened native source geometry/material assignment does not reproduce delivered GLB')
        if not source['reexport_triangle_surfaces_matches_actual_glb']:
            source.setdefault('warnings', []).append('Triangulated surface signature differs; inspect source/exporter triangulation')
        source['source_bounds_match_actual_glb'] = bool(np.max(np.abs(np.asarray(source['actual_bounds_gltf_m'])-np.asarray(original['actual_bounds_gltf_m']))) < 1e-6)
        if not source['source_bounds_match_actual_glb']:
            source['errors'].append('Reopened source bounds do not reproduce delivered GLB bounds')
    return source_results


def main(args):
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = ROOT/'assets/models/packs/rpg-mansion/manifest.json'
    items = json.loads(manifest.read_text())['items']
    baseline = json.loads(args.inventory.read_text()) if args.inventory else None
    baseline_files = {row['path']: row for row in baseline.get('comparison', [])} if baseline else {}
    report = {'created_utc': datetime.now(timezone.utc).isoformat(), 'pinned_pr81_head': PINNED_HEAD,
              'manifest_sha256': sha256(manifest), 'item_count': len(items),
              'scope': 'Actual GLB and PNG bytes, optional reopened native editable sources; no application runtime visual QA',
              'items': [], 'preservation': [], 'kitchen_preservation': [], 'source_results': [], 'errors': []}
    for item in items:
        try:
            row = audit_item(item)
        except Exception as error:
            row = {'id': item['id'], 'errors': [type(error).__name__+': '+str(error)]}
        source = find_source(item)
        row['source_path'] = str(source.relative_to(ROOT)) if source else None
        if source is None:
            row.setdefault('warnings', []).append('Editable source is currently absent; may be restoration in progress')
        report['items'].append(row)
        for key in ('model', 'thumb', 'top'):
            path = ROOT/item[key]
            if item[key] in baseline_files and path.exists():
                original = baseline_files[item[key]]['sha']
                actual = git_blob_sha(path)
                changed = original != actual
                approved = item['id'] in APPROVED_CHANGES
                record = {'id': item['id'], 'path': item[key], 'pr81_git_blob_sha': original,
                          'actual_git_blob_sha': actual, 'byte_identical': not changed, 'approved_quality_target': approved}
                report['preservation'].append(record)
                if changed and not approved: report['errors'].append('Unexpected original asset byte change: '+item[key])
        (args.output/'actual-byte-checkpoint.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        print('BYTE_QA '+item['id']+' '+('FAIL '+str(row['errors']) if row['errors'] else 'PASS'), flush=True)
    for path, original in sorted(baseline_files.items()):
        if not path.startswith('tools/blender/rpg_mansion/kitchen/work/') or not (path.endswith('.blend') or path.endswith('-rear.png')):
            continue
        actual_path = ROOT/path
        actual = git_blob_sha(actual_path) if actual_path.exists() else None
        record = {'path': path, 'pr81_git_blob_sha': original['sha'], 'actual_git_blob_sha': actual,
                  'byte_identical': actual == original['sha']}
        report['kitchen_preservation'].append(record)
        if not record['byte_identical']:
            report['errors'].append('Unexpected kitchen native source or rear preview byte change: '+path)
    if args.sources:
        request = [{'id': item['id'], 'source': str(find_source(item))} for item in items if find_source(item)]
        missing = [item['id'] for item in items if not find_source(item)]
        for model in missing: report['errors'].append('Editable source missing: '+model)
        source_request, source_response = args.output/'source-request.json', args.output/'source-checkpoint.json'
        source_request.write_text(json.dumps(request, indent=2)+'\n')
        command = [args.blender, '-b', '-t', '2', '--factory-startup', '--python', str(Path(__file__).resolve()), '--',
                   '--blender-source', '--source-request', str(source_request), '--source-response', str(source_response), '--output', str(args.output)]
        completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (args.output/'source-reopen.log').write_text(completed.stdout)
        if source_response.exists():
            report['source_results'] = json.loads(source_response.read_text())
        if completed.returncode: report['errors'].append('Source reopen subprocess returned '+str(completed.returncode))
    if args.source_reports:
        cached = {}
        for path in args.source_reports:
            for source in json.loads(path.read_text()):
                cached[source['id']] = source
        report['source_results'] = list(cached.values())
    if args.sources or args.source_reports:
        compare_source_reports(report['source_results'], report['items'])
        for source in report['source_results']:
            report['errors'].extend(source['id']+': '+error for error in source['errors'])
    report['errors'].extend(row['id']+': '+error for row in report['items'] for error in row['errors'])
    report['summary'] = {'actual_byte_pass': sum(not row['errors'] for row in report['items']),
                         'actual_byte_fail': sum(bool(row['errors']) for row in report['items']),
                         'public_pngs_checked': sum(len(row.get('previews', [])) for row in report['items']),
                         'total_triangles': sum(row.get('triangles', 0) for row in report['items']),
                         'source_files_present': sum(bool(row.get('source_path')) for row in report['items']),
                         'source_files_reopened': len(report['source_results']),
                         'source_pass': sum(not row['errors'] for row in report['source_results']),
                         'source_fail': sum(bool(row['errors']) for row in report['source_results']),
                         'source_not_run': len(items)-len(report['source_results']),
                         'preserved_original_files': sum(row['byte_identical'] for row in report['preservation']),
                         'approved_target_changed_files': sum(not row['byte_identical'] and row['approved_quality_target'] for row in report['preservation']),
                         'unexpected_changed_files': sum(not row['byte_identical'] and not row['approved_quality_target'] for row in report['preservation']),
                         'preserved_original_models': sum(row['byte_identical'] and row['path'].endswith('.glb') for row in report['preservation']),
                         'preserved_original_public_pngs': sum(row['byte_identical'] and row['path'].endswith('.png') for row in report['preservation']),
                         'approved_existing_geometry_changes': sum(not row['byte_identical'] and row['approved_quality_target'] and row['path'].endswith('.glb') for row in report['preservation']),
                         'new_model_count': sum(row['model'] not in baseline_files for row in report['items']) if baseline else None,
                         'preserved_kitchen_native_sources': sum(row['byte_identical'] and row['path'].endswith('.blend') for row in report['kitchen_preservation']),
                         'preserved_kitchen_rear_pngs': sum(row['byte_identical'] and row['path'].endswith('-rear.png') for row in report['kitchen_preservation']),
                         'error_count': len(report['errors'])}
    (args.output/'actual-byte-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    summary = report['summary']
    lines = ['# Independent mansion asset QA', '', 'Run UTC: '+report['created_utc'], '',
             'This report measures actual GLB vertex and UV buffers and PNG pixels. It does not claim app runtime visual QA.', '',
             '## Summary', '', *['- '+key+': '+str(value) for key, value in summary.items()], '', '## Errors', '']
    lines += ['- '+error for error in report['errors']] or ['None']
    lines += ['', '## Per-file bounds and triangles', '', '| Asset | Actual w/d/h mm | Triangles | UV p95/p05 | Result |', '|---|---|---:|---:|---|']
    for row in report['items']:
        dims = ' / '.join(f'{value:.3f}' for value in row.get('actual_dimensions_wdh_mm', []))
        lines.append('| '+row['id']+' | '+dims+' | '+str(row.get('triangles', ''))+' | '+str(round(row.get('uv', {}).get('p95_p05', 0), 4))+' | '+('FAIL' if row['errors'] else 'PASS')+' |')
    lines += ['', '## Evidence boundaries', '', '- Front/up metadata is checked, while semantic facing requires the separate front/rear image review',
              '- Six-decimal metre point-support and per-material triangle counts compare source re-export with actual delivered GLB geometry',
              '- Triangle surface signatures also detect topology/material differences and flag exporter triangulation changes',
              '- Public preview edge alpha is a clipping indicator; it does not alone prove semantic composition',
              '- Original procedural geometry is scoped to this repository; this report grants no general reuse license']
    (args.output/'actual-byte-report.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(summary, indent=2))
    return int(bool(report['errors']))


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--sources', action='store_true')
    parser.add_argument('--source-reports', nargs='+', type=Path, help='Reuse source-open checkpoints after verifying unchanged source hashes')
    parser.add_argument('--blender', default='/usr/bin/blender')
    parser.add_argument('--blender-source', action='store_true')
    parser.add_argument('--source-request', type=Path)
    parser.add_argument('--source-response', type=Path)
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    return blender_sources(args) if args.blender_source else main(args)


if __name__ == '__main__':
    raise SystemExit(cli())
