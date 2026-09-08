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
    # カーテン・ロールスクリーンは窓に付く物、カーペットは床仕上げ。
    # 重なり・窓前チェックの対象外
    if is_window_dressing(t) or '-Carpet-' in t:
        return False
    return True


def is_window_dressing(t):
    """窓装飾(カーテン・ロールスクリーン)か。

    自作モデル(fmp-Curtain01 等)はカタログ品の '-Curtain-' に当たらないので、
    ここで両方をまとめて見る。片方だけ書くと、自作へ差し替えた瞬間に
    「カーテンが1枚も無い」判定になって静かに素通りする。
    """
    return ('-Curtain-' in t or t.startswith('fmp-Curtain')
            or t.startswith('fmp-RollerScreen'))


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


# ── 天井高 ────────────────────────────────────────────────────────────
# index.html の roomVoidCeilingMm と同じ式。手で数字を書かせないための唯一の
# 決まりごとなので、片方だけ直すと必ず食い違う。
FLOOR_H_MM = 2700       # 階高 (index.html の FLOOR_H)
FLOOR_SLAB_MM = 180     # 床スラブ (index.html の FLOOR_SLAB_H)


def room_ceiling_mm(room):
    """その部屋の天井高(床天端から測ったmm)。吹き抜けは階高から計算する。"""
    floor = room.get('floor', 1)
    slab = 0 if floor <= 1 else FLOOR_SLAB_MM
    c = room.get('ceiling') or {}
    if c.get('type') == 'void':
        to = c.get('toFloor')
        to = int(to) if isinstance(to, (int, float)) else floor + 1
        to = max(floor + 1, to)
        return (to - floor + 1) * FLOOR_H_MM - slab
    mm = c.get('heightMm') or room.get('ceilingHeight')
    if isinstance(mm, (int, float)) and mm > 0:
        return float(mm) - slab
    return None


def room_at(data, floor, cx, cy):
    for r in data.get('rooms', []):
        if (r.get('floor', 1) == floor
                and r['x'] <= cx <= r['x'] + r['w']
                and r['y'] <= cy <= r['y'] + r['d']):
            return r
    return None

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
        r = room_at(data, floor, cx, cy)
        if r is not None:
            mm = room_ceiling_mm(r)
            if mm:
                ceiling = mm
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
            found = _room_has_open_edge(data, r, floor)
        if not found:
            vio(out, r, '部屋「%s」にどこからも入れない(建具も壁の切れ目も無い)' % name)
    return out


def _room_has_open_edge(data, r, floor):
    """部屋の境界に、壁が無く隣室に face している幅600mm以上の区間があるか。

    建具を置かずに壁を切って通す(ホールと廊下のような)つなぎ方があるので、
    建具の有無だけで「入れない」と断じない。実際に通れるかは check19 が見る。
    """
    STEP, NEED = 50.0, 600.0
    walls = [w for w in data.get('walls', []) if w.get('floor', 1) == floor]
    rooms = [o for o in data.get('rooms', []) if o.get('floor', 1) == floor and o is not r]
    x0, y0 = r['x'], r['y']
    x1, y1 = x0 + r['w'], y0 + r['d']
    edges = [((x0, y0), (x1, y0), (0.0, -1.0)), ((x0, y1), (x1, y1), (0.0, 1.0)),
             ((x0, y0), (x0, y1), (-1.0, 0.0)), ((x1, y0), (x1, y1), (1.0, 0.0))]
    for (ax, ay), (bx, by), (nx, ny) in edges:
        length = math.hypot(bx - ax, by - ay)
        if length < NEED:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        run = 0.0
        n = int(length / STEP)
        for i in range(n + 1):
            px, py = ax + ux * i * STEP, ay + uy * i * STEP
            blocked = False
            for w in walls:
                ht = (w.get('thick', 120) or 120) / 2.0
                if (min(w['x1'], w['x2']) - ht <= px <= max(w['x1'], w['x2']) + ht and
                        min(w['y1'], w['y2']) - ht <= py <= max(w['y1'], w['y2']) + ht):
                    blocked = True
                    break
            if not blocked:
                qx, qy = px + nx * 150.0, py + ny * 150.0
                blocked = not any(o['x'] <= qx <= o['x'] + o['w'] and
                                  o['y'] <= qy <= o['y'] + o['d'] for o in rooms)
            if blocked:
                run = 0.0
            else:
                run += STEP
                if run >= NEED:
                    return True
    return False


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
        ceil = _ceiling_for_item(data, it)
        if top > ceil + 1:
            vio(out, it, '天井(%dmm)を %.0fmm 貫通している(elev %.0f + 高さ %.0f)'
                % (ceil, top - ceil, it.get('elev') or 0, h))
    return out


def _ceiling_for_item(data, it):
    """そのアイテムが立っている部屋の天井高(床天端からのmm)。

    吹き抜けの部屋は階高より高い。一律 CEILING_MM で見ると、吹き抜けに吊った
    シーリングファンが「天井を貫通」と誤検出される。
    """
    cx, cy = center(it)
    r = room_at(data, it.get('floor', 1), cx, cy)
    if r is None:
        return CEILING_MM
    return room_ceiling_mm(r) or CEILING_MM


SLIDE_DOOR_TYPES = {'door-slide', 'door-slide-s', 'door-pocket',
                    'door-opening', 'door-opening-arch'}


def check13_slide_clearance(data):
    """引戸・開口の前面に、幅600mm以上の通り抜けが連続して残っているか。

    check2 は開き戸しか見ないので、引戸の正面に物を置いても素通りしていた。
    開口いっぱいが空いている必要はない。全面開口のキッチンのように
    ペニンシュラが一部を塞いでいても、端に600mmの通り道が続いていれば通れる。
    両側ともその600mmが取れない場合だけを違反とする。
    """
    out = []
    NEED = 600.0
    furn = [f for f in data['items'] if is_furniture(f)]
    for it in data['items']:
        if it['type'] not in SLIDE_DOOR_TYPES:
            continue
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        w, band = it['w'], 600.0
        floor = it.get('floor', 1)
        here = [f for f in furn if f.get('floor', 1) == floor]
        blocked = []
        for sign in (1, -1):
            bx = cx + sign * vx * band / 2.0
            by = cy + sign * vy * band / 2.0
            n = max(1, int(w / 50.0))
            step = w / n
            hit, run, best = [], 0.0, 0.0
            for i in range(n):
                off = (i + 0.5) * step - w / 2.0
                sx, sy = bx + ux * off, by + uy * off
                cell = aabb({'x': sx - step / 2.0, 'y': sy - band / 2.0,
                             'w': step, 'd': band, 'rot': it.get('rot', 0)})
                on = [f for f in here if rects_intersect(aabb(f), cell, 20.0)]
                if on:
                    hit.extend(on)
                    run = 0.0
                else:
                    run += step
                    best = max(best, run)
            blocked.append(hit if best < NEED else [])
        if blocked[0] and blocked[1]:
            names = sorted({label(f) for f in blocked[0] + blocked[1]})
            vio(out, it, '前面に幅600mmの通り道が両側とも残っていない: %s'
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
             'クローゼット', 'リネン', 'シューズ', '押入')
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
            # 格子点が膨張した箱の**内側**に入るセルだけを塞ぐ。
            # 障害物からちょうど extra(=有効幅の半分)離れた格子点は、そこを
            # 中心に有効幅ちょうどの通路が取れるので通れる。境界を塞ぐと
            # 「実寸645mmの脇道」が不通と判定されてしまう
            bi0 = max(0, int(math.floor((box[0] - extra - x0) / CELL)) + 1)
            bi1 = min(nx - 1, int(math.ceil((box[2] + extra - x0) / CELL)) - 1)
            bj0 = max(0, int(math.floor((box[1] - extra - y0) / CELL)) + 1)
            bj1 = min(ny - 1, int(math.ceil((box[3] + extra - y0) / CELL)) - 1)
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
            # カーテン同士は隣り合って掛かるので対象外
            if '-Curtain-' in a.get('type', '') and '-Curtain-' in b.get('type', ''):
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


