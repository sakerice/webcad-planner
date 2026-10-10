"""Codex が納めた洋館の扉5点・ミステリー小物8点（PR #88）を、カタログに載せる。

    python3 tools/blender/rpg_mansion/integrate_doors_mystery.py

integrate_style_assets.py と同じ手順（何度流しても同じ結果になる）。
- manifest に13点を足す。寸法は納品の検証記録（validation.json）の実測、仕上げの既定の色は納品メモ
- 確認画像を 256 色に減色する
- 制作の元の対応を catalogue-sources.json に、出荷済みの一覧に足す

扉は **category を「ドア」** にする。アプリはこの分類の物を、開き戸・玄関ドアの扉板として選ばせる
（assets/js/app-constants.js の isOpeningDoorModel）。
"""
import json
import os

from integrate_style_assets import PACK, ROOT, quantize, sha

DOORS = 'tools/blender/rpg_mansion/doors'
MYSTERY = 'tools/blender/rpg_mansion/mystery_props'
WOOD, METAL = ('wood', '木部'), ('metal', '金属')

# (名前, 分類, 置く高さ, 仕上げ [(部位, 既定の色)])
ITEMS = {
    'rpg-mansion-door-six-panel-01': ('6枚パネルの室内ドア', 'ドア', None, [(WOOD, '#513523'), (METAL, '#b18b42')], DOORS),
    'rpg-mansion-door-glazed-01': ('格子ガラスの室内ドア', 'ドア', None, [(WOOD, '#eee7d9'), (METAL, '#b18b42')], DOORS),
    'rpg-mansion-door-ledged-01': ('板張りの納戸の扉', 'ドア', None, [(WOOD, '#796045'), (METAL, '#242829')], DOORS),
    'rpg-mansion-entrance-door-01': ('洋館の重厚な玄関ドア', 'ドア', None, [(WOOD, '#193e31'), (METAL, '#b18b42')], DOORS),
    'rpg-mansion-entrance-door-glazed-01': ('ステンドグラスの玄関ドア', 'ドア', None, [(WOOD, '#493422'), (METAL, '#b18b42')], DOORS),
    # 卓上の物は、既存の鍵・手紙と同じく机の高さ(750mm)に置く。床の跡・札は床
    'rpg-mansion-mystery-chalk-outline-01': ('人型のチョーク跡', '事件跡', None, [], MYSTERY),
    'rpg-mansion-mystery-evidence-marker-01': ('証拠番号札', '事件跡', None, [], MYSTERY),
    'rpg-mansion-mystery-fallen-wine-glass-01': ('倒れたワイングラスと破片', '事件跡', 750, [], MYSTERY),
    'rpg-mansion-mystery-knife-01': ('ナイフ', '探索小物', 750, [(WOOD, '#38271f'), (METAL, '#aeb5b9')], MYSTERY),
    'rpg-mansion-mystery-glass-ashtray-01': ('ガラスの灰皿', '探索小物', 750, [], MYSTERY),
    'rpg-mansion-mystery-ceramic-ashtray-01': ('陶器の灰皿', '探索小物', 750, [], MYSTERY),
    'rpg-mansion-mystery-pocket-watch-01': ('鎖付きの懐中時計', '探索小物', 750, [(METAL, '#b0924e')], MYSTERY),
    'rpg-mansion-mystery-corked-bottle-01': ('コルク栓の琥珀色の小瓶', '探索小物', 750, [], MYSTERY),
}


def main():
    measured = {}
    for d in (DOORS, MYSTERY):
        for m in json.load(open(os.path.join(ROOT, d, 'validation.json')))['models']:
            measured[m['id']] = m

    manifest_path = os.path.join(ROOT, PACK, 'manifest.json')
    doc = json.load(open(manifest_path))
    items = [i for i in doc['items'] if i['id'] not in ITEMS]
    for mid, (name, category, elev, channels, _) in ITEMS.items():
        w, d, h = (int(round(v)) for v in measured[mid]['dimensions_mm_W_D_H'])
        group = '事件・小道具' if category in ('事件跡', '探索小物') else '家具'
        entry = {'id': mid, 'name': name, 'group': group, 'category': category,
                 'model': f'{PACK}/models/{mid}.glb',
                 'thumb': f'{PACK}/previews/{mid}-thumb.png',
                 'top': f'{PACK}/previews/{mid}-top.png',
                 'w': w, 'd': d, 'h': h}
        if elev:
            entry['defaultElevation'] = elev
        entry['provenance'] = 'original'
        # 色を持たない物(ガラス・陶器・チョーク)も、空の配列を明示する(検査の決まり)
        entry['finishChannels'] = [{'key': k, 'label': label, 'default': c} for (k, label), c in channels]
        items.append(entry)
        quantize(entry['thumb'])
        quantize(entry['top'])

    with open(manifest_path, 'w') as f:
        f.write('{"set":"rpg-mansion","name":"洋館","note":' + json.dumps(doc['note'], ensure_ascii=False) + ',"items":[\n')
        f.write(',\n'.join(json.dumps(i, ensure_ascii=False, separators=(',', ':')) for i in items))
        f.write('\n]}\n')

    src_path = os.path.join(ROOT, 'tools/blender/rpg_mansion/catalogue-sources.json')
    sources = json.load(open(src_path))
    for mid, spec in ITEMS.items():
        base = spec[4]
        sources['items'][mid] = {
            'sourceBlend': f'{base}/sources/{mid}.blend',
            'validation': f'{base}/validation.json',
            'builder': f'{base}/build.py',
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
