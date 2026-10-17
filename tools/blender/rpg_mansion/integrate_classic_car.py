"""Codex が納めた洋館用のクラシックセダン（PR #89）を、カタログに載せる。

    python3 tools/blender/rpg_mansion/integrate_classic_car.py

integrate_style_assets.py と同じ手順（何度流しても同じ結果になる）。寸法・部位は納品の記録
（classic_car/asset-record.json）から取る。庭・外構の「車」に並べ、地面に置く（groundLevel）。
標準の自動車と同じく、長さが奥行(d)の向き・正面 +Z なので、家具の差し替えで向きを変えずに替えられる。
"""
import json
import os

from integrate_style_assets import PACK, ROOT, quantize, sha

CAR = 'tools/blender/rpg_mansion/classic_car'
MID = 'rpg-mansion-classic-sedan-01'


def main():
    rec = json.load(open(os.path.join(ROOT, CAR, 'asset-record.json')))
    w, d, h = (int(round(v)) for v in rec['actualMeasuredDimensionsMm'])
    entry = {'id': MID, 'name': 'クラシックセダン', 'group': '外構', 'category': '車',
             'model': rec['model'], 'thumb': rec['thumb'], 'top': rec['top'],
             'w': w, 'd': d, 'h': h, 'groundLevel': True, 'provenance': 'original',
             'finishChannels': rec['finishChannels']}
    manifest_path = os.path.join(ROOT, PACK, 'manifest.json')
    doc = json.load(open(manifest_path))
    items = [i for i in doc['items'] if i['id'] != MID] + [entry]
    quantize(entry['thumb'])
    quantize(entry['top'])
    with open(manifest_path, 'w') as f:
        f.write('{"set":"rpg-mansion","name":"洋館","note":' + json.dumps(doc['note'], ensure_ascii=False) + ',"items":[\n')
        f.write(',\n'.join(json.dumps(i, ensure_ascii=False, separators=(',', ':')) for i in items))
        f.write('\n]}\n')

    src_path = os.path.join(ROOT, 'tools/blender/rpg_mansion/catalogue-sources.json')
    sources = json.load(open(src_path))
    sources['items'][MID] = {'sourceBlend': rec['sourceBlend'], 'validation': rec['validation'],
                             'builder': rec['builder'], 'glbSha256': sha(entry['model'])}
    with open(src_path, 'w') as f:
        json.dump(sources, f, ensure_ascii=False, indent=1)
        f.write('\n')

    shipped_path = os.path.join(ROOT, 'tools/tests/fixtures/asset-sets/shipped.json')
    shipped = json.load(open(shipped_path))
    shipped['items'][MID] = {'model': entry['model'], 'sha256': sha(entry['model'])}
    with open(shipped_path, 'w') as f:
        json.dump(shipped, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'manifest: {len(items)} 点')


if __name__ == '__main__':
    main()
