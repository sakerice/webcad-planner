"""Content-version local JS/CSS references so HTML cannot reuse older implementations."""
import hashlib
import re
import sys
from pathlib import Path

page = Path(sys.argv[1] if len(sys.argv) > 1 else 'index.html')
# Match attributes, including the final quote, without touching inline JavaScript.
pattern = re.compile(r'((?:src|href)=")((?:assets/)[^"?]+\.(?:js|css))(?:\?[^" ]*)?(")')
def version(match):
    asset = page.parent / match[2]
    if not asset.is_file():
        raise FileNotFoundError(asset)
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
    return f'{match[1]}{match[2]}?v={digest}{match[3]}'
page.write_text(pattern.sub(version, page.read_text()))
