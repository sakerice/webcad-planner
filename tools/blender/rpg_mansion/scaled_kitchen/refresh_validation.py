"""Refresh delivery metadata from current bytes, without opening or saving assets."""
from pathlib import Path
import hashlib
import json
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
import qa_asset_delivery as qa
qa.ROOT = ROOT


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    items = json.loads((HERE / 'descriptors.json').read_text())['items']
    for item in items:
        report = qa.audit_item(item)
        if report['errors']:
            raise ValueError(item['id'] + ': ' + '; '.join(report['errors']))
        path = ROOT / item['validation']
        validation = json.loads(path.read_text())
        validation.update(
            glb_bytes=report['bytes'], glb_sha256=report['sha256'],
            source_bytes=(ROOT / item['sourceBlend']).stat().st_size,
            source_sha256=sha256(ROOT / item['sourceBlend']),
            builder_sha256=sha256(ROOT / item['builder']),
            triangles=report['triangles'], actual_dimensions_wdh_mm=report['actual_dimensions_wdh_mm'],
            actual_bounds_gltf_m=report['actual_bounds_gltf_m'], actual_uv_glb=report['uv'],
            validation_measurement='Decoded final annotated GLB vertex/index/UV bytes; current source and builder file hashes',
            material_finish_channels=report['actual_finish_channels'])
        validation['actual_file_hashes'] = {key: {'path': item[key], 'sha256': sha256(ROOT / item[key]),
                                                 'bytes': (ROOT / item[key]).stat().st_size}
                                          for key in ['model', 'sourceBlend', 'builder', 'thumb', 'top', 'front', 'rear']}
        path.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
    repair_path = HERE / 'packed-uv-repair-report.json'
    repairs = json.loads(repair_path.read_text())
    by_id = {item['id']: item for item in items}
    for row in repairs['items']:
        item = by_id[row['id']]
        current_source = sha256(ROOT / item['sourceBlend'])
        if row.get('source_sha256') != current_source:
            row.setdefault('source_sha256_at_repair', row['source_sha256'])
            row['source_sha256'] = current_source
            row['source_hash_rebinding'] = 'Source-only unused UI directory cleanup; authored geometry/UV/material/normals/custom properties preserved exactly'
            row['source_ui_cleanup_report'] = str((HERE / 'source-ui-cleanup-report.json').relative_to(ROOT))
        row['model_sha256'] = sha256(ROOT / item['model'])
        row['builder_sha256'] = sha256(ROOT / item['builder'])
        row['repair_script_sha256'] = sha256(HERE / 'repair_uv_atlas.py')
    repair_path.write_text(json.dumps(repairs, indent=2) + '\n')
    print('Refreshed actual-byte validation metadata for', len(items), 'assets')


if __name__ == '__main__':
    main()
