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
 10. 部屋への到達性（PS等を除き、境界に建具があるか）
 11. 家具モデルIDがカタログ(manifest)に実在するか、寸法が一致するか

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
SWING_DOOR_TYPES = {'door-swing', 'door-swing-s', 'door-front',
                    'door-fold', 'door-fold-w'}
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
    # 高さ500mm以下の custom-block は床仕上げ・段(デッキ/ポーチ/目地)扱い。
    # 家具ではないので、ドアの開閉域や家具重なりの対象から外す
    if t == 'custom-block' and (it.get('customHeight') or 900) <= 500:
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
        # 開き戸は開口幅の正方形、折戸は畳み代+通行幅900で見る
        w = 900.0 if it['type'] in ('door-fold', 'door-fold-w') else it['w']
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


def check3_furniture_overlap(data, root=None):
    """家具同士のAABB重なり。

    除外するのは「意図的に重なる組合せ」だけ:
      - elev差500mm以上 / 高所設置(elev500mm以上)の壁掛け・吊り物
      - 一方が他方の天板に載っている(elev >= 相手の高さ-50)
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}

    def height_of(o):
        t = o.get('type', '')
        if t in cat:
            return cat[t][2] or 0
        if t == 'custom-block':
            return o.get('customHeight') or 900
        return 0

    furn = [f for f in data['items'] if is_furniture(f)]
    for i in range(len(furn)):
        for j in range(i + 1, len(furn)):
            a, b = furn[i], furn[j]
            if a.get('floor', 1) != b.get('floor', 1):
                continue
            ea, eb = a.get('elev', 0) or 0, b.get('elev', 0) or 0
            if abs(ea - eb) >= 500 or max(ea, eb) >= 500:
                continue  # 高さ違い・壁掛け等の意図的な組合せ
            if ea >= height_of(b) - 50 and ea > 0:
                continue  # a が b の上に載っている
            if eb >= height_of(a) - 50 and eb > 0:
                continue  # b が a の上に載っている
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


def check10_room_access(data):
    """名前を持つ部屋は、境界に建具(ドア/開口/掃き出し窓)が1つ以上あること。
    PS(配管区画)・階段・バルコニー・吹き抜け・無名室は対象外。"""
    out = []
    skip_names = {'PS', '階段', 'バルコニー', '吹き抜け', ''}
    entry_types = set(DOOR_TYPES) - {'window'}
    for r in data.get('rooms', []):
        name = (r.get('n') or '').strip()
        if name in skip_names:
            continue
        floor = r.get('floor', 1)
        rx0, ry0 = r['x'] - 200, r['y'] - 200
        rx1, ry1 = r['x'] + r['w'] + 200, r['y'] + r['d'] + 200
        found = False
        for it in data.get('items', []):
            if it.get('floor', 1) != floor or it.get('type') not in entry_types:
                continue
            b = aabb(it)
            if b[0] < rx1 and b[2] > rx0 and b[1] < ry1 and b[3] > ry0:
                found = True
                break
        if not found:
            vio(out, r, '部屋「%s」にどこからも入れない(境界に建具が無い)' % name)
    return out


MANIFESTS = [
    'assets/models/furniture_mega/manifest.json',
    'assets/models/interior_model_0_26_1/manifest.json',
    'assets/models/custom/manifest.json',
]


def _load_catalog(root):
    """{id: (w,d,h)} を返す。manifestが無い場合は None(=チェック不能)。"""
    cat = {}
    found = False
    for rel in MANIFESTS:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        found = True
        with open(path, encoding='utf-8') as f:
            m = json.load(f)
        for i in (m.get('items') or m):
            cat[i['id']] = (i.get('w'), i.get('d'), i.get('h'))
    return cat if found else None


def check11_model_ids(data, root=None):
    """fmp-/im0261- のtypeがカタログに実在し、w/dが概ね一致するか。

    存在しないIDは3Dで無言のまま代替表示になり、目視でも気づきにくい。
    寸法は回転(rot 90度単位)でw/dが入れ替わるため、両順で照合する。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root)
    if cat is None:
        return out
    for it in data.get('items', []):
        t = it.get('type', '')
        if not (t.startswith('fmp-') or t.startswith('im0261-')):
            continue
        if t not in cat:
            vio(out, it, 'モデルID「%s」がカタログに存在しない'
                '(3Dで別物・代替形状になる)' % t)
            continue
        cw, cd, _ = cat[t]
        if not cw or not cd:
            continue
        w, d = it.get('w', 0), it.get('d', 0)
        ok = (abs(w - cw) <= 3 and abs(d - cd) <= 3) or \
             (abs(w - cd) <= 3 and abs(d - cw) <= 3)
        if not ok:
            vio(out, it, '寸法がカタログと違う: プラン %.0fx%.0f / カタログ %.0fx%.0f'
                % (w, d, cw, cd))
    return out