SLIDE_POCKET_TYPES = {'door-slide', 'door-slide-s', 'door-pocket'}


def check24_slide_pocket(data):
    """片引戸の引き代(戸袋)が戸幅ぶん壁に残っているか、その壁面が空いているか。

    引戸は開口と同じだけ壁が要る。壁が足りないと全開できないし、
    戸が滑る面に家具が立っていても同じこと。どちらも平面図では気づけない。
    """
    out = []
    furn = [f for f in data['items'] if is_furniture(f)]
    for it in data['items']:
        if it['type'] not in SLIDE_POCKET_TYPES:
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        half = it['w'] / 2.0
        host, best = None, 1e9
        for w in data.get('walls', []):
            if w.get('floor', 1) != floor:
                continue
            d = seg_point_dist(cx, cy, w['x1'], w['y1'], w['x2'], w['y2'])
            if d < best:
                best, host = d, w
        if host is None or best > (host.get('thick', 120) or 120) / 2.0 + 40.0:
            continue
        wl = math.hypot(host['x2'] - host['x1'], host['y2'] - host['y1'])
        wux, wuy = (host['x2'] - host['x1']) / wl, (host['y2'] - host['y1']) / wl
        t = (cx - host['x1']) * wux + (cy - host['y1']) * wuy
        left = t - half            # 開口の西/北側に残る壁
        right = wl - (t + half)    # 開口の東/南側に残る壁
        pocket = max(left, right)
        if pocket < it['w'] - 10:
            vio(out, it, '引き代が%.0fmmしかない(戸幅%.0fmm・壁 id=%s 長さ%.0fmm)。'
                '全開できない' % (pocket, it['w'], host.get('id', '?'), wl))
            continue
        # 戸が滑る側の壁面600mm帯に家具が立っていないか
        sign = 1.0 if right >= left else -1.0
        sx = cx + ux * sign * it['w']
        sy = cy + uy * sign * it['w']
        rect = {'x': sx - it['w'] / 2.0, 'y': sy - 300.0, 'w': it['w'], 'd': 600.0,
                'rot': it.get('rot', 0)}
        box = aabb(rect)
        hits = [f for f in furn if f.get('floor', 1) == floor
                and (f.get('elev') or 0) < 500
                and rects_intersect(aabb(f), box, 20.0)]
        if hits:
            vio(out, it, '戸が滑る壁面に %s がある(全開できない)'
                % ', '.join(sorted({label(f) for f in hits})))
    return out


def check25_swing_arc(data):
    """開き戸が実際に何度まで開くか。90度開けないものを違反にする。"""
    out = []
    furn = [f for f in data['items'] if is_furniture(f)]
    for it in data['items']:
        if it['type'] not in ('door-swing', 'door-swing-s', 'door-front'):
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        half = it['w'] / 2.0
        # 吊元は flipX 側の端、開く向きは flipY
        hs = -1.0 if not it.get('flipX') else 1.0
        hx, hy = cx + ux * half * hs, cy + uy * half * hs
        ss = 1.0 if not it.get('flipY') else -1.0
        others = [f for f in furn if f.get('floor', 1) == floor
                  and (f.get('elev') or 0) < 500]
        worst = 90.0
        blocker = None
        for deg in range(10, 95, 5):
            a = math.radians(deg)
            # 戸先の位置(吊元まわりに回す)
            dx = -ux * hs * math.cos(a) + vx * ss * math.sin(a)
            dy = -uy * hs * math.cos(a) + vy * ss * math.sin(a)
            # 戸板を薄い矩形として当たり判定
            mx, my = hx + dx * it['w'] / 2.0, hy + dy * it['w'] / 2.0
            leaf = {'x': mx - it['w'] / 2.0, 'y': my - 20.0, 'w': it['w'], 'd': 40.0,
                    'rot': math.degrees(math.atan2(dy, dx))}
            lb = aabb(leaf)
            hit = [f for f in others if rects_intersect(aabb(f), lb, 20.0)]
            if hit:
                worst = deg - 5
                blocker = hit[0]
                break
        if worst < 80:
            vio(out, it, '%d度までしか開かない(%s が当たる)'
                % (worst, label(blocker) if blocker else '?'))
    return out


_STORAGE_ROOM_WORDS = ('クローゼット', 'WIC', 'ウォークイン', '納戸', 'パントリー',
                       'シューズ', 'SIC', '収納', '押入', 'リネン', '物入')


def _in_shallow_storage(data, it):
    """短辺1200mm以下の収納室の中にあるか。"""
    cx, cy = center(it)
    for r in data.get('rooms', []):
        if r.get('floor', 1) != it.get('floor', 1):
            continue
        if not (r['x'] <= cx <= r['x'] + r['w'] and r['y'] <= cy <= r['y'] + r['d']):
            continue
        n = (r.get('n') or '')
        if any(k in n for k in _STORAGE_ROOM_WORDS) and min(r['w'], r['d']) <= 1200:
            return True
    return False


