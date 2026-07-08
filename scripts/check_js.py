#!/usr/bin/env python3
"""index.html のインライン <script> を連結して node --check に通す"""
import re, subprocess, sys, tempfile, os

html = open(os.path.join(os.path.dirname(__file__), '..', 'index.html'), encoding='utf-8').read()
# src= 付き(CDN)を除くインラインscriptを抽出
blocks = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)
if not blocks:
    print('No inline scripts found'); sys.exit(1)
src = '\n;\n'.join(blocks)
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
    f.write(src); path = f.name
try:
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
finally:
    os.unlink(path)
if r.returncode:
    print(r.stderr); sys.exit(1)
print('JS syntax OK (%d chars, %d blocks)' % (len(src), len(blocks)))