CEILING_MM = 2400   # index.html の WALL_H


def check12_ceiling_clash(data, root=None):
    """屋内アイテムの elev + モデル高が天井高を超えていないか。

    カーテン(h2500超)やレンジフードは elev を足すと簡単に天井を抜ける。
    3Dでは天井面より上が壁の外へ突き出して見える。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root)
    if cat is None:
        return out
    # 屋外に立つものは対象外
    outdoor = set(STRUCT_SITE_TYPES) | {'ac-outdoor', 'gas-heater', 'water-heater',
                                        'meter-box', 'sewer-pit', 'downspout'}
    for it in data.get('items', []):
        t = it.get('type', '')
        if t in outdoor or is_light(t) or is_neighbor(t):
            continue
        h = None
        if t in cat:
            h = cat[t][2]
        elif t == 'custom-block':
            h = it.get('customHeight') or 900
        if not h:
            continue
        top = (it.get('elev') or 0) + h
        if top > CEILING_MM + 1:
            vio(out, it, '天井(%dmm)を %.0fmm 貫通している(elev %.0f + 高さ %.0f)'
                % (CEILING_MM, top - CEILING_MM, it.get('elev') or 0, h))
    return out


SLIDE_DOOR_TYPES = {'door-slide', 'door-slide-s', 'door-pocket',
                    'door-opening', 'door-opening-arch'}


def check13_slide_clearance(data):
    """引戸・開口の前面600mmに家具が入り込んでいないか。

    check2 は開き戸しか見ないので、引戸の正面に物を置いても素通りしていた。
    通れれば良いので、両側とも塞がれている場合だけを違反とする。
    """
    out = []
    furn = [f for f in data['items'] if is_furniture(f)]
    for it in data['items']:
        if it['type'] not in SLIDE_DOOR_TYPES:
            continue
        cx, cy = center(it)
        (_ux, _uy), (vx, vy) = axes(it)
        w, band = it['w'], 600.0
        floor = it.get('floor', 1)
        blocked = []
        for sign in (1, -1):
            bx = cx + sign * vx * band / 2.0
            by = cy + sign * vy * band / 2.0
            rect = {'x': bx - w / 2.0, 'y': by - band / 2.0,
                    'w': w, 'd': band, 'rot': it.get('rot', 0)}
            box = aabb(rect)
            blocked.append([f for f in furn
                            if f.get('floor', 1) == floor
                            and rects_intersect(aabb(f), box, 20.0)])
        if blocked[0] and blocked[1]:
            names = sorted({label(f) for f in blocked[0] + blocked[1]})
            vio(out, it, '前面の通行帯(600mm)が両側とも家具で塞がれている: %s'
                % ', '.join(names))
    return out


def check14_wall_support(data):
    """2階以上の壁が1階(直下)の壁に支持されているか。

    支持率0%で長さ2730mm超の壁は、その下が丸ごとクリアスパンになる。
    在来木造で成立しない構成をここで止める。
    """
    out = []
    TOL = 200.0     # 直下判定の許容ずれ
    for w in data.get('walls', []):
        fl_ = w.get('floor', 1)
        if fl_ <= 1 or w.get('wallStyle') == 'balcony-fence':
            continue
        length = math.hypot(w['x2'] - w['x1'], w['y2'] - w['y1'])
        if length <= 2730:
            continue
        horiz = abs(w['y2'] - w['y1']) < 1.0
        below = [b for b in data.get('walls', []) if b.get('floor', 1) == fl_ - 1]
        covered = 0.0
        for b in below:
            b_horiz = abs(b['y2'] - b['y1']) < 1.0
            if b_horiz != horiz:
                continue
            if horiz and abs(b['y1'] - w['y1']) > TOL:
                continue
            if not horiz and abs(b['x1'] - w['x1']) > TOL:
                continue
            if horiz:
                lo = max(min(w['x1'], w['x2']), min(b['x1'], b['x2']))
                hi = min(max(w['x1'], w['x2']), max(b['x1'], b['x2']))
            else:
                lo = max(min(w['y1'], w['y2']), min(b['y1'], b['y2']))
                hi = min(max(w['y1'], w['y2']), max(b['y1'], b['y2']))
            covered += max(0.0, hi - lo)
        # 直交する下階の壁は「点で受ける柱」として、その位置でスパンを割る
        cuts = []
        for b in below:
            b_horiz = abs(b['y2'] - b['y1']) < 1.0
            if b_horiz == horiz:
                continue
            if horiz:
                bx = b['x1']
                lo, hi = min(w['x1'], w['x2']), max(w['x1'], w['x2'])
                if lo - TOL <= bx <= hi + TOL and \
                   min(b['y1'], b['y2']) - TOL <= w['y1'] <= max(b['y1'], b['y2']) + TOL:
                    cuts.append(bx)
            else:
                by = b['y1']
                lo, hi = min(w['y1'], w['y2']), max(w['y1'], w['y2'])
                if lo - TOL <= by <= hi + TOL and \
                   min(b['x1'], b['x2']) - TOL <= w['x1'] <= max(b['x1'], b['x2']) + TOL:
                    cuts.append(by)
        lo = min(w['x1'], w['x2']) if horiz else min(w['y1'], w['y2'])
        hi = max(w['x1'], w['x2']) if horiz else max(w['y1'], w['y2'])
        pts = sorted(set([lo, hi] + [c for c in cuts if lo < c < hi]))
        span = max((pts[i + 1] - pts[i] for i in range(len(pts) - 1)), default=hi - lo)
        if covered < 1.0 and span > 4550:
            vio(out, w, '長さ%.0fmmの壁が直下で支持されておらず、'
                '最大スパン%.0fmm(実用上限4550)を受ける梁が必要'
                % (length, span))
    return out


def check15_window_outside_clearance(data):
    """掃き出し窓の屋外側1500mmに車・自転車・設備・塀が無いか。"""
    out = []
    BLOCK = {'car', 'bicycle', 'bicycle-fold', 'ac-outdoor', 'water-heater',
             'gas-heater', 'fence', 'wood-fence'}
    blockers = [b for b in data['items'] if b['type'] in BLOCK]
    rooms_by_floor = {}
    for r in data.get('rooms', []):
        rooms_by_floor.setdefault(r.get('floor', 1), []).append(r)
    for it in data['items']:
        if it['type'] != 'window-door' and not (
                it['type'] == 'window' and (it.get('windowSill') or 0) == 0):
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (_u), (vx, vy) = axes(it)[0], axes(it)[1]
        for sign in (1, -1):
            px, py = cx + sign * vx * 300, cy + sign * vy * 300
            inside = any(px >= r['x'] and px <= r['x'] + r['w'] and
                         py >= r['y'] and py <= r['y'] + r['d']
                         for r in rooms_by_floor.get(floor, []))
            if inside:
                continue    # 室内側は check5 が見る
            bx = cx + sign * vx * 750
            by = cy + sign * vy * 750
            rect = {'x': bx - it['w'] / 2.0, 'y': by - 750, 'w': it['w'],
                    'd': 1500, 'rot': it.get('rot', 0)}
            box = aabb(rect)
            hits = [b for b in blockers if rects_intersect(aabb(b), box, 20.0)]
            if hits:
                vio(out, it, '屋外側1500mm以内に %s がある'
                    % ', '.join(sorted({label(b) for b in hits})))
    return out


def check16_ac_pairing(data):
    """エアコン室内機と室外機が1対1で、配管長3m以内に対応しているか。"""
    out = []
    ins = [i for i in data['items'] if 'AirConditioner' in i.get('type', '')]
    outs = [o for o in data['items'] if o.get('type') == 'ac-outdoor']
    used = set()
    for i in ins:
        ix, iy = center(i)
        best, bd = None, 1e9
        for o in outs:
            if id(o) in used:
                continue
            ox, oy = center(o)
            dist = math.hypot(ox - ix, oy - iy)
            if dist < bd:
                best, bd = o, dist
        if best is None or bd > 3000:
            vio(out, i, '配管長3m以内に対応する室外機が無い(最寄り %.0fmm)' % bd)
        else:
            used.add(id(best))
    for o in outs:
        if id(o) not in used:
            vio(out, o, '対応する室内機が無い室外機')
    return out


def check17_window_head_alignment(data):
    """同一階・同一外壁面で窓の上端(sill+height)の種類が2を超えていないか。"""
    out = []
    groups = {}
    for it in data['items']:
        if it['type'] not in ('window', 'window-door'):
            continue
        top = (it.get('windowSill') or 0) + (it.get('windowHeight') or 0)
        rot = int(round((it.get('rot', 0) or 0))) % 180
        key = (it.get('floor', 1), 'NS' if rot == 0 else 'EW')
        groups.setdefault(key, {}).setdefault(top, []).append(it)
    for (floor, face), tops in sorted(groups.items()):
        if len(tops) > 2:
            desc = ', '.join('%dmm×%d枚' % (t, len(v)) for t, v in sorted(tops.items()))
            out.append('[%dF] %s面: 窓上端が%d種類ある(%s)'
                       % (floor, face, len(tops), desc))
    return out


def check18_storage_ratio(data):
    """収納率が10%以上あるか。"""
    out = []
    NAMES = ('収納', 'WIC', 'CL', 'SIC', '納戸', 'パントリー', '物入',
             'クローゼット', 'リネン', 'シューズ')
    total = 0.0
    store = 0.0
    for r in data.get('rooms', []):
        a = (r['w'] * r['d']) / 1e6
        if (r.get('n') or '').strip() in ('PS',):
            continue
        total += a
        if any(n in (r.get('n') or '') for n in NAMES):
            store += a
    if total > 0:
        ratio = store / total * 100.0
        if ratio < 10.0:
            out.append('収納率 %.1f%% (収納 %.1f㎡ / 延床 %.1f㎡)。'
                       '目安10〜13%%に届いていない' % (ratio, store, total))
    return out


def check19_reachability(data):
    """各階の全室に、有効幅600mmの経路で到達できるか。

    壁と家具を障害物にしたグリッドで塗りつぶす。建具の位置は通れるものとする。
    「家具が並んで実質通れない」タイプの分断は、個々の寸法チェックでは
    絶対に出てこない(1F東西の分断がこれで丸ごと見逃されていた)。
    """
    return _reach(data, 600.0)


def _reach(data, clear, only_names=None):
    out = []
    CELL = 100.0        # グリッド解像度
    CLEAR = clear       # 必要な有効幅
    pad = CLEAR / 2.0
    for floor in sorted({r.get('floor', 1) for r in data.get('rooms', [])}):
        rms = [r for r in data['rooms'] if r.get('floor', 1) == floor]
        if not rms:
            continue
        x0 = min(r['x'] for r in rms); x1 = max(r['x'] + r['w'] for r in rms)
        y0 = min(r['y'] for r in rms); y1 = max(r['y'] + r['d'] for r in rms)
        nx = int((x1 - x0) / CELL) + 2; ny = int((y1 - y0) / CELL) + 2
        if nx * ny > 400000:
            continue
        # 室内セル
        inside = [[False] * ny for _ in range(nx)]
        for i in range(nx):
            for j in range(ny):
                px, py = x0 + i * CELL, y0 + j * CELL
                for r in rms:
                    if r['x'] <= px <= r['x'] + r['w'] and r['y'] <= py <= r['y'] + r['d']:
                        inside[i][j] = True
                        break
        # 障害物(壁・家具)。建具のある区間は通す
        doors = [d for d in data['items']
                 if d.get('floor', 1) == floor and d.get('type') in DOOR_TYPES
                 and d.get('type') != 'window']
        blocked = [[False] * ny for _ in range(nx)]

        def mark(box, extra):
            # 格子点が膨張した箱の中に入るセルだけを塞ぐ。切り上げで1セル余分に
            # 塞ぐと、790mm幅の廊下のように余裕の少ない通路が誤って不通になる
            bi0 = max(0, int(math.ceil((box[0] - extra - x0) / CELL)))
            bi1 = min(nx - 1, int(math.floor((box[2] + extra - x0) / CELL)))
            bj0 = max(0, int(math.ceil((box[1] - extra - y0) / CELL)))
            bj1 = min(ny - 1, int(math.floor((box[3] + extra - y0) / CELL)))
            for i in range(bi0, bi1 + 1):
                for j in range(bj0, bj1 + 1):
                    blocked[i][j] = True

        for w in data.get('walls', []):
            if w.get('floor', 1) != floor:
                continue
            ht = (w.get('thick', 120) or 120) / 2.0
            mark((min(w['x1'], w['x2']) - ht, min(w['y1'], w['y2']) - ht,
                  max(w['x1'], w['x2']) + ht, max(w['y1'], w['y2']) + ht), pad)
        for f in data['items']:
            if f.get('floor', 1) == floor and is_furniture(f) \
                    and (f.get('elev') or 0) < 500:
                mark(aabb(f), pad)
        for d in doors:
            # 開口は「幅=建具幅 / 奥行=壁厚+前後CLEAR」の通路として開ける。
            # 建具のAABBだけを開けると、壁を膨らませた分が残って通り抜けられない
            b = aabb(d)
            (_ux, _uy), (vx, vy) = axes(d)
            ex = CLEAR if abs(vx) > abs(vy) else 0.0
            ey = CLEAR if abs(vy) >= abs(vx) else 0.0
            bi0 = max(0, int((b[0] - ex - x0) / CELL))
            bi1 = min(nx - 1, int((b[2] + ex - x0) / CELL))
            bj0 = max(0, int((b[1] - ey - y0) / CELL))
            bj1 = min(ny - 1, int((b[3] + ey - y0) / CELL))
            for i in range(bi0, bi1 + 1):
                for j in range(bj0, bj1 + 1):
                    blocked[i][j] = False

        free = [[inside[i][j] and not blocked[i][j] for j in range(ny)] for i in range(nx)]
        start = None
        entry = [r for r in rms if '玄関' in (r.get('n') or '')] or \
                [r for r in rms if 'ホール' in (r.get('n') or '')] or rms
        for r in entry:
            ci = int((r['x'] + r['w'] / 2 - x0) / CELL)
            cj = int((r['y'] + r['d'] / 2 - y0) / CELL)
            for di in range(-4, 5):
                for dj in range(-4, 5):
                    i, j = ci + di, cj + dj
                    if 0 <= i < nx and 0 <= j < ny and free[i][j]:
                        start = (i, j); break
                if start: break
            if start: break
        if not start:
            continue
        seen = [[False] * ny for _ in range(nx)]
        stack = [start]; seen[start[0]][start[1]] = True
        while stack:
            i, j = stack.pop()
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = i + di, j + dj
                if 0 <= a < nx and 0 <= b < ny and free[a][b] and not seen[a][b]:
                    seen[a][b] = True
                    stack.append((a, b))
        for r in rms:
            name = (r.get('n') or '').strip()
            if not name or name in ('PS', '階段', 'バルコニー'):
                continue
            if only_names and name not in only_names:
                continue
            ok = False
            ci0 = max(0, int((r['x'] - x0) / CELL)); ci1 = min(nx - 1, int((r['x'] + r['w'] - x0) / CELL))
            cj0 = max(0, int((r['y'] - y0) / CELL)); cj1 = min(ny - 1, int((r['y'] + r['d'] - y0) / CELL))
            for i in range(ci0, ci1 + 1):
                for j in range(cj0, cj1 + 1):
                    if seen[i][j]:
                        ok = True; break
                if ok: break
            if not ok:
                out.append('[%dF] 部屋「%s」へ有効幅%.0fmmの経路で到達できない'
                           % (floor, name, CLEAR))
    return out


def check20_opening_span_clear(data):
    """建具の開口スパンの中に、直交する壁の端部が突き出していないか。

    開口の真ん中に壁が立つと、扉が壁に当たる/開口が2つに割れる。
    平面図では線が重なって見えないので気づきにくい。
    """
    out = []
    for it in data['items']:
        if it['type'] not in DOOR_TYPES or it['type'] == 'window':
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (ux, uy), _ = axes(it)
        half = it['w'] / 2.0
        ax, ay = cx - ux * half, cy - uy * half
        for w in data.get('walls', []):
            if w.get('floor', 1) != floor:
                continue
            for ex, ey in ((w['x1'], w['y1']), (w['x2'], w['y2'])):
                # 端点が開口線分の内側(端から5mm以上)かつ線分から壁厚以内にあるか
                t = (ex - ax) * ux + (ey - ay) * uy
                if not (5.0 < t < it['w'] - 5.0):
                    continue
                perp = abs(-(ex - ax) * uy + (ey - ay) * ux)
                if perp <= (w.get('thick', 120) or 120) / 2.0 + 30.0:
                    vio(out, it, '開口(幅%.0fmm)の中に壁 id=%s の端部が突き出している'
                        '(開口の端から%.0fmm)' % (it['w'], w.get('id', '?'), t))
                    break
            else:
                continue
            break
    return out


def check21_outdoor_overlap(data):
    """屋外アイテム同士の重なり。check3 は外構系を丸ごと除外しているため素通りする。"""
    out = []
    TARGET = {'ac-outdoor', 'water-heater', 'gas-heater', 'meter-box',
              'sewer-pit', 'exterior-stair', 'ramp', 'tree', 'car',
              'bicycle', 'bicycle-fold', 'fence', 'wood-fence',
              'lattice-screen', 'downspout'}
    objs = [o for o in data['items'] if o.get('type') in TARGET]
    for i in range(len(objs)):
        for j in range(i + 1, len(objs)):
            a, b = objs[i], objs[j]
            if a.get('floor', 1) != b.get('floor', 1):
                continue
            # 塀・フェンスは連続配置するので端部の接触は許す
            if a['type'] in ('fence', 'wood-fence', 'lattice-screen') and \
               b['type'] in ('fence', 'wood-fence', 'lattice-screen'):
                continue
            ea, eb = a.get('elev', 0) or 0, b.get('elev', 0) or 0
            if abs(ea - eb) >= 500 or max(ea, eb) >= 500:
                continue
            ox, oy = rect_overlap(aabb(a), aabb(b))
            if ox > 20.0 and oy > 20.0:
                out.append('[%s] %s と %s: 屋外で重なっている（約 %.0f×%.0fmm）'
                           % (fl(a), label(a), label(b), ox, oy))
    return out


def check22_high_object_clash(data, root=None):
    """高所設置物(壁掛けエアコン・カーテン・吊り棚)同士の3次元干渉。

    check3 は elev>=500 を「意図的な組合せ」として丸ごと除外するので、
    エアコンがカーテンから生えているような不良を検出できない。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}

    def band(o):
        t = o.get('type', '')
        h = cat[t][2] if t in cat else (o.get('customHeight') if t == 'custom-block' else None)
        if not h:
            return None
        e = o.get('elev', 0) or 0
        return (e, e + h)

    objs = []
    for o in data['items']:
        t = o.get('type', '')
        if t in DOOR_TYPES or t in ANNOTATION_TYPES or is_light(t) or is_neighbor(t):
            continue
        if t in STRUCT_SITE_TYPES:
            continue
        b = band(o)
        if b and b[1] > 500:
            objs.append((o, b))
    for i in range(len(objs)):
        for j in range(i + 1, len(objs)):
            (a, ba), (b, bb) = objs[i], objs[j]
            if a.get('floor', 1) != b.get('floor', 1):
                continue
            vo = min(ba[1], bb[1]) - max(ba[0], bb[0])
            if vo <= 20:
                continue
            # 一方が他方の上に載っている(=天板)組合せは除外
            if abs(ba[0] - bb[1]) < 60 or abs(bb[0] - ba[1]) < 60:
                continue
            ox, oy = rect_overlap(aabb(a), aabb(b))
            if ox > 20.0 and oy > 20.0:
                out.append('[%s] %s と %s: 高さ%.0fmm分が3次元で干渉'
                           '（平面 %.0f×%.0fmm）'
                           % (fl(a), label(a), label(b), vo, ox, oy))
    return out