def check26_storage_facing(data, root=None):
    """収納家具の正面(rotの向き)が壁や物で塞がれていないか。

    扉・引き出しは正面へ開く。背面を室内に向けていると使えないし見た目も悪い。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}
    KEYS = ('Cabinet', 'CABINET', 'Shelf', 'Closet', 'Drawer', 'shelf', 'cabinet')
    for it in data['items']:
        t = it.get('type', '')
        if not any(k in t for k in KEYS):
            continue
        if (it.get('elev') or 0) >= 500:
            continue          # 吊り棚は対象外
        floor = it.get('floor', 1)
        # 短辺1200mm以下の収納室(押入れ・壁面クローゼット)の中身は対象外。
        # 中に立ち入らず、戸口の前に立って使う造りなので、棚の正面600mmは要らない
        if _in_shallow_storage(data, it):
            continue
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        # rot=0 は正面が北(-y)。ローカル -v 方向が正面
        need = 600.0
        fx, fy = cx - vx * (it['d'] / 2.0 + need / 2.0), cy - vy * (it['d'] / 2.0 + need / 2.0)
        rect = {'x': fx - it['w'] / 2.0, 'y': fy - need / 2.0, 'w': it['w'], 'd': need,
                'rot': it.get('rot', 0)}
        box = aabb(rect)
        hits = []
        for w in data.get('walls', []):
            if w.get('floor', 1) != floor:
                continue
            ht = (w.get('thick', 120) or 120) / 2.0
            wb = (min(w['x1'], w['x2']) - ht, min(w['y1'], w['y2']) - ht,
                  max(w['x1'], w['x2']) + ht, max(w['y1'], w['y2']) + ht)
            ox, oy = rect_overlap(wb, box)
            if ox > 30 and oy > 30:
                hits.append('壁 id=%s' % w.get('id', '?'))
        for f in data['items']:
            if f is it or f.get('floor', 1) != floor or not is_furniture(f):
                continue
            if (f.get('elev') or 0) >= 500:
                continue
            if rects_intersect(aabb(f), box, 30.0):
                hits.append(label(f))
        if hits:
            vio(out, it, '正面600mmが塞がれている(扉・引き出しが使えない): %s'
                % ', '.join(sorted(set(hits))[:4]))
    return out


def check27_operable_window(data):
    """開閉できる窓(sliding/casement)の室内側600mmに家具が立っていないか。"""
    out = []
    furn = [f for f in data['items'] if is_furniture(f)]
    rooms_by_floor = {}
    for r in data.get('rooms', []):
        rooms_by_floor.setdefault(r.get('floor', 1), []).append(r)
    for it in data['items']:
        if it['type'] != 'window':
            continue
        if (it.get('windowKind') or 'sliding') == 'fix':
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (_u), (vx, vy) = axes(it)[0], axes(it)[1]
        sill = it.get('windowSill') or 0
        for sign in (1, -1):
            px, py = cx + sign * vx * 300, cy + sign * vy * 300
            inside = any(px >= r['x'] and px <= r['x'] + r['w'] and
                         py >= r['y'] and py <= r['y'] + r['d']
                         for r in rooms_by_floor.get(floor, []))
            if not inside:
                continue
            bx = cx + sign * vx * 300
            by = cy + sign * vy * 300
            rect = {'x': bx - it['w'] / 2.0, 'y': by - 300.0, 'w': it['w'], 'd': 600.0,
                    'rot': it.get('rot', 0)}
            box = aabb(rect)
            head = sill + (it.get('windowHeight') or 0)
            hits = []
            for f in furn:
                if f.get('floor', 1) != floor:
                    continue
                if not rects_intersect(aabb(f), box, 20.0):
                    continue
                lo = f.get('elev') or 0
                hi = lo + _model_h(f)
                if hi <= sill + 100 or lo >= head:
                    continue      # 窓の開口高さと上下で干渉しない(腰窓下の机・欄間上のエアコン)
                if hi <= 1400:
                    continue      # 手を伸ばして越えられる高さ(机・ベッド・カウンター)
                hits.append(f)
            if hits:
                vio(out, it, '室内側600mmに %s があり開閉できない'
                    % ', '.join(sorted({label(f) for f in hits})))
    return out


_H_CACHE = {}


def _model_h(o):
    t = o.get('type', '')
    if t == 'custom-block':
        return o.get('customHeight') or 900
    if not _H_CACHE:
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
        _H_CACHE.update(_load_catalog(root) or {'': (0, 0, 0)})
    v = _H_CACHE.get(t)
    return (v[2] or 0) if v else 700


def check28_curtain_fit(data, root=None):
    """カーテンが対応する窓と幅・高さで整合しているか。"""
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}
    wins = [w for w in data['items'] if w['type'] in ('window', 'window-door')]
    curtains = [c for c in data['items'] if is_window_dressing(c.get('type', ''))]
    # 窓ごとにカーテンをまとめる(掃き出し窓は2枚吊ることがある)
    by_win = {}
    for c in curtains:
        cx, cy = center(c)
        best, bd = None, 1e9
        for w in wins:
            if w.get('floor', 1) != c.get('floor', 1):
                continue
            wx, wy = center(w)
            d = math.hypot(wx - cx, wy - cy)
            if d < bd:
                best, bd = w, d
        if best is None or bd > 1500:
            vio(out, c, '対応する窓が見つからない(最寄り %.0fmm)' % bd)
            continue
        by_win.setdefault(id(best), (best, []))[1].append(c)
    for _k, (w, cs) in by_win.items():
        total = sum(c['w'] for c in cs)
        if total < w['w'] - 20:
            vio(out, cs[0], '窓(幅%.0fmm)に対しカーテン合計%.0fmmで足りない'
                '(左右%.0fmmずつガラスが出る)'
                % (w['w'], total, (w['w'] - total) / 2.0))
        elif total > w['w'] * 2.1:
            vio(out, cs[0], '窓(幅%.0fmm)に対しカーテン合計%.0fmmで過大'
                % (w['w'], total))
        wc = center(w)
        gc = (sum(center(c)[0] for c in cs) / len(cs),
              sum(center(c)[1] for c in cs) / len(cs))
        if math.hypot(gc[0] - wc[0], gc[1] - wc[1]) > 300:
            vio(out, cs[0], 'カーテンの中心が窓の中心から%.0fmmずれている'
                % math.hypot(gc[0] - wc[0], gc[1] - wc[1]))
        sill = w.get('windowSill') or 0
        top = sill + (w.get('windowHeight') or 0)
        for c in cs:
            h = (cat.get(c['type']) or (0, 0, 0))[2] or 0
            e = c.get('elev') or 0
            if e + h < top - 20:
                vio(out, c, 'カーテン上端%.0fmmが窓上端%.0fmmに届いていない'
                    % (e + h, top))
            if sill > 300 and e < sill - 400:
                vio(out, c, '腰窓(窓台%.0fmm)に床丈のカーテンが掛かっている'
                    '(下端%.0fmm)' % (sill, e))
    return out


# ---------------------------------------------------------------- メイン

# rot は「正面が向く方角」。向きの付け間違いは3Dを回して眺めるまで気付けず、
# 目視レビューでは必ず取りこぼす(実際、壁を向いたデスクとモニタ、道路に背を
# 向けた隣家、家の壁へ吹き付ける室外機を同時に見落とした)。機械で見る。
FRONTED_TYPES = (
    'washer', 'fmp-Refrigerator', 'fmp-Toilet', 'fmp-WashBasin',
    'fmp-BathroomVanity', 'fmp-GasStove', 'fmp-Bed', 'fmp-Sofa', 'fmp-Chair',
    'fmp-Table', 'fmp-AirConditionerWall', 'ac-outdoor', 'neighbor-house',
    'Tv-MEGA', 'Sofa', 'Chair', 'Table-MEGA', 'Tableset', 'Shelf-MEGA',
    'Cabinet-MEGA', 'CABINET', 'Closet', 'Mirror-MEGA', 'Painting-MEGA',
    'Desk', 'Kitchen-MEGA',
)
# 背面を必ず壁(または屋外なら建物)に付ける物。付いていないと宙に浮く
WALL_BACKED_TYPES = (
    'fmp-AirConditionerWall', 'Mirror-MEGA', 'Painting-MEGA', 'Shelf-MEGA',
    'Cabinet-MEGA', 'CABINET', 'Closet', 'fmp-Toilet', 'washer',
    'fmp-Refrigerator',
)


def _front_dir(it):
    """正面の向き(単位ベクトル)。rot=0 は北(-y)。"""
    th = math.radians(it.get('rot', 0) or 0)
    return (math.sin(th), -math.cos(th))


def _wall_boxes(data, floor):
    out = []
    for w in data.get('walls', []):
        if w.get('floor', 1) != floor:
            continue
        t = (w.get('thick', 120) or 120) / 2.0
        out.append((min(w['x1'], w['x2']) - t, min(w['y1'], w['y2']) - t,
                    max(w['x1'], w['x2']) + t, max(w['y1'], w['y2']) + t,
                    w.get('id', '?')))
    return out


def _opening_boxes(data, floor, z0, z1):
    """建具の外接矩形のうち、高さ z0..z1 と重なるものだけ。

    高さを見ないと、窓と同じ平面位置にある壁掛けエアコン(FL+2050)まで
    「壁が無い」と判定してしまう。窓は 1200-2030 にしか開いていない。
    """
    out = []
    for it in data['items']:
        t = it.get('type', '')
        if it.get('floor', 1) != floor:
            continue
        if t.startswith('door-'):
            a, b = 0.0, float(it.get('doorHeight') or 2000)
        elif t.startswith('window'):
            a = float(it.get('windowSill') or 0)
            b = a + float(it.get('windowHeight') or 1300)
        else:
            continue
        if b <= z0 or a >= z1:
            continue
        out.append(aabb(it))
    return out


def _wall_at(boxes, px, py, openings=None):
    for x0, y0, x1, y1, wid in boxes:
        if x0 <= px <= x1 and y0 <= py <= y1:
            if openings and any(a[0] <= px <= a[2] and a[1] <= py <= a[3]
                                for a in openings):
                return None      # 建具の位置は壁が抜けている
            return wid
    return None


def _is_on_furniture(it, data):
    """他の家具の天板に載っているか。載っている物に壁付けを求めても意味が無い。

    洗面台の上の洗面ボウル、デスクの上のモニタが該当する。elev がその家具の
    高さとほぼ一致し、平面でほぼ収まっていれば「載っている」と見なす。
    """
    elev = it.get('elev') or 0
    if elev <= 0:
        return False
    box = aabb(it)
    area = max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
    for f in data['items']:
        if f is it or f.get('floor', 1) != it.get('floor', 1):
            continue
        top = (f.get('elev') or 0) + _catalog_height(f)
        if abs(top - elev) > 90:
            continue
        ox, oy = rect_overlap(aabb(f), box)
        if ox > 0 and oy > 0 and ox * oy > area * 0.5:
            return True
    return False


_HEIGHT_CACHE = {}


def _catalog_height(it):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    if 'cat' not in _HEIGHT_CACHE:
        _HEIGHT_CACHE['cat'] = _load_catalog(root) or {}
    h = it.get('customHeight')
    if isinstance(h, (int, float)) and h > 0:
        return float(h)
    got = _HEIGHT_CACHE['cat'].get(it.get('type'))
    return float(got[2]) if got and got[2] else 0.0


def _wall_dist(boxes, cx, cy, dx, dy, start, limit=4000.0, step=40.0,
               openings=None):
    """(cx,cy) から (dx,dy) 方向へ、家具の縁(start)より先で最初に当たる壁までの距離。"""
    d = start
    while d <= start + limit:
        if _wall_at(boxes, cx + dx * d, cy + dy * d, openings) is not None:
            return d - start
        d += step
    return None


def _proj_t(w, px, py):
    """点を壁のセンターラインへ射影したときの媒介変数 t と距離。"""
    dx, dy = w['x2'] - w['x1'], w['y2'] - w['y1']
    l2 = dx * dx + dy * dy
    if l2 < 1:
        return None, None
    t = ((px - w['x1']) * dx + (py - w['y1']) * dy) / l2
    tc = max(0.0, min(1.0, t))
    qx, qy = w['x1'] + dx * tc, w['y1'] + dy * tc
    return t, math.hypot(px - qx, py - qy)


def check32_wall_joint(data):
    """壁の継ぎ目が、相手のセンターラインにきちんと乗っているか。

    3Dの壁は芯から厚みの半分ずつ振り分けた箱として立つ。端点が相手の芯から
    数十mmずれていると、その分だけ箱が食い違い、交差部に段差やスリットが
    出る(いわゆる「ガタガタ」)。芯に乗っていれば必ず箱同士が重なるので、
    重なり量を目で確かめる必要が無くなる。

    どの壁にも接していない自由端は、L字の出隅など正しい場合があるので
    違反にしない。ここで見るのは「接しようとして外している」端点だけ。
    """
    out = []
    NEAR = 260.0        # これ以上離れていれば「接する気が無い端点」とみなす
    ON = 1.0            # 芯に乗っているとみなす許容
    for w in data.get('walls', []):
        for lbl, (px, py) in (('始端', (w['x1'], w['y1'])),
                              ('終端', (w['x2'], w['y2']))):
            best = None
            for o in data['walls']:
                if o is w or o.get('floor', 1) != w.get('floor', 1):
                    continue
                t, dist = _proj_t(o, px, py)
                if dist is None or dist > NEAR:
                    continue
                if t < -0.05 or t > 1.05:
                    continue
                if best is None or dist < best[0]:
                    best = (dist, o.get('id', '?'))
            if best and best[0] > ON:
                out.append('[%dF] 壁 %s の%s (%.0f,%.0f) が壁 %s の芯から '
                           '%.0fmm ずれている(交差部に段差が出る)'
                           % (w.get('floor', 1), w.get('id', '?'), lbl,
                              px, py, best[1], best[0]))
    return out


CEILING_FINISH_MM = 12.0    # index.html の CEILING_FINISH_M と同じ


def ceiling_finish_mm(data, floor, cx, cy):
    """天井仕上げ面の高さ(mm)。**その階の床仕上げ面から測る** = elev と同じ基準。

    アプリ(ceilingFinishElevationMm)・生成器(ceiling_elev)と同じ式。
    3つの基準が食い違っていたのが「照明が天井から浮く / 天井裏に埋まる」原因
    だったので、式は3か所に同じものを置き、この検査で結果を突き合わせる。
    """
    slab = 0.0 if floor <= 1 else float(FLOOR_SLAB_MM)
    r = room_at(data, floor, cx, cy)
    h = float(FLOOR_H_MM)
    if r is not None:
        c = r.get('ceiling') or {}
        if c.get('type') == 'void':
            to = c.get('toFloor')
            to = int(to) if isinstance(to, (int, float)) else floor + 1
            h = (max(floor + 1, to) - floor + 1) * float(FLOOR_H_MM)
    return h - slab - CEILING_FINISH_MM


# 天井に固定する器具。値は「取付面(elev)からモデル上端までの高さ(mm)」。
# 照明は elev が取付面そのものなので0。モデルは底面が elev なのでモデル高。
CEILING_FIXTURES = {
    'light-ceiling': 0.0,
    'light-down': 0.0,
    'light-spot': 0.0,
    'fmp-CeilingFan01': 350.0,
}


def check33_light_mount(data):
    """天井付けの器具が、実際に天井仕上げ面に付いているか。

    既定プランは全灯 elev=2380 の一律で、1階は308mm浮き、2階は124mm浮いていた。
    アプリの既定値(wallFullHeightM-160)も1階148mm低く2階32mm高かった。
    どちらも「どの高さを基準に測るか」の取り違えで、目で見て気付くのは難しい。
    屋外(部屋の外)の器具は軒下などに付くので対象外。
    """
    out = []
    TOL = 3.0
    for it in data['items']:
        top_off = CEILING_FIXTURES.get(it.get('type'))
        if top_off is None:
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        if room_at(data, floor, cx, cy) is None:
            continue                      # 屋外(ポーチ等)は天井が無い
        want = ceiling_finish_mm(data, floor, cx, cy)
        top = float(it.get('elev') or 0) + top_off
        if abs(top - want) > TOL:
            vio(out, it, '天井仕上げ面 %.0fmm に対し器具の上端が %.0fmm '
                         '(%+.0fmm ずれて%s)'
                % (want, top, top - want, '浮いている' if top < want else '埋まっている'))
    return out


# ────────────────────────────────────────────────────────────────
# 住まい方の検査 (34〜38)
#
# 33項目までは「幾何が壊れていないか」しか見ていなかった。壊れていなくても
# 住みにくい間取りは通ってしまう。実際の後悔事例(出典は docs/quality-team.md
# 「住まい方の設計規則」)のうち、機械で判定できるものを規則にする。
# ────────────────────────────────────────────────────────────────

PUBLIC_ROOMS = ('玄関', 'ホール', 'LDK', 'リビング', 'ダイニング', '客間')
PRIVATE_ROOMS = ('主寝室', '寝室', '洋室', '子供部屋', '子ども部屋', '書斎')
WET_ROOMS = ('トイレ', '浴室', '洗面脱衣室', 'ランドリー', '洗面所')
LIVING_ROOMS = ('LDK', 'リビング', 'ダイニング', '主寝室', '寝室', '洋室',
                '子供部屋', '子ども部屋', '書斎', 'キッチン')


def _fwd(it):
    """正面の向き(単位ベクトル)。rot=0 は北(-y)。"""
    r = math.radians(it.get('rot', 0) or 0)
    return (math.sin(r), -math.cos(r))


def check34_entry_sightline(data):
    """玄関を開けたとき、居室や水まわりまで一直線に見通せてしまわないか。

    「リビングや洗面室のドアを玄関と一直線に配置すると、閉め忘れた時に
    玄関から中が丸見え」という後悔事例。玄関からホールが見えるのは
    上り框の開口そのものなので当たり前 -- **見通した先の部屋の役割**で判る。
    """
    out = []
    STEP, REACH = 80.0, 12000.0
    EXPOSED = ('LDK', 'リビング', 'ダイニング', '洗面', '浴室', 'トイレ',
               'ランドリー', '寝室', '洋室', '書斎', 'キッチン')
    for door in data['items']:
        if door.get('type') != 'door-front':
            continue
        floor = door.get('floor', 1)
        cx, cy = center(door)
        # 室内の向きは rot から決めつけない。玄関ドアの rot=0 は正面が
        # **室内**を向く(実測)ので、-fwd を室内とした最初の実装は常に屋外へ
        # 光線を飛ばし、何があっても0件を返す死んだ検査だった。
        # 部屋が在る側を室内とする。
        fx, fy = _fwd(door)
        ix, iy = fx, fy
        if room_at(data, floor, cx + fx * 800, cy + fy * 800) is None:
            ix, iy = -fx, -fy
        if room_at(data, floor, cx + ix * 800, cy + iy * 800) is None:
            continue                 # どちら側にも部屋が無い(判定不能)
        walls = [w for w in data.get('walls', []) if w.get('floor', 1) == floor
                 and (w.get('thick', 120) or 120) >= 120]
        holes = [aabb(o) for o in data['items']
                 if o.get('floor', 1) == floor
                 and o.get('type') in DOOR_TYPES and o.get('type') != 'window']
        d, seen = 200.0, []
        while d <= REACH:
            px, py = cx + ix * d, cy + iy * d
            blocked = False
            for w in walls:
                ht = (w.get('thick', 120) or 120) / 2.0
                if (min(w['x1'], w['x2']) - ht <= px <= max(w['x1'], w['x2']) + ht
                        and min(w['y1'], w['y2']) - ht <= py <= max(w['y1'], w['y2']) + ht):
                    # 建具の位置なら壁は抜けている(開けっ放しなら見通せる)
                    if not any(b[0] <= px <= b[2] and b[1] <= py <= b[3] for b in holes):
                        blocked = True
                    break
            if blocked:
                break
            r = room_at(data, floor, px, py)
            if r is not None:
                nm = (r.get('n') or '').strip()
                if nm and nm not in seen:
                    seen.append(nm)
            d += STEP
        hit = [n for n in seen if any(k in n for k in EXPOSED)]
        if hit:
            vio(out, door, '開けると %s まで一直線に見通せる(経路: %s)。'
                           '建具を閉め忘れると中が丸見えになる'
                % ('・'.join(hit), ' → '.join(seen)))
    return out


def check35_wet_room_over_bedroom(data):
    """トイレ・浴室の直下が寝室やリビングになっていないか(排水音)。

    「トイレをリビングや寝室の上に設置すると、下階に音が響いて眠りを妨げる」。
    平面が重なっているかどうかだけで判定できる。
    """
    out = []
    for r in data.get('rooms', []):
        name = (r.get('n') or '').strip()
        if not any(k in name for k in ('トイレ', '浴室')):
            continue
        fl = r.get('floor', 1)
        if fl <= 1:
            continue
        for o in data.get('rooms', []):
            if o.get('floor', 1) != fl - 1:
                continue
            oname = (o.get('n') or '').strip()
            if not any(k in oname for k in ('寝室', 'リビング', 'LDK', '洋室')):
                continue
            ox = min(r['x'] + r['w'], o['x'] + o['w']) - max(r['x'], o['x'])
            oy = min(r['y'] + r['d'], o['y'] + o['d']) - max(r['y'], o['y'])
            if ox > 300 and oy > 300:
                out.append('[%dF] %s の直下が %dF %s (%.0f×%.0fmm 重なり)。'
                           '排水音が寝室・居室へ落ちる'
                           % (fl, name, fl - 1, oname, ox, oy))
    return out


def check36_work_triangle(data):
    """キッチンのシンク・コンロ・冷蔵庫を結ぶ三角形の三辺合計。

    3600〜6000mm が使いやすいとされる目安。短すぎると2人で立てず、
    長すぎると調理のたびに歩かされる。
    """
    out = []
    KEYS = {'sink': 'CabinetD_Sink', 'stove': 'GasStove', 'fridge': 'Refrigerator'}
    by_floor = {}
    for it in data['items']:
        for role, frag in KEYS.items():
            if frag in it.get('type', ''):
                by_floor.setdefault(it.get('floor', 1), {}).setdefault(role, []).append(it)
    for floor, roles in sorted(by_floor.items()):
        if len(roles) < 3:
            continue
        pts = {k: center(v[0]) for k, v in roles.items()}
        per = 0.0
        legs = []
        keys = list(pts)
        for i in range(len(keys)):
            a, b = pts[keys[i]], pts[keys[(i + 1) % len(keys)]]
            dist = math.hypot(a[0] - b[0], a[1] - b[1])
            legs.append('%s-%s %.0f' % (keys[i], keys[(i + 1) % len(keys)], dist))
            per += dist
        if per < 3600 or per > 6000:
            out.append('[%dF] ワークトライアングルの三辺合計 %.0fmm '
                       '(目安 3600〜6000)。%s'
                       % (floor, per, ' / '.join(legs)))
    return out


def _walls_cover_edge(data, floor, ax, ay, bx, by, frac=0.6):
    """線分 (ax,ay)-(bx,by) の上に、長さの frac 以上を覆う壁があるか。"""
    total = math.hypot(bx - ax, by - ay)
    if total <= 1:
        return True
    horiz = abs(by - ay) < 1
    lo, hi = (min(ax, bx), max(ax, bx)) if horiz else (min(ay, by), max(ay, by))
    spans = []
    for w in data.get('walls', []):
        if w.get('floor', 1) != floor:
            continue
        ht = (w.get('thick', 120) or 120) / 2.0
        if horiz:
            if abs(w['y1'] - w['y2']) > 1 or abs((w['y1'] + w['y2']) / 2.0 - ay) > ht:
                continue
            a, b = min(w['x1'], w['x2']), max(w['x1'], w['x2'])
        else:
            if abs(w['x1'] - w['x2']) > 1 or abs((w['x1'] + w['x2']) / 2.0 - ax) > ht:
                continue
            a, b = min(w['y1'], w['y2']), max(w['y1'], w['y2'])
        a, b = max(a, lo), min(b, hi)
        if b > a:
            spans.append((a, b))
    spans.sort()
    covered, cur = 0.0, None
    for a, b in spans:
        if cur is None or a > cur[1]:
            if cur:
                covered += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        covered += cur[1] - cur[0]
    return covered >= total * frac


def _open_space(data, floor, seed_rects, min_open=900.0):
    """壁で仕切られていない隣室をたどって、ひと続きの空間の矩形を集める。"""
    rooms = [r for r in data.get('rooms', []) if r.get('floor', 1) == floor]
    group = list(seed_rects)
    changed = True
    while changed:
        changed = False
        for o in rooms:
            if any(o is g for g in group):
                continue
            for g in group:
                # 縦の共有辺
                for a, b in ((g, o), (o, g)):
                    if abs(a['x'] + a['w'] - b['x']) < 1:
                        lo = max(a['y'], b['y']); hi = min(a['y'] + a['d'], b['y'] + b['d'])
                        if hi - lo >= min_open and not _walls_cover_edge(
                                data, floor, b['x'], lo, b['x'], hi):
                            group.append(o); changed = True; break
                    if abs(a['y'] + a['d'] - b['y']) < 1:
                        lo = max(a['x'], b['x']); hi = min(a['x'] + a['w'], b['x'] + b['w'])
                        if hi - lo >= min_open and not _walls_cover_edge(
                                data, floor, lo, b['y'], hi, b['y']):
                            group.append(o); changed = True; break
                else:
                    continue
                break
            if changed:
                break
    return group


def check37_room_windows(data):
    """居室に窓が足りているか。

    「窓が少ないと室内が暗く風通しが悪い。理想は1部屋に2カ所」。
    8㎡(約5帖)以上の居室は2カ所以上、それ未満は1カ所以上を要求する。
    """
    out = []
    seen = set()
    for r in data.get('rooms', []):
        name = (r.get('n') or '').strip()
        if not any(name == k or name.startswith(k) for k in LIVING_ROOMS):
            continue
        fl = r.get('floor', 1)
        if (fl, name) in seen:
            continue
        seen.add((fl, name))
        named = [o for o in data['rooms']
                 if o.get('floor', 1) == fl and (o.get('n') or '').strip() == name]
        area = sum(o['w'] * o['d'] for o in named) / 1e6
        # 壁で仕切られていない隣室は同じ空間。そこに射す光はこの部屋にも届く
        rects = _open_space(data, fl, named)
        # 吹き抜けの部屋は、その吹き抜けの真上に開いた高窓も自分の窓
        voids = []
        for o in rects:
            c = o.get('ceiling') or {}
            if c.get('type') == 'void':
                voids.append((o, set(range(fl + 1, int(c.get('toFloor') or fl) + 1))))

        def _in(o, cx, cy):
            # 窓は壁の中に居るので、部屋の縁から少し内側/外側の余裕を見る
            return (o['x'] - 150 <= cx <= o['x'] + o['w'] + 150
                    and o['y'] - 150 <= cy <= o['y'] + o['d'] + 150)

        n = 0
        for it in data['items']:
            if it.get('type') not in ('window', 'window-door'):
                continue
            wf = it.get('floor', 1)
            cx, cy = center(it)
            if wf == fl:
                if any(_in(o, cx, cy) for o in rects):
                    n += 1
            elif any(wf in fs and _in(o, cx, cy) for o, fs in voids):
                n += 1
        need = 2 if area >= 8.0 else 1
        if n < need:
            out.append('[%dF] %s (%.1f㎡) の窓が %d カ所。%d カ所以上ほしい'
                       '(採光と通風は対角に2カ所が目安)' % (fl, name, area, n, need))
    return out


def check38_laundry_to_drying(data):
    """洗濯機から干す場所までが遠すぎないか。

    「洗濯機とベランダが遠い」は家事動線の代表的な後悔。
    干す場所はバルコニーか、室内干しの部屋(ランドリー等)とみなす。
    階をまたぐ場合は濡れた洗濯物を持って階段を上ることになる。
    """
    out = []
    washers = [i for i in data['items'] if i.get('type') == 'washer']
    if not washers:
        return out
    spots = []
    for i in data['items']:
        if i.get('type') == 'balcony':
            spots.append((i.get('floor', 1), center(i), 'バルコニー'))
    for r in data.get('rooms', []):
        nm = (r.get('n') or '').strip()
        if any(k in nm for k in ('ランドリー', '物干', 'サンルーム')):
            spots.append((r.get('floor', 1), (r['x'] + r['w'] / 2, r['y'] + r['d'] / 2), nm))
    if not spots:
        out.append('干す場所(バルコニー・ランドリー)がプランに無い')
        return out
    for wsh in washers:
        wf = wsh.get('floor', 1)
        wc = center(wsh)
        same = [(math.hypot(wc[0] - c[0], wc[1] - c[1]), nm)
                for (f, c, nm) in spots if f == wf]
        if same:
            dist, nm = min(same)
            if dist > 8000:
                vio(out, wsh, '同じ階の干し場(%s)まで %.0fmm。遠すぎる' % (nm, dist))
        else:
            near = min((abs(f - wf), nm) for (f, c, nm) in spots)
            vio(out, wsh, '同じ階に干す場所が無い(最寄りは %d階違いの %s)。'
                          '濡れた洗濯物を持って階段を上ることになる' % (near[0], near[1]))
    return out


# 対で使う家具。(自分の断片, 相手の断片, 届く距離mm, 説明)
# 「ソファはテレビを向く」のような **関係** は、壁との距離では表せない。
# check30 はソファを180度回しても壁から離れていれば通してしまう。
PAIRED_FACING = [
    ('Sofa', 'Tv-MEGA', 8000, 'ソファはテレビを向く'),
    ('Tv-MEGA', 'Sofa', 8000, 'テレビはソファを向く'),
    ('Chair', 'Table', 2500, '椅子は机・食卓を向く'),
]


def check39_paired_facing(data):
    """対で使う家具が互いを向いているか。

    ソファがテレビに背を向けている、椅子が机に背を向けている、という
    「180度逆」は、壁から離れていれば check30 を素通りする。
    相手との位置関係で見る。
    """
    out = []
    COS = 0.35          # 正面から約70度以内なら「向いている」とみなす
    for it in data['items']:
        t = it.get('type', '')
        for mine, theirs, reach, why in PAIRED_FACING:
            if mine not in t:
                continue
            cx, cy = center(it)
            best = None
            for o in data['items']:
                if o is it or o.get('floor', 1) != it.get('floor', 1):
                    continue
                if theirs not in o.get('type', ''):
                    continue
                ox, oy = center(o)
                dist = math.hypot(ox - cx, oy - cy)
                if dist > reach:
                    continue
                if best is None or dist < best[0]:
                    best = (dist, o, ox, oy)
            if best is None:
                continue
            dist, o, ox, oy = best
            if dist < 1.0:
                continue
            fx, fy = _fwd(it)
            ux, uy = (ox - cx) / dist, (oy - cy) / dist
            dot = fx * ux + fy * uy
            if dot < COS:
                deg = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
                vio(out, it, '%s: %s は %.0fmm 先だが、正面は %.0f度ずれている'
                             '(rot=%s)。180度逆に置いていないか'
                    % (why, label(o), dist, deg, it.get('rot', 0)))
    return out


def check30_facing_wall(data):
    """家具の正面が、すぐ目の前の壁にぶつかっていないか。

    「正面が壁から400mm以内」だけで判定すると、910モジュールのトイレに置いた
    手洗いのように**部屋が狭いだけ**の物まで挙がる。向きの付け間違いは
    「背中を向けるべき壁に顔を向けている」状態なので、
      正面までの距離 < 背面までの距離
    を条件に加える。これで、狭い部屋の正しい配置は通り、裏返しだけが残る。
    """
    out = []
    NEED = 400.0
    for it in data['items']:
        t = it.get('type', '')
        if not any(k in t for k in FRONTED_TYPES):
            continue
        boxes = _wall_boxes(data, it.get('floor', 1))
        z0 = float(it.get('elev') or 0)
        holes = _opening_boxes(data, it.get('floor', 1), z0,
                               z0 + max(200.0, _catalog_height(it)))
        cx, cy = center(it)
        fx, fy = _front_dir(it)
        half = it['d'] / 2.0
        front = _wall_dist(boxes, cx, cy, fx, fy, half, NEED, openings=holes)
        if front is None:
            continue
        back = _wall_dist(boxes, cx, cy, -fx, -fy, half, openings=holes)
        if back is not None and back <= front:
            continue                     # 背中側の方が壁に近い = 向きは正しい
        vio(out, it, '正面が %.0fmm先の壁にぶつかっている(背面側は%s)。'
                     'rot=%s の付け間違いを疑う'
            % (front, ('%.0fmm' % back) if back is not None else '壁なし',
               it.get('rot', 0)))
    # 屋外機は建物(=基礎の外形)へ吹き付けていないか
    found = [i for i in data['items'] if i.get('type') == 'foundation']
    for it in data['items']:
        if it.get('type') != 'ac-outdoor':
            continue
        cx, cy = center(it)
        fx, fy = _front_dir(it)
        for f in found:
            b = aabb(f)
            for dist in (it['d'] / 2.0 + 60, it['d'] / 2.0 + 400):
                px, py = cx + fx * dist, cy + fy * dist
                if b[0] <= px <= b[2] and b[1] <= py <= b[3]:
                    vio(out, it, '吹き出しが建物側を向いている(rot=%s)'
                        % it.get('rot', 0))
                    break
            else:
                continue
            break
    return out


def check31_wall_mounted_gap(data):
    """壁付けの家具が、背面を壁に付けているか。

    棚やキャビネットが部屋の真ん中に浮いていると、間取りとして意味を成さない。
    壁の欠落を見つける手段でもある(実際、書斎の東側に壁が1枚抜けていて、
    そこに置いた飾り棚が開口の中に立っているのをこれで見つけた)。
    """
    out = []
    GAP = 120.0
    for it in data['items']:
        t = it.get('type', '')
        if not any(k in t for k in WALL_BACKED_TYPES):
            continue
        if _is_on_furniture(it, data):
            continue                       # 天板の上の物は壁に付かない
        floor = it.get('floor', 1)
        boxes = _wall_boxes(data, floor)
        cx, cy = center(it)
        fx, fy = _front_dir(it)
        back = it['d'] / 2.0
        hit = None
        for dist in (back + 10, back + GAP / 2, back + GAP):
            hit = _wall_at(boxes, cx - fx * dist, cy - fy * dist)
            if hit is not None:
                break
        if hit is None:
            vio(out, it, '背面が壁から %.0fmm 以上離れている'
                         '(壁の抜けか、置き場所の間違い)' % GAP)
    return out


def check29_void_guard(data):
    """吹き抜けの縁に、落下を止める壁か手すりがあるか。

    上階の床が切れる縁は、そのままだと人が落ちる。壁で塞ぐと2層の抜けが
    死ぬので balcony-fence(手すり壁)でよいが、何も無いのは駄目。
    宣言した吹き抜けと、階段の直上(アプリが自動で床を抜く)の両方を見る。
    """
    out = []
    STEP, REACH, TOL = 100.0, 200.0, 90.0
    holes = []          # (rect, floor, ラベル)
    for r in data.get('rooms', []):
        c = r.get('ceiling') or {}
        if c.get('type') != 'void':
            continue
        frm = r.get('floor', 1)
        to = c.get('toFloor')
        to = int(to) if isinstance(to, (int, float)) else frm + 1
        for f in range(frm + 1, max(frm + 1, to) + 1):
            holes.append(((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['d']),
                          f, '%d階の吹き抜け' % frm, r))
    for it in data.get('items', []):
        if it.get('type') not in ('stair', 'stair-corner'):
            continue
        b = aabb(it)
        up = it.get('floor', 1) + 1
        # 3階建て以上では階段を同じ位置に積む。続きの階段が井戸を占めている
        # 階では、床の代わりにその階段自体が立っており、落下する縁は無い
        # (縁が生まれるのは一番上の階だけで、それは次の周回で見る)。
        covered = any(
            o.get('type') in ('stair', 'stair-corner')
            and o.get('floor', 1) == up
            and rect_overlap(aabb(o), b)[0] > it['w'] * 0.8
            and rect_overlap(aabb(o), b)[1] > it['d'] * 0.8
            for o in data.get('items', []))
        if not covered:
            holes.append((b, up, '階段の吹き抜け', it))
    # 階段は上りきった側が必ず開いていないと降り口にならない。その1辺ぶんは
    # 手すりが無くて当然なので、階段の有効幅までは許す。
    allow = {}
    for it in data.get('items', []):
        if it.get('type') in ('stair', 'stair-corner'):
            allow[id(it)] = min(it['w'], it['d']) + 120.0

    for (box, floor, label, ref) in holes:
        x0, y0, x1, y1 = box
        walls = [w for w in data.get('walls', []) if w.get('floor', 1) == floor]
        rooms = [r for r in data.get('rooms', []) if r.get('floor', 1) == floor]
        edges = [((x0, y0), (x1, y0), (0.0, -1.0)), ((x0, y1), (x1, y1), (0.0, 1.0)),
                 ((x0, y0), (x0, y1), (-1.0, 0.0)), ((x1, y0), (x1, y1), (1.0, 0.0))]
        open_len = 0.0
        for (ax, ay), (bx, by), (nx, ny) in edges:
            length = math.hypot(bx - ax, by - ay)
            if length < 1.0:
                continue
            ux, uy = (bx - ax) / length, (by - ay) / length
            n = max(1, int(length / STEP))
            for i in range(n + 1):
                px, py = ax + ux * i * STEP, ay + uy * i * STEP
                qx, qy = px + nx * REACH, py + ny * REACH
                # 外側に床が無ければ落ちようがない(吹き抜けが続いている)
                if not any(r['x'] <= qx <= r['x'] + r['w'] and
                           r['y'] <= qy <= r['y'] + r['d'] for r in rooms):
                    continue
                guarded = False
                for w in walls:
                    ht = (w.get('thick', 120) or 120) / 2.0 + TOL
                    if (min(w['x1'], w['x2']) - ht <= px <= max(w['x1'], w['x2']) + ht and
                            min(w['y1'], w['y2']) - ht <= py <= max(w['y1'], w['y2']) + ht):
                        guarded = True
                        break
                if not guarded:
                    open_len += STEP
        if open_len >= max(300.0, allow.get(id(ref), 0.0)):
            vio(out, ref, '%s の縁 %.0fmm に手すりも壁も無い(%d階の床がその外にある)'
                % (label, open_len, floor))
    return out


# ── 40〜43: 「lintが0件でも実物に残っていた粗」を拾う ───────────────
def _item_height(it, cat):
    h = (cat.get(it.get('type')) or (0, 0, 0))[2]
    if h:
        return h
    return it.get('customHeight') or ITEM_FALLBACK_H.get(it.get('type'), 900)


ITEM_FALLBACK_H = {'washer': 900, 'custom-block': 900, 'tree': 1500}


def check40_window_face_blocked(data, root=None):
    """窓の見付け(ガラス面の矩形)に、物が掛かっていないか。

    27は「窓を開けるために手が届くか」を見る検査で、**窓と同じ壁面に物を
    掛けてしまう**事故は素通りする。洗面の鏡を窓の上に重ねる、トイレの棚を
    窓の前に吊る、玄関の下駄箱で採光窓を塞ぐ -- どれも実際にやった。
    窓の内側400mm以内にあって、高さが窓の開口と重なる物を違反にする。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}
    for wn in data['items']:
        if wn.get('type') not in ('window', 'window-door'):
            continue
        floor = wn.get('floor', 1)
        sill = wn.get('windowSill') or 0
        top = sill + (wn.get('windowHeight') or 0)
        if top <= sill:
            continue
        cx, cy = center(wn)
        (ux, uy), (vx, vy) = axes(wn)
        for sign in (1, -1):
            # 部屋がある側だけを見る(屋外側はデッキ・室外機の定位置)
            if room_at(data, floor, cx + vx * sign * 500, cy + vy * sign * 500) is None:
                continue
            zx, zy = cx + vx * sign * 200, cy + vy * sign * 200
            zone = {'x': zx - wn['w'] / 2.0, 'y': zy - 200.0,
                    'w': wn['w'], 'd': 400.0, 'rot': wn.get('rot', 0)}
            zb = aabb(zone)
            hits = []
            for f in data['items']:
                if f is wn or f.get('floor', 1) != floor or not is_furniture(f):
                    continue
                e = f.get('elev') or 0
                h = _item_height(f, cat)
                if e + h <= sill + 50 or e >= top - 50:
                    continue          # 窓台より下 / 窓の上 = 見付けに掛からない
                if min(e + h, top) - max(e, sill) < 150:
                    continue          # 高さ方向の掛かりが浅い
                ox, oy = rect_overlap(aabb(f), zb)
                span = max(ox, oy) if wn['w'] > wn['d'] else min(ox, oy)
                # 幅方向の掛かり。机上のランプのような小物までは咎めない
                if ox <= 60 or oy <= 60:
                    continue
                span = ox if abs(ux) > abs(uy) else oy
                if span < min(400.0, wn['w'] * 0.25):
                    continue
                hits.append('%s(高さ%.0f-%.0f・幅%.0fmm)'
                            % (label(f), e, e + h, span))
            if hits:
                vio(out, wn, '窓の見付け(台%.0f-%.0fmm)を塞いでいる: %s'
                    % (sill, top, ', '.join(sorted(hits))))
    return out


