"""既定間取りの「品質の粗」を数え上げる調査道具。

lint_plan.py は幾何の不良(重なり・貫通・到達性)を見る。こちらは
**作り込みの粗**を見る。どちらも通らないと出荷水準にならない。

  A. 代用ジオメトリ … 立方体や板で済ませている物(木・自転車・室外機など)
  B. モデルの実在  … カタログのモデルを使っているか、素の型で置いているか
  C. 素材の指定    … 部屋の床・壁にテクスチャが当たっているか
  D. 密度          … 部屋あたりの家具点数(空き部屋を見つける)

    python3 tools/audit_quality.py [プラン...]
"""
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 3Dが手続き生成の箱で描いている型。実物の形を持たない = 作り込みの余地。
# 値は「どのくらい目立つか」。high は近景に必ず入るもの。
PLACEHOLDER = {
    'custom-block': 'high',      # 任意ブロック(ポーチ・カウンター等)
    'tree': 'high',              # 樹木(円錐+円柱)
    'fence': 'mid',
    'lattice-screen': 'mid',
    'bicycle': 'high',
    'bicycle-fold': 'high',
    'ac-outdoor': 'high',
    'gas-heater': 'mid',
    'meter-box': 'low',
    'sewer-pit': 'low',
    'exterior-stair': 'mid',
    'utility-pole': 'mid',
    'washer': 'high',
    'balcony': 'mid',
}
MODEL_PREFIX = ('fmp-', 'im0261-')
# 部屋の役割ごとに「これが無いと生活が成立しない」物(型名の断片)
ESSENTIALS = {
    '浴室': ['BathTub'],
    '洗面脱衣室': ['WashBasin', 'washer'],
    'トイレ': ['Toilet'],
    'キッチン': ['CabinetD', 'GasStove'],
    'LDK': ['Sofa', 'Table'],
    'リビング': ['Sofa'],
    '主寝室': ['Bed'],
    '洋室': ['Bed'],
    '洋室A': ['Bed'],
    '洋室B': ['Bed'],
    '書斎': ['Table', 'Chair'],
}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def room_of(rooms, floor, cx, cy):
    for r in rooms:
        if r.get('floor', 1) != floor:
            continue
        if r['x'] <= cx <= r['x'] + r['w'] and r['y'] <= cy <= r['y'] + r['d']:
            return r
    return None


def audit(path):
    d = load(path)
    items, rooms = d['items'], d['rooms']
    print('══════ %s ══════' % os.path.basename(path))
    print('walls=%d rooms=%d items=%d' % (len(d['walls']), len(rooms), len(items)))

    # A. 代用ジオメトリ
    ph = [i for i in items if i['type'] in PLACEHOLDER]
    by_sev = defaultdict(list)
    for i in ph:
        by_sev[PLACEHOLDER[i['type']]].append(i['type'])
    print('\n■ A. 代用ジオメトリ(実物の形を持たない箱): %d件' % len(ph))
    for sev in ('high', 'mid', 'low'):
        if by_sev[sev]:
            c = Counter(by_sev[sev])
            print('   %-4s %s' % (sev, ', '.join('%s×%d' % kv for kv in c.most_common())))

    # B. モデルを使っている家具
    modeled = [i for i in items if i['type'].startswith(MODEL_PREFIX)]
    print('\n■ B. カタログのモデルを使う家具: %d件' % len(modeled))

    # C. 素材の指定
    no_tex = [r for r in rooms if not r.get('texture')]
    print('\n■ C. 床テクスチャ未指定の部屋: %d/%d' % (len(no_tex), len(rooms)))
    for r in no_tex[:8]:
        print('   %dF %s' % (r.get('floor', 1), r.get('n') or '(無名)'))

    # D. 部屋ごとの家具密度と、生活必需品の欠落
    # 部屋は同じ名前で複数の矩形に割れる(LDKやL字の部屋)。矩形ごとに数えると
    # 「家具の乗っていない側の矩形」を欠落と誤検出するので、階+名前で束ねる。
    per = defaultdict(list)
    for i in items:
        if not i['type'].startswith(MODEL_PREFIX) and i['type'] not in ('washer',):
            continue
        cx, cy = i['x'] + i['w'] / 2, i['y'] + i['d'] / 2
        r = room_of(rooms, i.get('floor', 1), cx, cy)
        if r:
            per[(r.get('floor', 1), (r.get('n') or '').strip())].append(i['type'])
    print('\n■ D. 部屋ごとの家具点数(モデル家具のみ)')
    empties, missing, seen = [], [], set()
    SKIP = ('階段', 'ホール', '廊下', '玄関', 'PS', 'バルコニー', '吹き抜け')
    for r in rooms:
        name = (r.get('n') or '').strip()
        key = (r.get('floor', 1), name)
        n = len(per.get(key, []))
        area = sum(o['w'] * o['d'] for o in rooms
                   if o.get('floor', 1) == r.get('floor', 1)
                   and (o.get('n') or '').strip() == name) / 1e6
        if name in SKIP or area < 2.0 or (r.get('floor', 1), name) in seen:
            continue
        seen.add((r.get('floor', 1), name))
        if n == 0:
            empties.append('%dF %s (%.1f㎡)' % (r.get('floor', 1), name, area))
        need = ESSENTIALS.get(name)
        if need:
            have = per.get(key, [])
            lack = [k for k in need if not any(k in t for t in have)]
            if lack:
                missing.append('%dF %s: %s が無い' % (r.get('floor', 1), name, '/'.join(lack)))
    print('   家具ゼロの居室: %d件' % len(empties))
    for e in empties:
        print('     ' + e)
    print('   生活必需品の欠落: %d件' % len(missing))
    for m in missing:
        print('     ' + m)
    print()


for p in (sys.argv[1:] or ['assets/default_plan.json', 'assets/default_plan_3f.json']):
    audit(p)
