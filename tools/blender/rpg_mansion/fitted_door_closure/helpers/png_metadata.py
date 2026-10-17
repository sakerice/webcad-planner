"""Remove non-rendering provenance chunks; retain every image-data byte and CRC."""
import struct
from pathlib import Path
PRIVATE_CHUNKS={b'tEXt',b'zTXt',b'iTXt',b'eXIf'}
def strip_metadata(path):
 path=Path(path)
 if not path.exists():return
 raw=path.read_bytes();assert raw[:8]==b'\x89PNG\r\n\x1a\n';out=bytearray(raw[:8]);offset=8
 while offset<len(raw):
  size=struct.unpack_from('>I',raw,offset)[0];end=offset+12+size;assert end<=len(raw)
  if raw[offset+4:offset+8] not in PRIVATE_CHUNKS:out.extend(raw[offset:end])
  offset=end
 assert offset==len(raw)
 if bytes(out)!=raw:path.write_bytes(out)
if __name__=='__main__':
 import sys
 for name in sys.argv[1:]:strip_metadata(name)