def check41_wall_across_opening(data):
    """開口(窓を含む)を、直交する壁が横切っていないか。

    20は建具だけを見て窓を外し、しかも壁の**端点**しか見ていなかった。
    そのため「間仕切り壁が窓の真ん中に取り付く」形を素通りした。
    開口の端で突き合う壁(=開口の見込みを作る壁)は正しいので、
    **芯線が開口スパンの内側に入っているもの**だけを違反にする。
    """
    out = []
    for it in data['items']:
        if it.get('type') not in DOOR_TYPES:
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (ux, uy), _ = axes(it)
        half = it['w'] / 2.0
        ax, ay = cx - ux * half, cy - uy * half
        for w in data.get('walls', []):
            if w.get('floor', 1) != floor:
                continue
            ht = (w.get('thick', 120) or 120) / 2.0
            ts, ps = [], []
            for ex, ey in ((w['x1'], w['y1']), (w['x2'], w['y2'])):
                ts.append((ex - ax) * ux + (ey - ay) * uy)
                ps.append(-(ex - ax) * uy + (ey - ay) * ux)
            # 開口と同じ線に乗っている壁(=開口を持つ親壁)は対象外
            if abs(ps[0]) <= ht + 30 and abs(ps[1]) <= ht + 30:
                continue
            # 開口の線に届いていない壁は対象外
            if min(abs(ps[0]), abs(ps[1])) > ht + 30 and ps[0] * ps[1] > 0:
                continue
            # **芯線**が開口スパンの内側にどれだけ入っているか。
            # 直交する壁は開口の線に「点」で投影されるので、区間長ではなく
            # 開口の端からの距離で見る(区間長で見ると常に0になり素通りする)
            lo, hi = min(ts), max(ts)
            if hi - lo < 30.0:
                t = (lo + hi) / 2.0
                inside = min(t, it['w'] - t)
                if t <= 30.0 or t >= it['w'] - 30.0:
                    inside = 0.0
            else:
                inside = min(hi, it['w'] - 30.0) - max(lo, 30.0)
            if inside > 30.0:
                vio(out, it, '開口(幅%.0fmm)を壁 id=%s が横切っている'
                    '(開口の中に芯線が%.0fmm)' % (it['w'], w.get('id', '?'), inside))
                break
    return out


