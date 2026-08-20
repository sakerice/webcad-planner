"""既定間取りの「品質の粗」を数え上げる調査道具。

lint_plan.py は幾何の不良(重なり・貫通・到達性)を見る。こちらは
**作り込みの粗**を見る。どちらも通らないと出荷水準にならない。

  A. 代用ジオメトリ … 専用の形もモデルも無く、素の箱で描かれている物
  B. モデルの実在  … カタログのモデルを使っているか、素の型で置いているか
  C. 素材の指定    … 部屋の床・壁にテクスチャが当たっているか
  D. 密度          … 部屋あたりの家具点数(空き部屋を見つける)

    python3 tools/audit_quality.py [プラン...]
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 「素の箱で描いている型」は手書きの表にしない。表は必ず古くなり、
# 実際には GLB を読んでいる物(自転車・洗濯機)や専用ジオメトリを持つ物
# (室外機・樹木・道路・電柱)まで粗として数えてしまう。index.html を読む。
#
#   モデルあり  … その型を分岐に持つ行に .glb / _GLB がある
#   専用形あり  … その型を分岐に持つ行に build3D... の呼び出しがある
#   それ以外    … 素の箱
_HTML_CACHE = {}


def _index_html():
    if 'src' not in _HTML_CACHE:
        with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
            _HTML_CACHE['src'] = f.read()
    return _HTML_CACHE['src']


_BUILDER_RE = re.compile(r'\bbuild[A-Za-z0-9_]*3D[A-Za-z0-9_]*\s*\(|\.glb|_GLB\b')


def has_real_geometry(t):
    """3Dの分岐が、この型専用の組み立て関数かモデルを呼んでいるか。

    呼んでいなければ箱(_B)の並びで描いている = 作り込みの余地がある。
    """
    if 'geo' not in _HTML_CACHE:
        _HTML_CACHE['geo'] = {}
    if t in _HTML_CACHE['geo']:
        return _HTML_CACHE['geo'][t]
    src = _index_html()
    ok = False
    # 汎用のモデル表から読む型(洗濯機・冷蔵庫など)は3Dに分岐を持たない
    if re.search(r"'%s'\s*:\s*'assets/models/[^']*\.glb'" % re.escape(t), src):
        ok = True
    # 3Dの分岐だけを見る。寸法表・色表・ツールバーの行は根拠にしない
    branch = re.compile(r"it\.type\s*===\s*'%s'" % re.escape(t))
    for m in branch.finditer(src):
        if ok:
            break
        window = src[m.end():m.end() + 900]
        if _BUILDER_RE.search(window):
            ok = True
        # テクスチャを貼った複数部材の組み立て(塀=パネル+笠木)も作り込み
        elif ('makeItemTextureMaterial' in window
              and len(re.findall(r'\b_(?:B|CY)\(', window)) >= 2):
            ok = True
    _HTML_CACHE['geo'][t] = ok
    return ok


# 素の箱で描かれていたときの目立ちやすさ。high は近景に必ず入るもの
SEVERITY = {
    'custom-block': 'high', 'tree': 'high', 'bicycle': 'high',
    'bicycle-fold': 'high', 'ac-outdoor': 'high', 'washer': 'high',
    'fence': 'mid', 'lattice-screen': 'mid', 'gas-heater': 'mid',
    'exterior-stair': 'mid', 'utility-pole': 'mid', 'balcony': 'mid',
    'meter-box': 'low', 'sewer-pit': 'low',
}


class _Placeholder(object):
    """`t in PLACEHOLDER` / `PLACEHOLDER[t]` の形をそのまま保つ薄い包み。"""

    def __contains__(self, t):
        return t in SEVERITY and not has_real_geometry(t)

    @staticmethod
    def counts(it):
        """この個体を粗として数えるか。"""
        t = it.get('type', '')
        if t not in PLACEHOLDER:
            return False
        # custom-block は箱そのものが仕事。土間・敷き物(高さ500mm以下)と、
        # テクスチャを当てた造作(カウンター等)は仕上がっているとみなす
        if t == 'custom-block' and ((it.get('customHeight') or 900) <= 500
                                    or it.get('texture')):
            return False
        return True

    def __getitem__(self, t):
        return SEVERITY.get(t, 'mid')


PLACEHOLDER = _Placeholder()
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
    # 居室は「寝る」以外の設えでもよい。1階の洋室はリビング続きの遊び場
    # (将来の寝室)として設えてあり、ベッドが無いのは欠落ではない
    '洋室': [['Bed'], ['Kid'], ['Table', 'Chair']],
    '洋室A': [['Bed'], ['Kid'], ['Table', 'Chair']],
    '洋室B': [['Bed'], ['Kid'], ['Table', 'Chair']],
    '書斎': ['Table', 'Chair'],
}


def lacking(need, have):
    """欠けている物。need が入れ子なら「どれか1組を満たせばよい」。"""
    if need and isinstance(need[0], list):
        best = None
        for alt in need:
            lack = [k for k in alt if not any(k in t for t in have)]
            if not lack:
                return []
            if best is None or len(lack) < len(best):
                best = lack
        return best or []
    return [k for k in need if not any(k in t for t in have)]


_LINT = {}


def _lint():
    """lint_plan を読み込む(部屋のつながりの判定を共有する)。"""
    if 'm' not in _LINT:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'lp', os.path.join(ROOT, 'tools', 'lint_plan.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _LINT['m'] = m
    return _LINT['m']


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
    ph = [i for i in items if PLACEHOLDER.counts(i)]
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
            # 壁で仕切られていない隣室(LDK↔リビング等)は同じ空間として数える
            same = [o for o in rooms if o.get('floor', 1) == r.get('floor', 1)
                    and (o.get('n') or '').strip() == name]
            space = _lint()._open_space(d, r.get('floor', 1), same)
            have = []
            for o in space:
                have += per.get((o.get('floor', 1), (o.get('n') or '').strip()), [])
            lack = lacking(need, have)
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
