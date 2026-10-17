"""Inspect every delivered Blender source after gzip/zstd decompression."""
import gzip
import hashlib
import io
import json
import re
from pathlib import Path

import zstandard

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRIVATE = re.compile(rb'(?:/(?:workspace|home|root|tmp|mnt|Users)/|(?:^|\x00)[A-Za-z]:[\\/][A-Za-z0-9_])')

reports = []
for item in json.loads((HERE / 'descriptors.json').read_text()):
    for field in ['sourceBlend', 'authoringBlend']:
        path = ROOT / item[field]
        raw = path.read_bytes()
        if raw.startswith(b'\x28\xb5\x2f\xfd'):
            with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw)) as stream:
                expanded = stream.read()
            compression = 'zstd'
        elif raw.startswith(b'\x1f\x8b'):
            expanded = gzip.decompress(raw)
            compression = 'gzip'
        else:
            expanded = raw
            compression = 'none'
        assert expanded.startswith(b'BLENDER'), 'Invalid decompressed Blender source'
        matches = PRIVATE.findall(expanded)
        reports.append({'id': item['id'], 'field': field, 'path': item[field],
                        'bytes': len(raw), 'decompressedBytes': len(expanded),
                        'compression': compression,
                        'sha256': hashlib.sha256(raw).hexdigest(),
                        'privateAbsolutePathMatches': len(matches)})

errors = [row['id'] + ': ' + row['field'] + ' retains a private absolute path'
          for row in reports if row['privateAbsolutePathMatches']]
result = {'sourceCount': len(reports), 'allCompressed': all(row['compression'] != 'none' for row in reports),
          'items': reports, 'errors': errors}
(HERE / 'saved-source-privacy-qa.json').write_text(json.dumps(result, indent=2) + '\n')
print('SAVED_SOURCE_PRIVACY_ERRORS', len(errors), 'SOURCES', len(reports))
assert result['allCompressed'], 'Every source must be compressed'
assert not errors, errors
