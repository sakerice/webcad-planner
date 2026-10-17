"""Read-only full saved/native-byte audit, including unused saved UI state.

Directory roots and names are matched with or without a trailing separator.
Public reports retain only counts and hashes, never matched private strings.
"""
from pathlib import Path
import gzip
import hashlib
import io
import json
import re
import zstandard

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRIVATE_PATTERN = re.compile(rb'/(?:workspace|root|home|tmp)(?:/[^\x00\s]*)?(?=[\x00\s]|$)')


def decoded_bytes(raw):
    if raw.startswith(bytes.fromhex('28b52ffd')):
        with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw)) as reader:
            return reader.read(), 'zstd'
    if raw.startswith(bytes.fromhex('1f8b')):
        return gzip.decompress(raw), 'gzip'
    return raw, 'plain'


def path_occurrences(payload):
    return len(PRIVATE_PATTERN.findall(payload))


def audit_sources():
    items = json.loads((HERE / 'storage-items.json').read_text())['items']
    rows = []
    for item in items:
        for key in ('sourceBlend', 'authoringBlend'):
            path = ROOT / item[key]
            raw = path.read_bytes()
            native, encoding = decoded_bytes(raw)
            assert native.startswith(b'BLENDER'), item[key]
            hits = path_occurrences(native)
            errors = ([] if encoding == 'zstd' else ['Saved source is not compressed'])
            if hits:
                errors.append('Saved native payload retains an unnecessary private absolute directory')
            rows.append({'id': item['id'], 'kind': key, 'sourcePath': item[key],
                         'sha256': hashlib.sha256(raw).hexdigest(), 'encoding': encoding,
                         'sourceBytes': len(raw), 'decodedNativeBytes': len(native),
                         'privateAbsolutePathOccurrences': hits, 'errors': errors})
    return {'method': 'Read-only full decompressed native payload scan, including saved UI and directory strings without trailing separators',
            'sourceFiles': len(rows), 'items': rows,
            'errors': sum(len(row['errors']) for row in rows)}


def main():
    report = audit_sources()
    (HERE / 'source-privacy-qa.json').write_text(json.dumps(report, indent=2) + '\n')
    print('STORAGE_NATIVE_PRIVACY_ERRORS', report['errors'])
    if report['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
