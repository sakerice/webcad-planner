"""Codex が納めた洋館スタイルのモデル5点（PR #86）を、カタログに載せる。

    python3 tools/blender/rpg_mansion/integrate_style_assets.py

納品物は GLB と確認画像を発注どおりの場所に置いてあるが、manifest には載せていない
（組み込みは実装側の担当）。ここでは次を行う。何度流しても同じ結果になる。
- manifest に5点を足す（名前は日本語、分類は標準の kind、仕上げの色は部位ごとに1色）
- 確認画像を 256 色に減色する（他の273点と同じ。1枚 300KB → 数十KB）
- 制作の元（.blend・確認画像・検証の記録）の対応を catalogue-sources.json に足す
- 出荷済みの一覧（tools/tests/fixtures/asset-sets/shipped.json）に足す。本番に出たら差し替えない

額絵の「キャンバス」の部位は仕上げの色に出さない。絵そのものに色を掛けると絵が濁るだけで、
選ぶ意味が無い。
"""
import hashlib
import json
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PACK = 'assets/models/packs/rpg-mansion'
STYLE = 'tools/blender/rpg_mansion/style_assets'
LABELS = {'wood': '木部', 'metal': '金属', 'fabric': '布・革'}

# 納品の検証記録(models-validation-report.json)の寸法・部位から作る。名前と置く高さはここで決める
ITEMS = {
    'rpg-mansion-landscape-painting-1000-01': {
        'name': '金縁の横長の額絵 1000', 'group': '家具', 'category': '壁装飾', 'kind': 'wall-decor', 'defaultElevation': 1100},
    'rpg-mansion-landscape-painting-1400-01': {
        'name': '金縁の横長の額絵 1400', 'group': '家具', 'category': '壁装飾', 'kind': 'wall-decor', 'defaultElevation': 1000},
    'rpg-mansion-landscape-painting-1800-01': {
        'name': '金縁の横長の額絵 1800', 'group': '家具', 'category': '壁装飾', 'kind': 'wall-decor', 'defaultElevation': 900},
    'rpg-mansion-wicker-laundry-basket-01': {
        'name': '籐の洗濯カゴ', 'group': '住設', 'category': '洗濯', 'kind': 'laundry'},
    'rpg-mansion-lidded-laundry-box-01': {
        'name': '蓋付きの木製ランドリーボックス', 'group': '住設', 'category': '洗濯', 'kind': 'laundry'},
}


def sha(path):
    return hashlib.sha256(open(os.path.join(ROOT, path), 'rb').read()).hexdigest()


def quantize(path):
    full = os.path.join(ROOT, path)
    im = Image.open(full)
    if im.mode == 'P':
        return
    im.convert('RGBA').quantize(colors=256, method=Image.Quantize.FASTOCTREE,
                                dither=Image.Dither.FLOYDSTEINBERG).save(full, optimize=True)


def main():
    report = json.load(open(os.path.join(ROOT, STYLE, 'models-validation-report.json')))
    measured = {m['id']: m for m in report['models']}

    manifest_path = os.path.join(ROOT, PACK, 'manifest.json')
    doc = json.load(open(manifest_path))
    items = [i for i in doc['items'] if i['id'] not in ITEMS]
    for mid, spec in ITEMS.items():
        m = measured[mid]
        w, d, h = (int(round(v)) for v in m['measured_WDH_mm'])
        channels = []
        for mat in m['materials']:
            key = mat['finishChannel']
            if key in LABELS and not any(c['key'] == key for c in channels):
                channels.append({'key': key, 'label': LABELS[key], 'default': mat['default_sRGB']})
        entry = {'id': mid, 'name': spec['name'], 'group': spec['group'], 'category': spec['category'],
                 'kind': spec['kind'],
                 'model': f'{PACK}/models/{mid}.glb',
                 'thumb': f'{PACK}/previews/{mid}-thumb.png',
                 'top': f'{PACK}/previews/{mid}-top.png',
                 'w': w, 'd': d, 'h': h}
        if 'defaultElevation' in spec:
            entry['defaultElevation'] = spec['defaultElevation']
        entry['provenance'] = 'original'
        entry['finishChannels'] = sorted(channels, key=lambda c: c['key'])
        items.append(entry)
        quantize(entry['thumb'])
        quantize(entry['top'])

    with open(manifest_path, 'w') as f:
        f.write('{"set":"rpg-mansion","name":"洋館","note":' + json.dumps(doc['note'], ensure_ascii=False) + ',"items":[\n')
        f.write(',\n'.join(json.dumps(i, ensure_ascii=False, separators=(',', ':')) for i in items))
        f.write('\n]}\n')

    src_path = os.path.join(ROOT, 'tools/blender/rpg_mansion/catalogue-sources.json')
    sources = json.load(open(src_path))
    for mid in ITEMS:
        sources['items'][mid] = {
            'sourceBlend': f'{STYLE}/{mid}.blend',
            'validation': f'{STYLE}/models-validation-report.json',
            'front': f'{STYLE}/{mid}-front.jpg',
            'rear': f'{STYLE}/{mid}-back.jpg',
            'builder': f'{STYLE}/build_style_models.py',
            'glbSha256': sha(f'{PACK}/models/{mid}.glb'),
        }
    with open(src_path, 'w') as f:
        json.dump(sources, f, ensure_ascii=False, indent=1)
        f.write('\n')

    shipped_path = os.path.join(ROOT, 'tools/tests/fixtures/asset-sets/shipped.json')
    shipped = json.load(open(shipped_path))
    for mid in ITEMS:
        model = f'{PACK}/models/{mid}.glb'
        shipped['items'][mid] = {'model': model, 'sha256': sha(model)}
    with open(shipped_path, 'w') as f:
        json.dump(shipped, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'manifest: {len(items)} 点')


if __name__ == '__main__':
    main()