def check23_kitchen_aisle(data):
    """キッチンの中に有効1000mmの立ち位置帯があるか(品質基準の通路幅)。

    出入口の開口(910モジュール)は日本の住宅では標準なので、到達性ではなく
    「調理側に1000mm立てるか」を見る。
    """
    out = []
    CELL, CLEAR = 100.0, 1000.0
    pad = CLEAR / 2.0
    for r in data.get('rooms', []):
        if 'キッチン' not in (r.get('n') or ''):
            continue
        floor = r.get('floor', 1)
        boxes = []
        for w in data.get('walls', []):
            if w.get('floor', 1) != floor:
                continue
            ht = (w.get('thick', 120) or 120) / 2.0
            boxes.append((min(w['x1'], w['x2']) - ht, min(w['y1'], w['y2']) - ht,
                          max(w['x1'], w['x2']) + ht, max(w['y1'], w['y2']) + ht))
        for f in data['items']:
            if f.get('floor', 1) == floor and is_furniture(f) and (f.get('elev') or 0) < 500:
                boxes.append(aabb(f))
        free = 0
        px = r['x']
        while px <= r['x'] + r['w']:
            py = r['y']
            while py <= r['y'] + r['d']:
                if not any(b[0] - pad <= px <= b[2] + pad and b[1] - pad <= py <= b[3] + pad
                           for b in boxes):
                    free += 1
                py += CELL
            px += CELL
        if free < 3:
            out.append('[%dF] 部屋「%s」に有効幅%.0fmmの立ち位置が取れていない'
                       % (floor, (r.get('n') or '').strip(), CLEAR))
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
    ('10. 部屋への到達性', check10_room_access),
    ('11. モデルIDと寸法の実在性', check11_model_ids),
    ('12. 天井高の貫通', check12_ceiling_clash),
    ('13. 引戸・開口の前面通行帯', check13_slide_clearance),
    ('14. 上階の壁の直下支持', check14_wall_support),
    ('15. 掃き出し窓の屋外側クリアランス', check15_window_outside_clearance),
    ('16. エアコン室内機と室外機の対応', check16_ac_pairing),
    ('17. 窓上端の通り', check17_window_head_alignment),
    ('18. 収納率', check18_storage_ratio),
    ('19. 全室への通行連続性', check19_reachability),
    ('20. 開口内への壁端部の突き出し', check20_opening_span_clear),
    ('21. 屋外アイテム同士の重なり', check21_outdoor_overlap),
    ('22. 高所設置物の3次元干渉', check22_high_object_clash),
    ('23. キッチン通路の有効1000mm', check23_kitchen_aisle),
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