def check42_door_side_blocked(data, root=None):
    """建具の**片側**の前面が、背の高い物で塞がれていないか。

    2は「両側とも塞がれている」ときしか出さない。押入れの中に棚があるのは
    正しいので両側判定にしたのだが、そのせいで「玄関ドアの正面に鉢」
    「寝室の引戸の前にベッド」が素通りした。塞がれている側が
    **収納室でない** ときは、片側でも違反にする。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}
    for it in data['items']:
        if it.get('type') not in DOOR_TYPES or it.get('type') == 'window':
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        need = 600.0
        for sign in (1, -1):
            px, py = cx + vx * sign * (need / 2.0 + 120), cy + vy * sign * (need / 2.0 + 120)
            r = room_at(data, floor, px, py)
            if r is None:
                continue                      # 屋外側は対象外
            n = (r.get('n') or '')
            if any(k in n for k in _STORAGE_ROOM_WORDS):
                continue                      # 収納室の中は手を伸ばして使う
            # 前面600mmの帯を開口に沿って刻み、連続して空いている幅を測る
            zcx = cx + vx * sign * (need / 2.0 + 60)
            zcy = cy + vy * sign * (need / 2.0 + 60)
            zone_box = aabb({'x': zcx - it['w'] / 2.0, 'y': zcy - need / 2.0,
                             'w': it['w'], 'd': need, 'rot': it.get('rot', 0)})
            half = it['w'] / 2.0
            STEP = 40.0
            spans, cur, blockers = [], 0.0, set()
            t = -half + 20
            while t <= half - 20:
                mx = cx + ux * t + vx * sign * (need / 2.0 + 60)
                my = cy + uy * t + vy * sign * (need / 2.0 + 60)
                cell = aabb({'x': mx - 20, 'y': my - need / 2.0,
                             'w': 40, 'd': need, 'rot': it.get('rot', 0)})
                hit = None
                for f in data['items']:
                    if f.get('floor', 1) != floor or not is_furniture(f):
                        continue
                    e = f.get('elev') or 0
                    if e + _item_height(f, cat) <= 400:
                        continue              # 踏み越えられる低い物
                    if e >= 2000:
                        continue              # 建具の高さより上(天井付けの器具)
                    fb = aabb(f)
                    # 帯へのめり込みが数mmしかない物は通路を塞いだ扱いにしない。
                    # 刻みは40mmなので、判定の余裕はセルではなく**帯の奥行**で見る
                    zox, zoy = rect_overlap(fb, zone_box)
                    if min(zox, zoy) < 60.0:
                        continue
                    if rects_intersect(fb, cell, 0.0):
                        hit = label(f)
                        break
                if hit:
                    blockers.add(hit)
                    spans.append(cur)
                    cur = 0.0
                else:
                    cur += STEP
                t += STEP
            spans.append(cur)
            if blockers and max(spans) < 600.0:
                vio(out, it, '%s側の有効幅が%.0fmmしか残っていない'
                    '(開口%.0fmm・%s)'
                    % (n or '室', max(spans), it['w'], ', '.join(sorted(blockers))))
    return out


def check43_wide_opening_frontage(data, root=None):
    """広い開口(1650mm以上)の前が、幅の半分以上にわたって空いているか。

    13は「幅600mmの通り道が1本残っていれば通す」。全面開口のキッチンで
    ペニンシュラが一部を塞ぐ形を許すためだが、そのせいで**2730mmの開口の
    真正面に食卓が205mmで迫っている**形まで通していた。
    開口が広いほど、そこは「通る場所」ではなく「つながっている場所」なので、
    前面の空きは幅に比例して要る。
    """
    out = []
    root = root or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cat = _load_catalog(root) or {}
    STEP = 60.0
    for it in data['items']:
        if it.get('type') not in ('door-opening', 'door-opening-arch'):
            continue
        if it['w'] < 1650:
            continue
        floor = it.get('floor', 1)
        cx, cy = center(it)
        (ux, uy), (vx, vy) = axes(it)
        half = it['w'] / 2.0
        for sign in (1, -1):
            if room_at(data, floor, cx + vx * sign * 700, cy + vy * sign * 700) is None:
                continue
            free = 0
            total = 0
            t = -half + 30
            while t <= half - 30:
                total += 1
                mx = cx + ux * t + vx * sign * 400
                my = cy + uy * t + vy * sign * 400
                cell = {'x': mx - 30, 'y': my - 30, 'w': 60, 'd': 60, 'rot': 0}
                cb = aabb(cell)
                blocked = False
                for f in data['items']:
                    if f.get('floor', 1) != floor or not is_furniture(f):
                        continue
                    if (f.get('elev') or 0) + _item_height(f, cat) <= 400:
                        continue
                    # 開口の面に接して立つ物(対面キッチンのカウンターなど)は
                    # 障害物ではなく開口の一部。200mm以内に寄っていたら数えない
                    fb = aabb(f)
                    near = 1e9
                    for ex, ey in ((fb[0], fb[1]), (fb[2], fb[1]),
                                   (fb[0], fb[3]), (fb[2], fb[3])):
                        near = min(near, abs((ex - cx) * vx + (ey - cy) * vy))
                    if near < 200.0:
                        continue
                    if rects_intersect(aabb(f), cb, 0.0):
                        blocked = True
                        break
                if not blocked:
                    free += 1
                t += STEP
            if total and free < total * 0.5:
                vio(out, it, '幅%.0fmmの開口の前面800mmが%d%%しか空いていない'
                    '(%s側)。広い開口の正面に物を置かない'
                    % (it['w'], round(100.0 * free / total),
                       (room_at(data, floor, cx + vx * sign * 700,
                                cy + vy * sign * 700) or {}).get('n', '')))
    return out



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
    ('24. 引戸の引き代と戸袋面', check24_slide_pocket),
    ('25. 開き戸の開き角度', check25_swing_arc),
    ('26. 収納家具の正面クリアランス', check26_storage_facing),
    ('27. 開閉窓の室内側クリアランス', check27_operable_window),
    ('28. カーテンと窓の整合', check28_curtain_fit),
    ('29. 吹き抜けの縁の手すり', check29_void_guard),
    ('30. 家具の裏表(正面が壁を向いていないか)', check30_facing_wall),
    ('31. 壁付け家具が壁から離れていないか', check31_wall_mounted_gap),
    ('32. 壁の継ぎ目のずれ', check32_wall_joint),
    ('33. 照明器具が天井に付いているか', check33_light_mount),
    ('34. 玄関からの見通し(開けたら中が丸見え)', check34_entry_sightline),
    ('35. 水まわりの直下に居室(音)', check35_wet_room_over_bedroom),
    ('36. キッチンのワークトライアングル', check36_work_triangle),
    ('37. 居室の窓の数(採光と通風)', check37_room_windows),
    ('38. 洗う→干すの距離', check38_laundry_to_drying),
    ('39. 対で使う家具が互いを向いているか', check39_paired_facing),
    ('40. 窓の見付けを塞ぐ物', check40_window_face_blocked),
    ('41. 開口を横切る壁', check41_wall_across_opening),
    ('42. 建具の片側の前面', check42_door_side_blocked),
    ('43. 広い開口の前面通行帯', check43_wide_opening_frontage),
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
