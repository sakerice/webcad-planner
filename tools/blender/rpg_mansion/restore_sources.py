"""Recover native authoring sources without touching reviewed public assets.

blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/restore_sources.py -- --only chair,desk
blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/restore_sources.py -- --resume

Original procedural builders are called directly, never their catalogue-mutating
main functions. model_kit.run validates/exports into temporary directories. The
published GLBs and thumbnails are read-only comparison inputs. Each .blend has a
validated joined export scene and a second scene of the actual native, separate
procedural authoring parts. The latter is captured before joining, then mapped to
nominal final bounds; it is not a GLB import and intentionally precedes atlas UVs.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PACK = ROOT / 'assets/models/packs/rpg-mansion'
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import build as original
import model_kit as kit
import bpy
from mathutils import Matrix, Vector

spec = importlib.util.spec_from_file_location('rpg_mansion_expansion_sources', HERE / 'expansion/build.py')
expansion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(expansion)

RECOVERY = HERE / 'source-recovery'
EXCLUDED = {'sofa', 'wing-chair'}
PART_ATTRIBUTE = '__native_recovery_part'
VERTEX_ATTRIBUTE = '__native_recovery_vertex'


def capture_native_parts(parts, captured_parts):
    """Capture original parts after evaluation, retaining native join identity."""
    bpy.context.view_layer.update()
    for part_index, part in enumerate(parts):
        part_attribute = part.data.attributes.new(PART_ATTRIBUTE, 'INT', 'POINT')
        vertex_attribute = part.data.attributes.new(VERTEX_ATTRIBUTE, 'INT', 'POINT')
        for vertex in part.data.vertices:
            part_attribute.data[vertex.index].value = part_index
            vertex_attribute.data[vertex.index].value = vertex.index
        copy = part.copy()
        copy.data = part.data.copy()
        captured_parts.append(copy)


def retain_joined_native_coordinates(obj, captured_parts):
    """Keep exact native Blender join-normalized coordinates on editable parts.

    No GLB data or imported geometry is involved. Temporary identities prevent
    independent floating-point rescaling from changing physical point support.
    """
    part_attribute = obj.data.attributes[PART_ATTRIBUTE]
    vertex_attribute = obj.data.attributes[VERTEX_ATTRIBUTE]
    assigned = set()
    for vertex in obj.data.vertices:
        part_index = part_attribute.data[vertex.index].value
        vertex_index = vertex_attribute.data[vertex.index].value
        captured_parts[part_index].data.vertices[vertex_index].co = obj.matrix_world @ vertex.co
        assigned.add((part_index, vertex_index))
    assert len(assigned) == sum(len(part.data.vertices) for part in captured_parts)
    for mesh in [obj.data] + [part.data for part in captured_parts]:
        mesh.attributes.remove(mesh.attributes[PART_ATTRIBUTE])
        mesh.attributes.remove(mesh.attributes[VERTEX_ATTRIBUTE])
    for part in captured_parts:
        part.matrix_world = Matrix.Identity(4)
        part.location = (0, 0, 0)
        part.rotation_euler = (0, 0, 0)
        part.scale = (1, 1, 1)
        part.data.update()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path):
    return str(path.relative_to(ROOT))


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def public_hashes(items):
    return {item[key]: sha(ROOT / item[key]) for item in items for key in ('model', 'thumb', 'top')}


def glb_metrics(path):
    """Read real GLB accessors; canonicalize triangles independent of ordering.

    Full UV equality is recorded separately from geometric/channel equality.
    UV packing may legitimately change with Blender threading or implementation.
    """
    raw = path.read_bytes()
    assert struct.unpack_from('<III', raw) == (0x46546C67, 2, len(raw))
    off = 12
    document = None
    binary = None
    while off < len(raw):
        length, kind = struct.unpack_from('<II', raw, off)
        chunk = raw[off + 8:off + 8 + length]
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        off += 8 + length
    assert document and binary is not None
    for node in document.get('nodes', []):
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale')), 'Unexpected GLB node transform'
    def read(index):
        a = document['accessors'][index]
        view = document['bufferViews'][a['bufferView']]
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        fmt = '<' + {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']] * count
        stride = view.get('byteStride', struct.calcsize(fmt))
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        return [struct.unpack_from(fmt, binary, start + n * stride) for n in range(a['count'])]
    points = []
    geometry = []
    textured = []
    primitive_channels = []
    degenerate_uv = 0
    degenerate_world = 0
    finite = True
    materials = document.get('materials', [])
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4
            positions = read(primitive['attributes']['POSITION'])
            uvs = read(primitive['attributes']['TEXCOORD_0'])
            indices = [x[0] for x in read(primitive['indices'])]
            mat = materials[primitive['material']]
            material_name = mat.get('name', '')
            # Blender avoids duplicate names by adding .001 etc. Strip that
            # suffix for comparison if only the transient build session changed.
            if material_name[-4:-3] == '.' and material_name[-3:].isdigit():
                material_name = material_name[:-4]
            channel = mat.get('extras', {}).get('finishChannel')
            primitive_channels.append({'material': material_name, 'channel': channel, 'triangles': len(indices) // 3})
            points.extend(positions)
            finite = finite and all(math.isfinite(v) for row in positions + uvs for v in row)
            for start in range(0, len(indices), 3):
                ids = indices[start:start + 3]
                triangle = [positions[i] for i in ids]
                a, b, c = [uvs[i] for i in ids]
                area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
                if area <= 1e-12:
                    degenerate_uv += 1
                p, q, r = map(Vector, triangle)
                if (q - p).cross(r - p).length / 2 <= 1e-14:
                    degenerate_world += 1
                # Seven decimals is substantially finer than the <1mm contract.
                shape = tuple(sorted(tuple(round(v, 7) for v in vertex) for vertex in triangle))
                geometry.append((material_name, channel or '', shape))
                # Pair UVs with positions before canonical sorting. Do not hide
                # changed seams by comparing only an unassociated UV point set.
                mapped = tuple(sorted((tuple(round(v, 7) for v in positions[i]), tuple(round(v, 7) for v in uvs[i])) for i in ids))
                textured.append((material_name, channel or '', mapped))
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    canonical = lambda values: hashlib.sha256(json.dumps(sorted(values), separators=(',', ':')).encode()).hexdigest()
    return {
        'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
        'triangles': len(geometry), 'bounds_gltf_m': [lo, hi],
        'dimensions_mm_wdh': [(hi[0]-lo[0])*1000, (hi[2]-lo[2])*1000, (hi[1]-lo[1])*1000],
        'geometry_material_sha256_1e7': canonical(geometry),
        'geometry_material_uv_sha256_1e7': canonical(textured),
        'finish_channels': sorted({m.get('extras', {}).get('finishChannel') for m in materials} - {None}),
        'primitive_material_channels': sorted(primitive_channels, key=lambda x: x['material']),
        'degenerate_uv_triangles': degenerate_uv, 'degenerate_world_triangles': degenerate_world,
        'finite_positions_and_uvs': finite, 'has_image_textures': bool(document.get('images') or document.get('textures')),
    }


def render_qa(obj, path, rear=False, samples=24):
    """Actual transparent 512px Cycles front/rear, preserving source orientation."""
    import exterior_build
    scene = exterior_build._icon_scene(obj)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    exterior_build._sun(3.4, (math.radians(50), 0, math.radians(35)), (3, -4, 6))
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    dims = [max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
    span = max(dims)
    distance = span * 1.9
    direction = 1 if rear else -1
    bpy.ops.object.camera_add(location=(distance * .62, direction * distance * .95, dims[2] * .78 + span * .35))
    camera = bpy.context.object
    camera.name = 'Recovery rear +Y' if rear else 'Recovery front -Y'
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = span * 1.18 * 1.4
    target = Vector((0, 0, dims[2] * .45))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    from png_metadata import strip_metadata
    strip_metadata(path)


def recover(slug, spec_entry, module, item, samples):
    stem = item['id']
    size = tuple(item[k] for k in ('w', 'd', 'h'))
    source_work = HERE / ('work' if module is original else 'expansion/work')
    source_work.mkdir(parents=True, exist_ok=True)
    destination = source_work / (stem + '.blend')
    front = source_work / (stem + '-front.png')
    rear = source_work / (stem + '-rear.png')
    _, _, declared_size, geometry_fn, _, _ = spec_entry
    assert tuple(declared_size) == size
    builder = original.build_one if module is original else expansion.build_model
    expected_channels = {c['key'] for c in item.get('finishChannels', [])}
    captured_parts = []
    combine = kit.combine
    def capture_combine(parts):
        # The last rod can still have a stale matrix_world until evaluated.
        # Keep part/vertex identity through Blender's own native join and the
        # builder's final normalization instead of independently rescaling copies.
        capture_native_parts(parts, captured_parts)
        return combine(parts)
    kit.combine = capture_combine
    original_scene = bpy.context.scene
    original_scene.name = 'Validated export - Blender Z up, front -Y'
    with tempfile.TemporaryDirectory(prefix='rpg-native-recovery-') as tmp:
        temporary = Path(tmp)
        kit.GLB_DIR = temporary / 'glbs'
        kit.WORK_DIR = temporary / 'validation'
        kit.PREVIEW_DIR = temporary / 'unused-previews'
        start = time.monotonic()
        try:
            obj = kit.run([(stem, size, lambda: builder(geometry_fn, size), expected_channels, 6000)], do_export=True, do_icons=False)[0]
        finally:
            kit.combine = combine
        retain_joined_native_coordinates(obj, captured_parts)
        generated = glb_metrics(kit.GLB_DIR / (stem + '.glb'))
        delivered = glb_metrics(ROOT / item['model'])
        comparisons = {
            'geometry_and_material_assignment_match_1e7': generated['geometry_material_sha256_1e7'] == delivered['geometry_material_sha256_1e7'],
            'uv_mapping_match_1e7': generated['geometry_material_uv_sha256_1e7'] == delivered['geometry_material_uv_sha256_1e7'],
            'triangle_count_match': generated['triangles'] == delivered['triangles'],
            'finish_channels_match': generated['finish_channels'] == delivered['finish_channels'] == sorted(expected_channels),
            'primitive_material_channels_match': generated['primitive_material_channels'] == delivered['primitive_material_channels'],
            'maximum_bounds_delta_m': max(abs(a-b) for side_a, side_b in zip(generated['bounds_gltf_m'], delivered['bounds_gltf_m']) for a, b in zip(side_a, side_b)),
        }
        assert comparisons['finish_channels_match']
        assert comparisons['triangle_count_match']
        assert comparisons['geometry_and_material_assignment_match_1e7'], (stem, 'Procedural geometry diverged from delivered geometry')
        assert comparisons['maximum_bounds_delta_m'] < 1e-6
        assert generated['degenerate_uv_triangles'] == 0 and generated['degenerate_world_triangles'] == 0
        # Render before linking captured parts, so the source is the sole subject.
        render_qa(obj, front, samples=samples)
        render_qa(obj, rear, rear=True, samples=samples)
        obj['source_builder'] = rel(HERE / ('build.py' if module is original else 'expansion/build.py'))
        obj['recovery_method'] = 'Original procedural native geometry; no imported GLB geometry'
        obj['front_blender'] = '-Y'
        obj['front_gltf'] = '+Z'
        obj['units'] = 'metres'
        obj['origin'] = 'bottom-centre'
        # The separate native parts remain editable in a secondary scene. They
        # are never exported or mixed into the already-validated display mesh.
        native = bpy.data.scenes.new('Native authoring parts - before joined atlas UV')
        native.unit_settings.system = 'METRIC'
        for part in captured_parts:
            part['authoring_stage'] = 'Actual original procedural part before join and final UV atlas'
            native.collection.objects.link(part)
        bpy.context.view_layer.update()
        # Independent strict check before saving any source. UVs intentionally
        # remain the pre-atlas authoring stage, while physical support must match.
        from qa_asset_delivery import native_scene_signature
        native_signature = native_scene_signature(native)
        export_signature = native_scene_signature(original_scene)
        authoring_checks = {
            'point_support_match': native_signature['point_support'] == export_signature['point_support'],
            'triangle_counts_match': native_signature['triangle_counts'] == export_signature['triangle_counts'],
        }
        assert all(authoring_checks.values()), (stem, 'Native authoring parts differ from validated export')
        source_path = HERE / ('build.py' if module is original else 'expansion/build.py')
        info = bpy.data.texts.new('SOURCE_RECOVERY_README')
        info.write('Original Blender procedural geometry recovered from '+rel(source_path)+'\n'
                   'No delivered GLB geometry was imported. The validated export scene uses metres, Z up, front -Y, bottom-centred origin.\n'
                   'The secondary Native authoring parts scene retains separately editable original parts with exact native join-normalized coordinates.\n'
                   'Dependency-graph evaluation precedes capture; transient part/vertex IDs retain native Blender normalization without GLB import.\n'
                   'Final atlas UVs are on the validated joined export mesh; authoring parts intentionally precede that atlas.\n'
                   'Regenerate with: blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/restore_sources.py -- --only '+slug+'\n'
                   'Public model, thumb and top PNG were preserved. Exact UV equality with the delivered GLB is recorded in the recovery checkpoint.\n'
                   'Original builder SHA256: '+sha(source_path)+'\n')
        # Keep authoring sources portable; rendering used absolute output paths
        # above, but the saved .blend must not retain this executor's workspace.
        original_scene.render.filepath = '//' + rear.name
        native.render.filepath = '//' + stem + '-authoring.png'
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(destination))
        validation = json.loads((kit.WORK_DIR / (stem + '-validation.json')).read_text())
        checkpoint = {
            'id': stem, 'status': 'complete',
            'sourceBlend': rel(destination), 'builder': rel(HERE / 'restore_sources.py'),
            'originalBuilder': rel(source_path), 'originalBuilderSha256': sha(source_path),
            'front': rel(front), 'rear': rel(rear),
            'method': 'Original procedural builders plus shared model_kit.run; no GLB import',
            'native_authoring_parts': len(captured_parts),
            'native_authoring_checks': authoring_checks,
            'validation': validation, 'comparison': comparisons,
            'regenerated_glb': generated, 'delivered_glb': delivered,
            'elapsed_seconds': round(time.monotonic()-start, 2),
            'source_sha256': sha(destination), 'front_sha256': sha(front), 'rear_sha256': sha(rear),
            'blender_version': bpy.app.version_string,
            'render': {'engine': 'Cycles', 'samples': samples, 'threads': 2, 'resolution': [512, 512], 'front_camera_blender': '-Y', 'rear_camera_blender': '+Y'},
        }
        write_json(RECOVERY / 'checkpoints' / (stem + '.json'), checkpoint)
        print('RECOVERY_COMPLETE '+stem+' native_parts='+str(len(captured_parts))+' geometry_match='+str(comparisons['geometry_and_material_assignment_match_1e7'])+' uv_match='+str(comparisons['uv_mapping_match_1e7']), flush=True)
        # Delete the secondary authoring scene before processing the next item.
        for part in captured_parts:
            mesh = part.data
            bpy.data.objects.remove(part, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.scenes.remove(native)
        bpy.data.texts.remove(info)
        return checkpoint


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='Comma-separated slugs; sofa and wing-chair are excluded')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--samples', type=int, default=24)
    options = parser.parse_args(args)
    assert 16 <= options.samples <= 32
    manifest = json.loads((PACK / 'manifest.json').read_text())
    items = {item['id']: item for item in manifest['items']}
    relevant = [item for item in manifest['items'] if item['id'] in {'rpg-mansion-'+s[0]+'-01' for s in original.SPECS+expansion.SPECS} and item['id'] not in {'rpg-mansion-'+slug+'-01' for slug in EXCLUDED}]
    before = public_hashes(relevant)
    validation_before = {item['validation']: sha(ROOT / item['validation']) for item in relevant}
    write_json(RECOVERY / 'preserved-public-hashes.json', before)
    selected = set(options.only.split(',')) if options.only else None
    failures = []
    for module in (original, expansion):
        for entry in module.SPECS:
            slug = entry[0]
            if slug in EXCLUDED or (selected is not None and slug not in selected):
                continue
            stem = 'rpg-mansion-'+slug+'-01'
            checkpoint = RECOVERY / 'checkpoints' / (stem + '.json')
            if options.resume and checkpoint.exists():
                prior = json.loads(checkpoint.read_text())
                if prior.get('status') == 'complete' and all((ROOT / prior[k]).is_file() and sha(ROOT / prior[k]) == prior[h] for k, h in (('sourceBlend', 'source_sha256'), ('front', 'front_sha256'), ('rear', 'rear_sha256'))):
                    print('RECOVERY_RESUME_SKIP '+stem, flush=True)
                    continue
            try:
                recover(slug, entry, module, items[stem], options.samples)
            except Exception as error:
                import traceback
                traceback.print_exc()
                failures.append({'id': stem, 'error': repr(error)})
                write_json(RECOVERY / 'checkpoints' / (stem + '.json'), failures[-1] | {'status': 'failed'})
                print('RECOVERY_FAILED '+stem+' '+repr(error), flush=True)
    after = public_hashes(relevant)
    validations_after = {item['validation']: sha(ROOT / item['validation']) for item in relevant}
    assert before == after, 'Reviewed public assets changed'
    assert validation_before == validations_after, 'Existing validation JSON changed'
    checkpoints = [json.loads(p.read_text()) for p in sorted((RECOVERY / 'checkpoints').glob('*.json'))]
    complete = [c for c in checkpoints if c.get('status') == 'complete']
    metadata = {c['id']: {key: c[key] for key in ('sourceBlend', 'builder', 'originalBuilder', 'front', 'rear')} for c in complete}
    write_json(RECOVERY / 'metadata-map.json', metadata)
    write_json(RECOVERY / 'recovery-report.json', {
        'expected_sources': 48, 'completed_sources': len(complete), 'failed_sources': [c for c in checkpoints if c.get('status') != 'complete'],
        'excluded_seating_slugs': sorted(EXCLUDED), 'public_model_thumb_top_hashes_preserved': before == after,
        'existing_validation_json_hashes_preserved': validation_before == validations_after,
        'geometry_matches': sum(c['comparison']['geometry_and_material_assignment_match_1e7'] for c in complete),
        'exact_uv_mapping_matches_1e7': sum(c['comparison']['uv_mapping_match_1e7'] for c in complete),
        'uv_mapping_differences': [c['id'] for c in complete if not c['comparison']['uv_mapping_match_1e7']],
        'method': 'Direct original procedural functions; shared model_kit.run; temporary regenerated GLB compared with actual delivered accessors; public bytes untouched',
    })
    print('RECOVERY_BATCH_FINISHED complete='+str(len(complete))+' failures='+str(len(failures)), flush=True)
    if failures:
        raise RuntimeError('Recovery failed for '+', '.join(f['id'] for f in failures))


if __name__ == '__main__':
    main()
