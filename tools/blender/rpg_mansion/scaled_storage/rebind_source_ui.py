"""Rebind validated geometry evidence after proven metadata/UI-only saves.

No rendering, native mesh editing, geometry regeneration or GLB export occurs.
Prior geometric gates and render provenance remain intact and explicitly bound
to an exact pre/post authored-data signature. Run after read-only source QA.
"""
from pathlib import Path
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def load(name):
    return json.loads((HERE / name).read_text())


def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    report = load('source-ui-cleanup-report.json')
    rows = {row['sourcePath']: row for row in report['items']}
    manifest = load('storage-items.json')
    items = manifest['items']
    assert len(items) == 15 and len(rows) == 30 and not report['errors']
    assert len(report['immutableFiles']) == 75
    for row in rows.values():
        assert row['authoredDataPreserved'] and row['glbAndPngBytesPreserved'] and row['compressedAndReopened']
        assert row['authoredDataSignature'] == row['reopenedAuthoredDataSignature']
        assert sha256(ROOT / row['sourcePath']) == row['sourceSha256']
    for row in report['immutableFiles']:
        assert sha256(ROOT / row['path']) == row['sha256'], row['path']

    def rebind(row, key, source_path):
        source = rows[source_path]
        assert row[key] in {source['previousSourceSha256'], source['sourceSha256']}, source_path
        row[key] = source['sourceSha256']
        row['metadataOnlySourceRefresh'] = {
            'revision': report['revision'],
            'sourceSha256BeforeUiCleanup': source['previousSourceSha256'],
            'authoredDataSignature': source['authoredDataSignature'],
            'scope': 'Saved UI directory metadata only; original geometry, UV, corner normals, material graphs and custom properties preserved exactly'}

    for item in items:
        source = rows[item['sourceBlend']]
        assert item['sha256'] == sha256(ROOT / item['model'])
        assert item['sourceSha256'] in {source['previousSourceSha256'], source['sourceSha256']}
        item['sourceSha256'] = source['sourceSha256']
        validation = json.loads((ROOT / item['validation']).read_text())
        rebind(validation, 'sourceSha256', item['sourceBlend'])
        (ROOT / item['validation']).write_text(json.dumps(validation, indent=2) + '\n')
    write('storage-items.json', manifest)
    item_by_id = {item['id']: item for item in items}

    authoring = load('qa-authoring-sources.json')
    generic = load('generic-source-qa/source-checkpoint.json')
    contacts = load('qa-namedpart-contact.json')
    renders = load('render-source-snapshot.json')
    repair = load('repair-checkpoint.json')
    for document, source_key in ((authoring, 'sourceSha256'), (generic, 'source_sha256'),
                                 (contacts['items'], 'source_sha256'), (renders['items'], 'sourceSha256'),
                                 (repair['items'], 'sourceSha256')):
        assert len(document) == 15
        for row in document:
            rebind(row, source_key, item_by_id[row['id']]['sourceBlend'])
    repair['sourceUiNormalization'] = {
        'revision': report['revision'], 'status': 'complete-metadata-ui-only-sources-verified',
        'sourceFiles': 30, 'unchangedGlbFiles': 15, 'unchangedPngFiles': 60,
        'report': 'tools/blender/rpg_mansion/scaled_storage/source-ui-cleanup-report.json',
        'checkpoint': 'tools/blender/rpg_mansion/scaled_storage/source-ui-cleanup-checkpoint.json',
        'scope': report['scope']}
    write('qa-authoring-sources.json', authoring)
    write('generic-source-qa/source-checkpoint.json', generic)
    write('qa-namedpart-contact.json', contacts)
    write('render-source-snapshot.json', renders)
    write('repair-checkpoint.json', repair)

    rights = load('rights-and-provenance.json')
    for row in rights['assets']:
        item = item_by_id[row['id']]
        row['canonicalSourceSha256'] = rows[item['sourceBlend']]['sourceSha256']
        row['authoringOnlySha256'] = rows[item['authoringBlend']]['sourceSha256']
    for name in ('sanitize_source_ui.py', 'source_privacy.py', 'rebind_source_ui.py'):
        rights['authoringModules'][name] = sha256(HERE / name)
    rights['sourceUiNormalization'] = repair['sourceUiNormalization']
    write('rights-and-provenance.json', rights)

    totals = load('delivery-totals.json')
    assert totals['glbBytes'] == 1873980 and totals['triangles'] == 41868
    totals['canonicalSourceBytes'] = sum((ROOT / item['sourceBlend']).stat().st_size for item in items)
    totals['sourceUiOnlyRefreshedFiles'] = 30
    totals['sourceUiAuthoredDataErrors'] = 0
    totals['sourceUiUnchangedDeliveryFiles'] = 75
    write('delivery-totals.json', totals)

    native = load('qa-native-files.json')
    privacy = load('source-privacy-qa.json')
    assert len(native) == 15 and not any(row['errors'] for row in native)
    assert privacy['sourceFiles'] == 30 and not privacy['errors']
    for row in native:
        for source in row['sources']:
            assert source['sha256'] == rows[source['path']]['sourceSha256']
    for source in privacy['items']:
        assert source['sha256'] == rows[source['sourcePath']]['sourceSha256']
        assert source['privateAbsolutePathOccurrences'] == 0

    checkpoint = {
        'revision': report['revision'], 'status': 'complete-metadata-ui-only-sources-verified',
        'scope': report['scope'],
        'sourceFiles': 30, 'canonicalSources': 15, 'partOnlyEditableSources': 15,
        'unchangedDeliveryFiles': 75, 'unchangedGlbFiles': 15, 'unchangedPngFiles': 60,
        'modelBytes': 1873980, 'modelTriangles': 41868,
        'geometryRegenerated': False, 'modelsReexported': False, 'imagesRerendered': False,
        'exactAuthoredDataSignaturesPreserved': True, 'compressedSourcesReopened': 30,
        'sourceReopeningErrors': 0, 'privateAbsolutePathOccurrences': 0,
        'evidenceBinding': 'Original source/contact/reexport/render gates are retained; current native sources have exactly identical authored data after unused saved UI metadata normalization',
        'sources': report['items'], 'immutableFiles': report['immutableFiles'],
        'reportSha256': sha256(HERE / 'source-ui-cleanup-report.json'),
        'descriptorSha256': sha256(HERE / 'storage-items.json'),
        'nativeReopeningReportSha256': sha256(HERE / 'qa-native-files.json'),
        'nativePrivacyReportSha256': sha256(HERE / 'source-privacy-qa.json'), 'errors': []}
    write('source-ui-cleanup-checkpoint.json', checkpoint)
    print('STORAGE_SOURCE_UI_REBOUND', len(rows), 'GLB/PNG_UNCHANGED', 75)


if __name__ == '__main__':
    main()
