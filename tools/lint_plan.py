#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""住宅間取りJSON（assets/default_plan.json 形式）の見栄え・整合性リント。

usage: python3 tools/lint_plan.py [plan.json]
  引数省略時は assets/default_plan.json（リポジトリルート基準）を読む。

座標系: 単位mm、+xが東、+yが南。x,y,w,d は回転前AABB（x,yは北西角）、
rot は中心まわり時計回り度。

チェック項目:
  1. 建具（ドア・窓）が同一階の壁線分上に乗っているか
  2. 開き戸の開閉スペース（壁の両側とも家具で塞がれていないか）
  3. 家具同士のAABB重なり
  4. 家具の壁へのめり込み（80mm超）
  5. 掃き出し窓（window-door / windowSill==0 の window）の室内側1000mmの家具
  6. 同一階の部屋同士の重なり
  7. アイテムの敷地（site-rect群）外へのはみ出し
  8. 階段（stair/stair-corner）の隣接連続性と stairOrder の連番
  9. 照明の elev が天井高（既定 1F:2700 / 2F以上:2520）を超えていないか

出力: 「[階] 種別 id: 説明」形式の違反リストと件数サマリ。違反0なら "OK"。
終了コードは常に0。標準ライブラリのみ使用。
"""

import json
import math
import os
import sys

# ---------------------------------------------------------------- 型分類

DOOR_TYPES = {
    'door-swing', 'door-swing-s', 'door-slide', 'door-slide-s', 'door-pocket',
    'door-fold', 'door-fold-w', 'door-front', 'door-opening',
    'door-opening-arch', 'window', 'window-door',
}
SWING_DOOR_TYPES = {'door-swing', 'door-swing-s', 'door-front'}
ANNOTATION_TYPES = {'memo', 'ruler', 'walk-route'}

# 敷地・構造・外構系（「家具」から除外する型）
STRUCT_SITE_TYPES = {
    'site-rect', 'foundation', 'roof', 'balcony', 'road', 'utility-pole',
    'exterior-stair', 'ramp', 'stair', 'stair-corner',
    'fence', 'wood-fence', 'lattice-screen', 'tree', 'grass', 'stone',
    'car', 'bicycle', 'bicycle-fold',
    'ac-outdoor', 'water-heater', 'gas-heater', 'meter-box', 'sewer-pit',
    'downspout', 'wall', 'room',
}

# 敷地内チェック(7)の除外型（周辺環境と注記）
SITE_CHECK_EXCLUDE = {'road', 'utility-pole'} | ANNOTATION_TYPES


def is_light(t):
    return t.startswith('light-')


def is_neighbor(t):
    return t.startswith('neighbor-')


def is_furniture(it):
    """建具・照明・注記・敷地/構造/外構系 以外を「家具」とみなす。"""
    t = it.get('type', '')
    if t in DOOR_TYPES or t in ANNOTATION_TYPES or t in STRUCT_SITE_TYPES:
        return False
    if is_light(t) or is_neighbor(t):
        return False
    # 高さ100mm以下の custom-block は床仕上げ(アプローチ・目地ライン等)扱い
    if t == 'custom-block' and (it.get('customHeight') or 900) <= 100:
        return False
    # カーテンは窓に付く物、カーペットは床仕上げ。重なり・窓前チェックの対象外
    if '-Curtain-' in t or '-Carpet-' in t:
        return False
    return True


# ---------------------------------------------------------------- 幾何ヘルパ

def center(it):
    return (it['x'] + it['w'] / 2.0, it['y'] + it['d'] / 2.0)


def axes(it):
    """回転後のローカルX軸(開口方向)とローカルY軸(奥行方向)の単位ベクトル。"""
    th = math.radians(it.get('rot', 0) or 0)
    return (math.cos(th), math.sin(th)), (-math.sin(th), math.cos(th))


def aabb(it):
    """回転を考慮した外接AABB (minx, miny, maxx, maxy)。90度単位は厳密。"""
    w, d = it['w'], it['d']
    cx, cy = center(it)
    th = math.radians(it.get('rot', 0) or 0)
    hw = (abs(w * math.cos(th)) + abs(d * math.sin(th))) / 2.0
    hd = (abs(w * math.sin(th)) + abs(d * math.cos(th))) / 2.0
    return (cx - hw, cy - hd, cx + hw, cy + hd)


def rect_overlap(a, b):
    """2つのAABBの重なり (ox, oy)。重なっていなければ (0,0) 以下。"""
    ox = min(a[2], b[2]) - max(a[0], b[0])
    oy = min(a[3], b[3]) - max(a[1], b[1])
    return ox, oy


def rects_intersect(a, b, min_dim):
    ox, oy = rect_overlap(a, b)
    return ox > min_dim and oy > min_dim


def seg_point_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def obb_corners(it):
    """回転を考慮した4隅座標。"""
    w, d = it['w'], it['d']
    cx, cy = center(it)
    (ux, uy), (vx, vy) = axes(it)
    hw, hd = w / 2.0, d / 2.0
    return [
        (cx + sx * ux * hw + sy * vx * hd, cy + sx * uy * hw + sy * vy * hd)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ]


def sat_penetration(corners_a, corners_b, axes_list):
    """SATによる貫入深さ。分離していれば0。"""
    pen = float('inf')
    for ax, ay in axes_list:
        pa = [c[0] * ax + c[1] * ay for c in corners_a]
        pb = [c[0] * ax + c[1] * ay for c in corners_b]
        overlap = min(max(pa), max(pb)) - max(min(pa), min(pb))
        if overlap <= 0:
            return 0.0
        pen = min(pen, overlap)
    return pen


def wall_corners(wl):
    """壁線分を太さ付き矩形にした4隅と (軸方向, 法線方向)。長さ0はNone。"""
    x1, y1, x2, y2 = wl['x1'], wl['y1'], wl['x2'], wl['y2']
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return None
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    nx, ny = -uy, ux
    ht = (wl.get('thick', 120) or 120) / 2.0
    cs = [
        (x1 + nx * ht, y1 + ny * ht), (x2 + nx * ht, y2 + ny * ht),
        (x2 - nx * ht, y2 - ny * ht), (x1 - nx * ht, y1 - ny * ht),
    ]
    return cs, (ux, uy), (nx, ny)


def subtract_rect(rect, cutter):
    """rect から cutter を引いた残り矩形のリスト（軸平行）。"""
    ax1, ay1, ax2, ay2 = rect
    bx1, by1, bx2, by2 = cutter
    if bx2 <= ax1 or bx1 >= ax2 or by2 <= ay1 or by1 >= ay2:
        return [rect]
    out = []
    if by1 > ay1:
        out.append((ax1, ay1, ax2, by1))          # 北側の残り
    if by2 < ay2:
        out.append((ax1, by2, ax2, ay2))          # 南側の残り
    my1, my2 = max(ay1, by1), min(ay2, by2)
    if bx1 > ax1:
        out.append((ax1, my1, bx1, my2))          # 西側の残り
    if bx2 < ax2:
        out.append((bx2, my1, ax2, my2))          # 東側の残り
    return out


# ---------------------------------------------------------------- 表示ヘルパ

def fl(obj):
    return '%sF' % obj.get('floor', 1)


def label(it):
    """アイテムの表示名: 種別 id (名前があれば付記)。"""
    name = it.get('name') or it.get('n')
    base = '%s %s' % (it.get('type', it.get('n', '?')), it.get('id', '?'))
    if name:
        base += '(%s)' % name
    return base


def vio(lines, obj, msg):
    lines.append('[%s] %s: %s' % (fl(obj), label(obj), msg))


# ---------------------------------------------------------------- 各チェック

def check1_doors_on_walls(data):
    """建具中心が壁線分から thick/2+40mm 以内、かつ開口スパンが壁線分内。"""
    out = []
    walls_by_floor = {}
    for wl in data['walls']:
        walls_by_floor.setdefault(wl.get('floor', 1), []).append(wl)
    for it in data['items']:
        if it['type'] not in DOOR_TYPES:
            continue
        cx, cy = center(it)
        (ux, uy), _ = axes(it)
        half = it['w'] / 2.0  # 開口はローカルX方向
        p1 = (cx - ux * half, cy - uy * half)
        p2 = (cx + ux * half, cy + uy * half)
        best = None  # (中心距離, 壁) 診断用
        ok = False
        for wl in walls_by_floor.get(it.get('floor', 1), []):
            x1, y1, x2, y2 = wl['x1'], wl['y1'], wl['x2'], wl['y2']
            seg_len = math.hypot(x2 - x1, y2 - y1)
            if seg_len == 0:
                continue
            tol = (wl.get('thick', 120) or 120) / 2.0 + 40.0
            dist = seg_point_dist(cx, cy, x1, y1, x2, y2)
            if best is None or dist < best[0]:
                best = (dist, wl)
            if dist > tol:
                continue
            # スパンが壁線分の範囲内か（端点の線分方向への射影で判定）
            wux, wuy = (x2 - x1) / seg_len, (y2 - y1) / seg_len
            t1 = (p1[0] - x1) * wux + (p1[1] - y1) * wuy
            t2 = (p2[0] - x1) * wux + (p2[1] - y1) * wuy
            span_tol = 10.0
            if min(t1, t2) < -span_tol or max(t1, t2) > seg_len + span_tol:
                continue
            # 端点が壁線から横に離れていないか（壁と平行に乗っている確認）
            d1 = seg_point_dist(p1[0], p1[1], x1, y1, x2, y2)
            d2 = seg_point_dist(p2[0], p2[1], x1, y1, x2, y2)
            if d1 > tol or d2 > tol:
                continue
            ok = True
            break
        if not ok:
            if best is None:
                vio(out, it, '同一階に壁が1本もない')
            else:
                dist, wl = best
                tol = (wl.get('thick', 120) or 120) / 2.0 + 40.0
                if dist > tol:
                    vio(out, it, '壁線上に乗っていない'
                        '（最寄り壁 id=%s まで中心距離 %.0fmm > 許容 %.0fmm）'
                        % (wl.get('id', '?'), dist, tol))
                else:
                    vio(out, it, '開口スパン（幅 %.0fmm）が壁 id=%s の線分範囲に'
                        '収まっていない' % (it['w'], wl.get('id', '?')))
    return out


def check2_swing_clearance(data):
    """開き戸の両側（開口幅wの正方形）が家具で塞がれていないか。"""
    out = []
    furn = [f for f in data['items'] if is_furniture(f)]
    for it in data['items']:
        if it['type'] not in SWING_DOOR_TYPES:
            continue
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        w = it['w']
        floor = it.get('floor', 1)
        blockers = []  # 各側のブロッカー一覧
        for sign in (1, -1):
            # 壁線（=建具中心線）から片側に w だけ延びる、一辺 w の正方形
            sq_cx = cx + sign * vx * w / 2.0
            sq_cy = cy + sign * vy * w / 2.0
            sq = {'x': sq_cx - w / 2.0, 'y': sq_cy - w / 2.0,
                  'w': w, 'd': w, 'rot': it.get('rot', 0)}
            sq_box = aabb(sq)
            hits = [f for f in furn
                    if f.get('floor', 1) == floor
                    and rects_intersect(aabb(f), sq_box, 20.0)]
            blockers.append(hits)
        if blockers[0] and blockers[1]:
            names = sorted({label(f) for f in blockers[0] + blockers[1]})
            vio(out, it, '開閉スペース（%.0fmm角）が壁の両側とも家具で塞がれて'
                'いる: %s' % (it['w'], ', '.join(names)))
    return out


def check3_furniture_overlap(data):
    """家具同士のAABB重なり。elev差500mm以上・高所設置(elev500mm以上)は除外。"""
    out = []
    furn = [f for f in data['items'] if is_furniture(f)]
    for i in range(len(furn)):
        for j in range(i + 1, len(furn)):
            a, b = furn[i], furn[j]
            if a.get('floor', 1) != b.get('floor', 1):
                continue
            ea, eb = a.get('elev', 0) or 0, b.get('elev', 0) or 0
            if abs(ea - eb) >= 500 or max(ea, eb) >= 500:
                continue  # 高さ違い・壁掛け等の意図的な組合せ
            ox, oy = rect_overlap(aabb(a), aabb(b))
            if ox > 10.0 and oy > 10.0:
                out.append('[%s] %s と %s: AABBが重なっている'
                           '（約 %.0f×%.0fmm）'
                           % (fl(a), label(a), label(b), ox, oy))
    return out


def check4_furniture_in_wall(data):
    """家具の壁（太さ付き矩形）へのめり込みが80mm超でないか。"""
    out = []
    for it in data['items']:
        if not is_furniture(it):
            continue
        if (it.get('elev', 0) or 0) >= 500:
            continue  # 壁掛け・天井付近設置（レンジフード等）は壁と重なって良い
        fc = obb_corners(it)
        fu, fv = axes(it)
        for wl in data['walls']:
            if wl.get('floor', 1) != it.get('floor', 1):
                continue
            wc = wall_corners(wl)
            if wc is None:
                continue
            corners_w, wu, wn = wc
            pen = sat_penetration(fc, corners_w, [fu, fv, wu, wn])
            if pen > 80.0:
                vio(out, it, '壁 id=%s に約 %.0fmm めり込んでいる'
                    % (wl.get('id', '?'), pen))
    return out


def check5_window_door_clearance(data):
    """掃き出し窓（window-door / windowSill==0）の室内側1000mmの家具。"""
    out = []
    depth = 1000.0
    furn = [f for f in data['items'] if is_furniture(f)]
    rooms = data.get('rooms', [])
    for it in data['items']:
        t = it['type']
        if not (t == 'window-door'
                or (t == 'window' and (it.get('windowSill', None) == 0))):
            continue
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        w, d = it['w'], it['d']
        floor = it.get('floor', 1)
        for sign in (1, -1):
            # 建具の面から sign 方向へ 300mm の点が室内（部屋の中）かどうか
            px = cx + sign * vx * (d / 2.0 + 300.0)
            py = cy + sign * vy * (d / 2.0 + 300.0)
            inside = any(r.get('floor', 1) == floor
                         and r['x'] <= px <= r['x'] + r['w']
                         and r['y'] <= py <= r['y'] + r['d']
                         for r in rooms)
            if not inside:
                continue
            # 室内側: 建具面から depth まで、幅は開口幅
            zc_x = cx + sign * vx * (d / 2.0 + depth / 2.0)
            zc_y = cy + sign * vy * (d / 2.0 + depth / 2.0)
            zone = {'x': zc_x - w / 2.0, 'y': zc_y - depth / 2.0,
                    'w': w, 'd': depth, 'rot': it.get('rot', 0)}
            zone_box = aabb(zone)
            hits = [f for f in furn
                    if f.get('floor', 1) == floor
                    and (f.get('elev', 0) or 0) < 500
                    and rects_intersect(aabb(f), zone_box, 20.0)]
            for f in hits:
                vio(out, it, '室内側 %.0fmm 以内に %s がある'
                    % (depth, label(f)))
    return out


def check6_room_overlap(data):
    """同一階の部屋同士の重なり。"""
    out = []
    rooms = data.get('rooms', [])
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            a, b = rooms[i], rooms[j]
            if a.get('floor', 1) != b.get('floor', 1):
                continue
            ra = (a['x'], a['y'], a['x'] + a['w'], a['y'] + a['d'])
            rb = (b['x'], b['y'], b['x'] + b['w'], b['y'] + b['d'])
            ox, oy = rect_overlap(ra, rb)
            if ox > 5.0 and oy > 5.0:
                out.append('[%s] 部屋 %s(%s) と %s(%s): 重なっている'
                           '（約 %.0f×%.0fmm）'
                           % (fl(a), a.get('id', '?'), a.get('n', '?'),
                              b.get('id', '?'), b.get('n', '?'), ox, oy))
    return out


def check7_inside_site(data):
    """アイテムが敷地（site-rect群の連結範囲）内に収まっているか。"""
    out = []
    sites = [aabb(s) for s in data['items'] if s['type'] == 'site-rect']
    if not sites:
        return out  # 敷地未定義ならチェック対象外
    for it in data['items']:
        t = it['type']
        if (t == 'site-rect' or t in SITE_CHECK_EXCLUDE or is_neighbor(t)):
            continue
        pieces = [aabb(it)]
        for s in sites:
            nxt = []
            for p in pieces:
                nxt.extend(subtract_rect(p, s))
            pieces = nxt
            if not pieces:
                break
        # 数値誤差レベル（1mm以下）の細片は無視
        pieces = [p for p in pieces if p[2] - p[0] > 1.0 and p[3] - p[1] > 1.0]
        if pieces:
            big = max(pieces, key=lambda p: (p[2] - p[0]) * (p[3] - p[1]))
            vio(out, it, '敷地外にはみ出している'
                '（最大はみ出し部 約 %.0f×%.0fmm）'
                % (big[2] - big[0], big[3] - big[1]))
    return out


def check8_stairs(data):
    """stair/stair-corner の隣接連続と stairOrder の連番。"""
    out = []
    by_floor = {}
    for it in data['items']:
        if it['type'] in ('stair', 'stair-corner'):
            by_floor.setdefault(it.get('floor', 1), []).append(it)
    for floor in sorted(by_floor):
        parts = by_floor[floor]
        missing = [p for p in parts if not isinstance(p.get('stairOrder'),
                                                      (int, float))]
        for p in missing:
            vio(out, p, 'stairOrder が設定されていない')
        parts = [p for p in parts if p not in missing]
        parts.sort(key=lambda p: p['stairOrder'])
        orders = [int(p['stairOrder']) for p in parts]
        for i in range(1, len(orders)):
            if orders[i] != orders[i - 1] + 1:
                vio(out, parts[i], 'stairOrder が連番でない'
                    '（%d の次が %d）' % (orders[i - 1], orders[i]))
        for i in range(1, len(parts)):
            a, b = parts[i - 1], parts[i]
            ba, bb = aabb(a), aabb(b)
            gap = 50.0  # 50mmまでの隙間は隣接とみなす
            expanded = (ba[0] - gap, ba[1] - gap, ba[2] + gap, ba[3] + gap)
            if not rects_intersect(expanded, bb, 0.0):
                out.append('[%s] %s と %s: 階段が隣接していない'
                           '（stairOrder %d→%d が離れている）'
                           % (fl(a), label(a), label(b),
                              int(a['stairOrder']), int(b['stairOrder'])))
    return out


def check9_light_elev(data):
    """照明の elev が天井高（部屋指定 > 既定 1F:2700 / 2F以上:2520）以内か。"""
    out = []
    rooms = data.get('rooms', [])
    for it in data['items']:
        if not is_light(it['type']):
            continue
        floor = it.get('floor', 1)
        ceiling = 2700 if floor <= 1 else 2520
        cx, cy = center(it)
        for r in rooms:
            if (r.get('floor', 1) == floor
                    and r['x'] <= cx <= r['x'] + r['w']
                    and r['y'] <= cy <= r['y'] + r['d']):
                ch = r.get('ceilingHeight')
                if isinstance(ch, (int, float)) and ch > 0:
                    ceiling = ch
                break
        elev = it.get('elev', 0) or 0
        if elev > ceiling:
            vio(out, it, '照明の elev %.0fmm が天井高 %.0fmm を超えている'
                % (elev, ceiling))
    return out


# ---------------------------------------------------------------- メイン

CHECKS = [
    ('1. 建具が壁線上に乗っているか', check1_doors_on_walls),
    ('2. 開き戸の開閉スペース', check2_swing_clearance),
    ('3. 家具同士の重なり', check3_furniture_overlap),
    ('4. 家具の壁へのめり込み', check4_furniture_in_wall),
    ('5. 掃き出し窓の室内側クリアランス', check5_window_door_clearance),
    ('6. 部屋同士の重なり', check6_room_overlap),
    ('7. 敷地外へのはみ出し', check7_inside_site),
    ('8. 階段の連続性', check8_stairs),
    ('9. 照明の天井高超過', check9_light_elev),
]


def main(argv):
    if len(argv) > 1:
        path = argv[1]
    else:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        path = os.path.join(root, 'assets', 'default_plan.json')
    try:
        with open(path, encoding='utf-8') as fp:
            data = json.load(fp)
    except (OSError, ValueError) as e:
        print('読み込み失敗: %s (%s)' % (path, e))
        return 0

    data.setdefault('walls', [])
    data.setdefault('rooms', [])
    data.setdefault('items', [])

    print('lint_plan: %s' % path)
    print('walls=%d rooms=%d items=%d' % (
        len(data['walls']), len(data['rooms']), len(data['items'])))
    print()

    total = 0
    summary = []
    for name, fn in CHECKS:
        violations = fn(data)
        summary.append((name, len(violations)))
        total += len(violations)
        if violations:
            print('== %s: %d件' % (name, len(violations)))
            for v in violations:
                print('  ' + v)
            print()

    print('---- サマリ ----')
    for name, count in summary:
        print('%s: %s' % (name, '%d件' % count if count else 'OK'))
    print('合計違反: %d件' % total)
    if total == 0:
        print('OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
