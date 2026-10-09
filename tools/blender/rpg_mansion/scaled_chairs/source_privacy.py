"""Inspect compressed native payloads for retained private absolute paths.

Read-only. The public report contains occurrence counts, never the private
strings themselves. Saved Blender UI state is inspected as well as asset data.
"""
from pathlib import Path
import hashlib
import json
import re
import zstandard

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRIVATE_PATTERN = re.compile(rb'/(?:workspace|root|home|tmp)(?:/[^\x00\s]*)?(?=[\x00\s]|$)')


def audit_sources():
    items = json.loads((HERE / 'descriptors.json').read_text())['items']
    rows = []
    for original in items:
      for field in ['sourceBlend','authoringBlend']:
        item = dict(original, sourceBlend=original[field])
        path = ROOT / item['sourceBlend']
        raw = path.read_bytes()
        compressed = raw[:4] == bytes.fromhex('28b52ffd')
        if compressed:
            with zstandard.ZstdDecompressor().stream_reader(path.open('rb')) as reader:
                native = reader.read()
        else:
            native = raw
        occurrences = len(PRIVATE_PATTERN.findall(native))
        rows.append({'id': item['id'], 'field': field, 'sourcePath': item['sourceBlend'],
                     'sha256': hashlib.sha256(raw).hexdigest(), 'compressed': compressed,
                     'sourceBytes': len(raw), 'decodedNativeBytes': len(native),
                     'privateAbsolutePathOccurrences': occurrences,
                     'errors': (['Canonical source is not compressed'] if not compressed else [])
                               + (['Saved native payload retains a private absolute path'] if occurrences else [])})
    return {'method': 'Read-only decompression and full native-payload path scan, including saved UI state',
            'items': rows, 'errors': sum(len(row['errors']) for row in rows)}


def main():
    report = audit_sources()
    (HERE / 'source-privacy-qa.json').write_text(json.dumps(report, indent=2) + '\n')
    print('NATIVE_PRIVACY_ERRORS', report['errors'])
    if report['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
