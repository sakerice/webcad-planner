#!/usr/bin/env python3
"""lint の各チェックが**実際に発火するか**を確かめる。

なぜ要るか: check34(玄関からの見通し)を足したとき、玄関ドアの rot の解釈を
取り違えて常に屋外へ光線を飛ばしていた。何を入れても0件を返す**死んだ検査**
だったのに、0件を「合格」として報告してしまった。

検査を足したら、**違反する形を作って発火することを見る**まで信用しない。
ここでは凍結フィクスチャに意図的な不良を入れ、対応するチェックの件数が
増えることを確かめる。

    python3 tools/tests/lint_selftest.py
"""
import copy
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location(
    'lp', os.path.join(ROOT, 'tools', 'lint_plan.py'))
lp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lp)

BASE = json.load(open(os.path.join(HERE, 'fixtures', 'house-2f.json'), encoding='utf-8'))


def run(name, data):
    for label, fn in lp.CHECKS:
        if label.startswith(name + '.'):
            return fn(data)
    raise SystemExit('チェック %s が見つからない' % name)


def fires_more(num, breaker):
    """件数が増えたか。増えない検査(1件しか出ない種類)は中身の変化を見る。"""
    before = run(num, clone())
    after = run(num, breaker(clone()))
    if len(after) > len(before):
        return True, len(before), len(after)
    # 件数が同じでも、指摘の中身が変わっていれば発火している
    return (sorted(after) != sorted(before) and len(after) > 0), len(before), len(after)


def clone():
    return copy.deepcopy(BASE)


# ── 不良の作り方。返り値は「壊したプラン」 ──────────────────────────
def break_34(d):
    """玄関ドアの真正面にある壁を消して、LDKまで見通せるようにする。"""
    door = next(i for i in d['items'] if i['type'] == 'door-front')
    cx, cy = door['x'] + door['w'] / 2, door['y'] + door['d'] / 2
    # 玄関の北側にある壁を全部外し、部屋を1つ LDK に改名して露出させる
    d['walls'] = [w for w in d['walls']
                  if not (w['floor'] == 1 and abs(w['y1'] - w['y2']) < 1
                          and w['y1'] < cy and min(w['x1'], w['x2']) <= cx <= max(w['x1'], w['x2']))]
    return d


def break_35(d):
    """2階のトイレを、1階のリビングの真上へ動かす。"""
    liv = next(r for r in d['rooms']
               if r['floor'] == 1 and 'リビング' in (r.get('n') or ''))
    wc = next(r for r in d['rooms']
              if r['floor'] == 2 and 'トイレ' in (r.get('n') or ''))
    wc['x'], wc['y'] = liv['x'], liv['y']
    return d


def break_36(d):
    """冷蔵庫をシンクの真横に寄せて、三辺合計を縮める。"""
    sink = next(i for i in d['items'] if 'CabinetD_Sink' in i['type'])
    fr = next(i for i in d['items'] if 'Refrigerator' in i['type'])
    fr['x'], fr['y'] = sink['x'] + 300, sink['y']
    return d


def break_37(d):
    """主寝室の窓を全部消す。"""
    room = next(r for r in d['rooms']
                if r['floor'] == 2 and (r.get('n') or '').strip() == '主寝室')
    keep = []
    for i in d['items']:
        if i['type'] in ('window', 'window-door') and i.get('floor') == 2:
            cx, cy = i['x'] + i['w'] / 2, i['y'] + i['d'] / 2
            if (room['x'] - 200 <= cx <= room['x'] + room['w'] + 200
                    and room['y'] - 200 <= cy <= room['y'] + room['d'] + 200):
                continue
        keep.append(i)
    d['items'] = keep
    return d


def break_38(d):
    """干し場(バルコニー・ランドリー)を全部消す。"""
    d['items'] = [i for i in d['items'] if i['type'] != 'balcony']
    for r in d['rooms']:
        if 'ランドリー' in (r.get('n') or ''):
            r['n'] = '納戸'
    return d


def break_30(d):
    """ソファを180度回す。check39(相手への向き)が拾うべき形。"""
    sofa = next(i for i in d['items'] if 'Sofa' in i['type'])
    sofa['rot'] = ((sofa.get('rot') or 0) + 180) % 360
    return d


def break_30_wall(d):
    """洗面台を180度回して、すぐ後ろの壁に正面を向けさせる。"""
    v = next(i for i in d['items'] if 'BathroomVanity' in i['type'])
    v['rot'] = ((v.get('rot') or 0) + 180) % 360
    return d


def break_33(d):
    """照明を天井から300mm下げる。"""
    for i in d['items']:
        if i['type'].startswith('light-'):
            i['elev'] = (i.get('elev') or 0) - 300
    return d


