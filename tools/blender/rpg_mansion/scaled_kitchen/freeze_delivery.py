"""Create an exact, public-safe asset-only delivery seal from current files.

This script never opens Blender, rewrites models/images/sources, or publishes.
Only family-local JSON delivery records are written. Run after all production
and audits are finished; any later payload change invalidates the seal.
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
import qa_asset_delivery as qa
qa.ROOT = ROOT
from source_privacy import audit_sources


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path):
    return str(path.resolve().relative_to(ROOT))


def write(path, value):
    text = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if any('/' + name + '/' in text for name in ['workspace', 'root', 'home', 'tmp']):
        raise ValueError('Private path in public delivery record: ' + path.name)
    path.write_text(text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--acceptance-report', type=Path,
                        help='Optional final independent report already copied to a repository-relative delivery path')
    args = parser.parse_args()
    items = json.loads((HERE / 'descriptors.json').read_text())['items']
    if len(items) != 22 or len({item['id'] for item in items}) != 22:
        raise ValueError('Expected exactly 22 unique kitchen assets')
    baseline = {row['id']: row for row in json.loads((HERE / 'pre-joinery-snapshot.json').read_text())}
    changed = json.loads((HERE / 'changed-render-ids.json').read_text())
    actual = [qa.audit_item(item) for item in items]
    if any(row['errors'] for row in actual):
        raise ValueError('Actual-byte audit has unresolved errors')
    privacy = audit_sources()
    write(HERE / 'source-privacy-qa.json', privacy)
    if privacy['errors']:
        raise ValueError('Compressed native source privacy gate has unresolved errors')
    measured = [row['id'] for row in actual
                if any(row['geometry_signature'][key] != baseline[row['id']]['geometry'][key]
                       for key in ['point_support', 'triangle_counts', 'triangle_surfaces'])]
    if measured != changed:
        raise ValueError('Supplied image-refresh list differs from actual physical-geometry changes')
    render_rows = []
    for item, row in zip(items, actual):
        image_rows = {key: {'path': item[key], 'bytes': (ROOT / item[key]).stat().st_size,
                            'sha256': sha256(ROOT / item[key]),
                            'baselineSha256': baseline[item['id']]['images'][key],
                            'bytePreserved': sha256(ROOT / item[key]) == baseline[item['id']]['images'][key]}
                      for key in ['thumb', 'top', 'front', 'rear']}
        if item['id'] not in changed and not all(value['bytePreserved'] for value in image_rows.values()):
            raise ValueError('Unchanged geometry image preservation failed: ' + item['id'])
        render_rows.append({'id': item['id'], 'physicalGeometryChanged': item['id'] in changed,
                            'currentPhysicalGeometrySignature': {key: row['geometry_signature'][key]
                                                                  for key in ['point_support', 'triangle_counts', 'triangle_surfaces']},
                            'images': image_rows})
    write(HERE / 'render-provenance.json', {
        'method': 'Actual final GLB geometry comparison and PNG byte hashes against the supplied pre-joinery baseline',
        'changedPhysicalGeometryCount': len(changed), 'unchangedPhysicalGeometryCount': len(items) - len(changed),
        'renderScope': 'Four views refreshed for physically changed assets; all four files preserved for unchanged assets',
        'uvOnlyChangePolicy': 'Keep images only when exact render-relevant geometry/material/smoothing/normal invariants are preserved',
        'imageCurrencyIndependentGate': 'Requires the coordinator independent render-currency acceptance report',
        'items': render_rows})
    write(HERE / 'rights-provenance.json', {
        'set': 'rpg-mansion', 'family': 'measured modular scullery and kitchen', 'assetCount': len(items),
        'assetProvenance': 'original',
        'rightsBasis': 'Original measured procedural Blender mesh authoring, preserved as editable native scenes and reproducible family scripts',
        'thirdPartyMeshes': [], 'thirdPartyTextures': [], 'importedReferenceImagery': [], 'paidGenerationServices': [],
        'existingHelperCode': 'Existing project Blender helper code is retained as a dependency under its existing project terms',
        'licenseAssignment': 'This provenance record does not create a new public license; project owner-approved distribution terms apply',
        'functionalContract': 'Static furniture and fixtures; no opening, water, heat, wall-cutting or application behaviour is claimed',
        'items': [{'id': item['id'], 'model': item['model'], 'sourceBlend': item['sourceBlend'], 'builder': item['builder'],
                   'nativeAuthoringScene': 'Native authoring parts', 'validatedExportScene': 'Validated export'} for item in items]})
    paths = {}
    def include(path, category):
        path = path.resolve()
        name = relative(path)
        if not path.is_file():
            raise FileNotFoundError(name)
        if any(part in ['__pycache__', 'qa', 'regenerated'] for part in path.parts):
            raise ValueError('Temporary path requested for delivery: ' + name)
        paths[name] = category
    for item in items:
        for key, category in [('model', 'runtimeModel'), ('thumb', 'publicPreview'), ('top', 'publicPreview'),
                              ('sourceBlend', 'nativeSource'), ('validation', 'validation'),
                              ('front', 'inspectionImage'), ('rear', 'inspectionImage')]:
            include(ROOT / item[key], category)
        component = HERE / 'work' / (item['id'].removeprefix('rpg-mansion-').removesuffix('-01') + '-components.json')
        include(component, 'nativeComponentMetadata')
    for name in ['build.py', 'finalize_sources.py', 'native_uv.py', 'repair_uv_atlas.py', 'sanitize_source_ui.py', 'render_batch.py',
                 'render_sink_detail.py', 'qa_batch.py', 'qa_sources.py', 'refresh_validation.py',
                 'make_contact_sheets.py', 'source_privacy.py', 'freeze_delivery.py']:
        include(HERE / name, 'familyScript')
    for name in ['tools/blender/model_kit.py', 'tools/blender/exterior_build.py', 'tools/blender/build_decor.py',
                 'tools/blender/shape_kit.py', 'tools/blender/rpg_mansion/png_metadata.py',
                 'tools/blender/rpg_mansion/render_config.py', 'tools/blender/rpg_mansion/qa_asset_delivery.py']:
        include(ROOT / name, 'existingProjectDependency')
    for name in ['README.md', 'descriptors.json', 'changed-render-ids.json', 'pre-joinery-snapshot.json',
                 'packed-uv-repair-report.json', 'sink-basin-depth-evidence.json', 'actual-byte-qa.json',
                 'reopened-source-qa.json', 'contact-sheet-provenance.json', 'render-provenance.json',
                 'source-privacy-qa.json', 'source-ui-cleanup-report.json', 'source-model-freeze.json', 'rights-provenance.json']:
        include(HERE / name, 'metadataOrReport')
    for view in ['front', 'top', 'rear']:
        include(HERE / ('kitchen-final-' + view + '-contact-sheet.png'), 'contactSheet')
    include(HERE / 'evidence/sink-basin-depth-closeup.png', 'inspectionImage')
    acceptance = {'status': 'pending', 'runtimeVisualQa': 'pending coordinator gate'}
    if args.acceptance_report:
        path = ROOT / args.acceptance_report
        data = json.loads(path.read_text())
        if data.get('errors') not in [0, []] or data.get('failures', []) not in [0, []]:
            raise ValueError('Independent report has errors or no explicit zero-error result')
        include(path, 'independentAcceptanceReport')
        acceptance = {'status': 'accepted', 'report': relative(path), 'sha256': sha256(path),
                      'runtimeVisualQa': 'Separate coordinator gate; see named report scope'}
    # Metadata products are named before writing; no directory-wide wildcard is published.
    for name, category in [('delivery-files.json', 'publisherAllowlist'), ('delivery-hashes.json', 'sha256Ledger'),
                           ('delivery-checkpoint.json', 'durableCheckpoint')]:
        paths[relative(HERE / name)] = category
    ordered = sorted(paths)
    write(HERE / 'delivery-files.json', {'scope': 'Exact asset-only publisher allowlist; no manifest/application/account/remote/deployment changes',
                                         'set': 'rpg-mansion', 'assetCount': len(items),
                                         'files': [{'path': name, 'category': paths[name]} for name in ordered],
                                         'excluded': ['logs', 'caches', 'backups', 'temporary QA re-exports', 'raw QA requests', 'obsolete evidence']})
    totals = {category: sum((ROOT / name).stat().st_size for name in ordered if paths[name] == category)
              for category in ['runtimeModel', 'publicPreview', 'nativeSource', 'nativeComponentMetadata', 'inspectionImage', 'contactSheet']}
    model_rows = [{'id': item['id'], 'modelPath': item['model'], 'modelBytes': row['bytes'], 'modelSha256': row['sha256'],
                   'sourcePath': item['sourceBlend'], 'sourceBytes': (ROOT / item['sourceBlend']).stat().st_size,
                   'sourceSha256': sha256(ROOT / item['sourceBlend']), 'triangles': row['triangles'], 'uv': row['uv']}
                  for item, row in zip(items, actual)]
    sources = json.loads((HERE / 'reopened-source-qa.json').read_text())
    if sources.get('errors') != 0 or len(sources.get('items', [])) != len(items):
        raise ValueError('Reopened native source gate incomplete')
    for row in sources['items']:
        item = next(item for item in items if item['id'] == row['id'])
        if row['source_sha256'] != sha256(ROOT / item['sourceBlend']):
            raise ValueError('Reopened source report is stale: ' + row['id'])
    write(HERE / 'delivery-checkpoint.json', {
        'status': 'Asset bytes and packaging frozen; independent acceptance ' + acceptance['status'],
        'assetCount': len(items), 'descriptorSha256': sha256(HERE / 'descriptors.json'),
        'allowlistPath': relative(HERE / 'delivery-files.json'), 'allowlistSha256': sha256(HERE / 'delivery-files.json'),
        'ledgerPath': relative(HERE / 'delivery-hashes.json'),
        'actualModelBytes': totals['runtimeModel'], 'actualPublicPngBytes': totals['publicPreview'],
        'actualNativeSourceBytes': totals['nativeSource'], 'actualNativeComponentMetadataBytes': totals['nativeComponentMetadata'],
        'actualSourcePayloadBytes': totals['nativeSource'] + totals['nativeComponentMetadata'],
        'actualTriangles': sum(row['triangles'] for row in actual), 'payloadCategoryBytes': totals,
        'sourceAudit': '22 canonical compressed sources reopened without saving; active validated one-mesh scene and separate authoring parts verified',
        'independentAcceptance': acceptance, 'scope': 'Asset-only local delivery; nothing merged or deployed', 'items': model_rows})
    ledger_name = relative(HERE / 'delivery-hashes.json')
    records = [{'path': name, 'category': paths[name], 'bytes': (ROOT / name).stat().st_size,
                'sha256': sha256(ROOT / name)} for name in ordered if name != ledger_name]
    for record in records:
        path = ROOT / record['path']
        if path.suffix in ['.json', '.md', '.py'] and any('/' + name + '/' in path.read_text() for name in ['workspace', 'root', 'home', 'tmp']):
            raise ValueError('Private path in intended publication file: ' + record['path'])
    write(HERE / 'delivery-hashes.json', {'algorithm': 'SHA-256', 'fileCount': len(records),
                                        'selfExcluded': ledger_name, 'totalLedgeredBytes': sum(record['bytes'] for record in records),
                                        'files': records})
    print(json.dumps({'descriptorSha256': sha256(HERE / 'descriptors.json'),
                      'allowlistSha256': sha256(HERE / 'delivery-files.json'),
                      'checkpointSha256': sha256(HERE / 'delivery-checkpoint.json'),
                      'ledgerSha256': sha256(HERE / 'delivery-hashes.json'), 'allowlistedFiles': len(ordered),
                      'actualModelBytes': totals['runtimeModel'], 'actualPublicPngBytes': totals['publicPreview'],
                      'actualSourcePayloadBytes': totals['nativeSource'] + totals['nativeComponentMetadata'],
                      'actualTriangles': sum(row['triangles'] for row in actual)}, indent=2))


if __name__ == '__main__':
    main()
