"""Codex が納めた洋館の窓4点（PR #90）を、カタログに載せる。

    python3 tools/blender/rpg_mansion/integrate_windows.py

integrate_style_assets.py と同じ手順（何度流しても同じ結果になる）。寸法・部位は納品の台帳
（windows/reports/asset-ledger.json）から取る。**category を「窓」にする。** アプリはこの分類の物を、
窓の開口に差し込むモデルとして選ばせる（建具の「窓」の選択肢・壁・床・屋根の切り替え）。
"""
import json
import os

from integrate_style_assets import PACK, ROOT, quantize, sha

WIN = 'tools/blender/rpg_mansion/windows'
LABELS = {'paint': '枠・格子', 'metal': '金物'}
# 窓台(石)とガラスは色を変えない(部位を付けない)


def main():
    ledger = json.load(open(os.path.join(ROOT, WIN, 'reports/asset-ledger.json')))
    manifest_path = os.path.join(ROOT, PACK, 'manifest.json')
    doc = json.load(open(manifest_path))
    ids = [e['id'] for e in ledger]
    items = [i for i in doc['items'] if i['id'] not in ids]
    for e in ledger:
        mid = e['id']
        w, d, h = (int(round(v)) for v in e['dimensions_mm'])
        channels = []
        for mat in e['materials'].values():
            key = mat.get('finishChannel')
            if key in LABELS and not any(c['key'] == key for c in channels):
                channels.append({'key': key, 'label': LABELS[key], 'default': mat['color']})
        entry = {'id': mid, 'name': e['name'], 'group': '家具', 'category': '窓',
                 'model': f'{PACK}/models/{mid}.glb', 'thumb': f'{PACK}/previews/{mid}-thumb.png',
                 'top': f'{PACK}/previews/{mid}-top.png', 'w': w, 'd': d, 'h': h,
                 'provenance': 'original', 'finishChannels': sorted(channels, key=lambda c: c['key'])}
        items.append(entry)
        quantize(entry['thumb'])
        quantize(entry['top'])
    with open(manifest_path, 'w') as f:
        f.write('{"set":"rpg-mansion","name":"洋館","note":' + json.dumps(doc['note'], ensure_ascii=False) + ',"items":[\n')
        f.write(',\n'.join(json.dumps(i, ensure_ascii=False, separators=(',', ':')) for i in items))
        f.write('\n]}\n')

    src_path = os.path.join(ROOT, 'tools/blender/rpg_mansion/catalogue-sources.json')
    sources = json.load(open(src_path))
    shipped_path = os.path.join(ROOT, 'tools/tests/fixtures/asset-sets/shipped.json')
    shipped = json.load(open(shipped_path))
    for mid in ids:
        model = f'{PACK}/models/{mid}.glb'
        sources['items'][mid] = {'sourceBlend': f'{WIN}/sources/{mid}.blend',
                                 'validation': f'{WIN}/sources/{mid}-validation.json',
                                 'builder': f'{WIN}/build.py', 'glbSha256': sha(model)}
        shipped['items'][mid] = {'model': model, 'sha256': sha(model)}
    for path, data in ((src_path, sources), (shipped_path, shipped)):
        with open(path, 'w') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write('\n')
    print(f'manifest: {len(items)} 点')


if __name__ == '__main__':
    main()