def _clone_furniture(d):
    """フィクスチャの中から、大きめの家具を1つ複製して返す(位置は呼び側で決める)。"""
    best = None
    for i in d['items']:
        if not lp.is_furniture(i):
            continue
        if (i.get('elev') or 0) >= 500:
            continue
        if best is None or i['w'] * i['d'] > best['w'] * best['d']:
            best = i
    c = copy.deepcopy(best)
    c['id'] = max((x.get('id') or 0) for x in d['items']) + 1
    d['items'].append(c)
    return c


def break_40(d):
    """窓の見付けの真ん中に、腰高から立ち上がる大きな家具を置く。"""
    wn = next(w for w in d['items']
              if w['type'] == 'window' and (w.get('windowSill') or 0) > 300)
    cx, cy = lp.center(wn)
    (ux, uy), (vx, vy) = lp.axes(wn)
    floor = wn.get('floor', 1)
    # 部屋がある側へ200mmずらして置く
    sign = 1 if lp.room_at(d, floor, cx + vx * 500, cy + vy * 500) else -1
    c = _clone_furniture(d)
    c['floor'] = floor
    c['rot'] = wn.get('rot', 0)
    c['elev'] = wn.get('windowSill') or 0
    c['w'], c['d'] = wn['w'], 300
    c['x'] = cx + vx * sign * 200 - c['w'] / 2.0
    c['y'] = cy + vy * sign * 200 - c['d'] / 2.0
    return d


def break_41(d):
    """窓のスパンの真ん中に、直交する壁を突き刺す。"""
    wn = next(w for w in d['items'] if w['type'] == 'window')
    cx, cy = lp.center(wn)
    (ux, uy), (vx, vy) = lp.axes(wn)
    d['walls'].append({
        'id': max(w.get('id', 0) for w in d['walls']) + 1,
        'x1': cx, 'y1': cy, 'x2': cx + vx * 2000, 'y2': cy + vy * 2000,
        'thick': 120, 'floor': wn.get('floor', 1), 'color': '#888888'})
    return d


def break_42(d):
    """玄関ドアの正面に、幅いっぱいの家具を立てる。"""
    door = next(i for i in d['items'] if i['type'] == 'door-front')
    cx, cy = lp.center(door)
    (ux, uy), (vx, vy) = lp.axes(door)
    floor = door.get('floor', 1)
    sign = 1 if lp.room_at(d, floor, cx + vx * 500, cy + vy * 500) else -1
    c = _clone_furniture(d)
    c['floor'] = floor
    c['rot'] = door.get('rot', 0)
    c['elev'] = 0
    c['w'], c['d'] = door['w'] + 200, 400
    c['x'] = cx + vx * sign * 400 - c['w'] / 2.0
    c['y'] = cy + vy * sign * 400 - c['d'] / 2.0
    return d


def break_43(d):
    """いちばん広い開口の正面を、幅いっぱいの家具で塞ぐ。"""
    op = max((i for i in d['items'] if i['type'] == 'door-opening'),
             key=lambda i: i['w'])
    cx, cy = lp.center(op)
    (ux, uy), (vx, vy) = lp.axes(op)
    floor = op.get('floor', 1)
    sign = 1 if lp.room_at(d, floor, cx + vx * 700, cy + vy * 700) else -1
    c = _clone_furniture(d)
    c['floor'] = floor
    c['rot'] = op.get('rot', 0)
    c['elev'] = 0
    # 開口の面に接した物は「開口の一部(対面カウンター)」として除外されるので、
    # 少し離して置く
    c['w'], c['d'] = op['w'], 500
    c['x'] = cx + vx * sign * 600 - c['w'] / 2.0
    c['y'] = cy + vy * sign * 600 - c['d'] / 2.0
    return d


CASES = [
    ('34', break_34, '玄関から居室が見通せる'),
    ('35', break_35, 'トイレの直下が居室'),
    ('36', break_36, 'ワークトライアングルが短い'),
    ('37', break_37, '居室に窓が無い'),
    ('38', break_38, '干す場所が無い'),
    ('30', break_30_wall, '家具の正面が壁'),
    ('39', break_30, '家具が相手に背を向けている'),
    ('33', break_33, '照明が天井から浮いている'),
    ('40', break_40, '窓の見付けを家具が塞ぐ'),
    ('41', break_41, '窓を壁が横切る'),
    ('42', break_42, '玄関ドアの正面が塞がれる'),
    ('43', break_43, '広い開口の正面が塞がれる'),
]

fail = 0
print('lint 自己検査: 壊したプランで各チェックが発火するか\n')
for num, breaker, why in CASES:
    ok, before, after = fires_more(num, breaker)
    print('  %s check%-3s %-28s 元%d件 → 壊した後%d件'
          % ('OK ' if ok else '★NG', num, why, before, after))
    if not ok:
        fail += 1
        print('       ↑ 発火しない。この検査は死んでいる可能性がある')

print()
if fail:
    print('★ %d件のチェックが発火しなかった' % fail)
    sys.exit(1)
print('全チェックが発火した')
