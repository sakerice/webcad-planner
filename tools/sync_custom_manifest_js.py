#!/usr/bin/env python3
"""assets/models/custom/manifest.json から manifest.js を作り直す。

file:// で開いたときは fetch が使えないので、同じ内容を window へ直接置く
manifest.js を読む。JSON を触ったらこれを走らせて両者を必ず一致させること。
"""
import json

with open('assets/models/custom/manifest.json', encoding='utf-8') as f:
    m = json.load(f)
body = json.dumps(m, ensure_ascii=False, separators=(',', ':'))
with open('assets/models/custom/manifest.js', 'w', encoding='utf-8') as f:
    f.write('window.CUSTOM_MODEL_MANIFEST=%s;' % body)
print('synced %d items' % len(m['items']))
