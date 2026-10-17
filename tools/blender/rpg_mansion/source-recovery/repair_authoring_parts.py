"""Rebuild only separately editable native parts, preserving the validated scene.

Dry run:
  blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/source-recovery/repair_authoring_parts.py
Apply the bounded historical repair:
  blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/source-recovery/repair_authoring_parts.py -- --apply

No GLB geometry is imported, no public asset is written, and no render is run.
Receipts and optional before-source backups stay in --output, outside delivery.
"""
import argparse
import hashlib
import importlib.util
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DEFAULT_SLUGS = (
    'butler-sink', 'bathtub', 'washstand', 'sconce', 'chandelier', 'coat-stand',
    'umbrella-stand', 'planter', 'fireplace', 'radiator', 'armour',
)
spec = importlib.util.spec_from_file_location('native_recovery_engine', HERE.parent / 'restore_sources.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
from qa_asset_delivery import native_scene_signature


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mesh_digest(scene):
    values = []
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        values.append({
            'name': obj.name, 'matrix_world': [list(row) for row in obj.matrix_world],
            'vertices': [list(vertex.co) for vertex in mesh.vertices],
            'edges': [list(edge.vertices) for edge in mesh.edges],
            'polygons': [[list(p.vertices), p.material_index, p.use_smooth] for p in mesh.polygons],
            'uv': {layer.name: [list(loop.uv) for loop in layer.data] for layer in mesh.uv_layers},
            'materials': [[mat.name, mat.get('finishChannel'), list(mat.diffuse_color)] for mat in mesh.materials],
        })
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def rebuild_parts(validated, stem):
    """Use original procedural builders and their exact native join arithmetic."""
    old_materials = {mat.name: mat for obj in validated.objects if obj.type == 'MESH' for mat in obj.data.materials}
    slug = stem[len('rpg-mansion-'):-len('-01')]
    module = engine.original if any(entry[0] == slug for entry in engine.original.SPECS) else engine.expansion
    entry = next(entry for entry in module.SPECS if entry[0] == slug)
    temporary = bpy.data.scenes.new('Temporary native source-only repair')
    bpy.context.window.scene = temporary
    captured = []
    combine = engine.kit.combine

    def capture(parts):
        # Reuse validated source materials rather than transient .001 copies.
        for part in parts:
            for index, material in enumerate(part.data.materials):
                name = material.name
                if name[-4:-3] == '.' and name[-3:].isdigit():
                    name = name[:-4]
                assert name in old_materials, (stem, name)
                assert old_materials[name].get('finishChannel') == material.get('finishChannel')
                part.data.materials[index] = old_materials[name]
        engine.capture_native_parts(parts, captured)
        return combine(parts)

    engine.kit.combine = capture
    try:
        builder = module.build_one if module is engine.original else module.build_model
        obj = builder(entry[3], entry[2])
    finally:
        engine.kit.combine = combine
    engine.retain_joined_native_coordinates(obj, captured)
    native = bpy.data.scenes.new('Rebuilt native authoring candidate')
    native.unit_settings.system = 'METRIC'
    native.unit_settings.scale_length = 1
    for part in captured:
        part['authoring_stage'] = 'Actual original procedural part before join and final UV atlas'
        native.collection.objects.link(part)
    native.render.filepath = '//' + stem + '-authoring.png'
    bpy.context.window.scene = native
    bpy.context.view_layer.update()
    actual = native_scene_signature(native)
    expected = native_scene_signature(validated)
    regenerated = native_scene_signature(temporary)
    assert actual['point_support'] == expected['point_support'], (stem, 'Native point support differs')
    assert actual['triangle_counts'] == expected['triangle_counts'], (stem, 'Native triangle counts differ')
    assert regenerated['triangle_surfaces'] == expected['triangle_surfaces'], (stem, 'Current builder topology differs')
    return native, temporary, len(captured)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', default=','.join(DEFAULT_SLUGS), help='Comma-separated bounded slugs')
    parser.add_argument('--apply', action='store_true', help='Replace only native authoring scenes and checkpoint hashes')
    parser.add_argument('--output', type=Path, default=HERE.parent / 'polish/qa/source-repair')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    metadata = json.loads((HERE / 'metadata-map.json').read_text())
    requested = ['rpg-mansion-' + slug + '-01' for slug in args.only.split(',') if slug]
    assert requested and len(requested) == len(set(requested)) and set(requested) <= set(metadata)
    manifest = json.loads((ROOT / 'assets/models/packs/rpg-mansion/manifest.json').read_text())
    public = {ROOT / item[key] for item in manifest['items'] for key in ('model', 'thumb', 'top', 'rear', 'frontPreview', 'validation') if item.get(key) and (ROOT / item[key]).is_file()}
    public_before = {str(path.relative_to(ROOT)): sha(path) for path in public}
    other_sources = {ROOT / item['sourceBlend'] for item in manifest['items'] if item['id'] not in requested}
    other_before = {str(path.relative_to(ROOT)): sha(path) for path in other_sources}
    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for stem in requested:
        source = ROOT / metadata[stem]['sourceBlend']
        checkpoint_path = HERE / 'checkpoints' / (stem + '.json')
        checkpoint = json.loads(checkpoint_path.read_text())
        before = sha(source)
        assert checkpoint['source_sha256'] == before, (stem, 'Checkpoint is stale')
        bpy.ops.wm.open_mainfile(filepath=str(source))
        validated = bpy.context.scene
        digest = mesh_digest(validated)
        old_native = next(scene for scene in bpy.data.scenes if scene.name.startswith('Native authoring parts'))
        old_name = old_native.name
        native, temporary, count = rebuild_parts(validated, stem)
        row = {'id': stem, 'sourceBlend': metadata[stem]['sourceBlend'], 'source_sha256_before': before,
               'current_original_builder_sha256': sha(ROOT / metadata[stem]['originalBuilder']),
               'native_parts': count, 'point_support_match': True, 'triangle_counts_match': True,
               'regenerated_joined_triangle_surfaces_match': True,
               'validated_mesh_digest': digest, 'applied': args.apply}
        if args.apply:
            backups = args.output / 'backups'
            backups.mkdir(exist_ok=True)
            shutil.copy2(source, backups / source.name)
            shutil.copy2(checkpoint_path, backups / (stem + '-checkpoint.json'))
            bpy.context.window.scene = validated
            for scene in (old_native, temporary):
                for obj in list(scene.objects):
                    assert obj.name not in validated.objects
                    bpy.data.objects.remove(obj, do_unlink=True)
                bpy.data.scenes.remove(scene)
            native.name = old_name
            validated.render.filepath = '//' + Path(metadata[stem]['rear']).name
            assert mesh_digest(validated) == digest
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(source))
            after = sha(source)
            bpy.ops.wm.open_mainfile(filepath=str(source))
            assert mesh_digest(bpy.context.scene) == digest
            checkpoint['source_sha256'] = after
            checkpoint['native_authoring_parts'] = count
            checkpoint['native_authoring_checks'] = {'point_support_match': True, 'triangle_counts_match': True}
            checkpoint['native_authoring_repair'] = {'created_utc': datetime.now(timezone.utc).isoformat(),
                'source_sha256_before': before, 'source_sha256_after': after,
                'method': 'Original native builder parts, evaluated capture, exact native join-normalized coordinates; validated mesh preserved; no GLB import',
                'validated_mesh_digest_preserved': digest}
            checkpoint_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + '\n')
            row['source_sha256_after'] = after
        rows.append(row)
        print('NATIVE_PARTS_REPAIR ' + stem + ' PASS', flush=True)
    assert public_before == {str(path.relative_to(ROOT)): sha(path) for path in public}
    assert other_before == {str(path.relative_to(ROOT)): sha(path) for path in other_sources}
    report = {'scope': 'Bounded source-only native authoring-parts reconstruction; no GLB import, rendering, or public asset writes',
              'applied': args.apply, 'models': rows, 'public_files_preserved': len(public), 'other_sources_preserved': len(other_sources)}
    (args.output / 'repair-receipt.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
