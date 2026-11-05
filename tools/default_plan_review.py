"""Apply an accepted user layout without silently losing edits on regeneration."""
import json
from pathlib import Path

from plan_kit import ceiling_finish_mm


def apply_review(plan):
    patch = json.loads(Path(__file__).with_name('default_plan_3f_user_review.json').read_text())
    for collection, changes in patch['collections'].items():
        by_id = {obj['id']: obj for obj in plan[collection]}
        for change in changes:
            before, after = change['before'], change['after']
            if by_id.get(before['id']) != before:
                raise ValueError(f"Review baseline changed: {collection} {before['id']}; rebase the reviewed edit explicitly")
            if after is None:
                del by_id[before['id']]
            else:
                by_id[before['id']] = after
        plan[collection] = list(by_id.values())

    items = {obj['id']: obj for obj in plan['items']}
    # Keep the user's open eastern living area; canopy clears the low cabinet
    # and the external wall. The deleted desk is not recreated.
    items[1204].update(x=4771, y=6370)
    # Retain the user's seating composition, leaving 1,030 mm to the south
    # wall's inner face. Move the table and its vase as one supported assembly.
    items[1201]['y'] = 5600
    for item_id in (1202, 1203):
        items[item_id]['y'] -= 250
    apply_patch_file(plan, 'default_plan_3f_review_22.json')
    items = {obj['id']: obj for obj in plan['items']}
    rooms = {obj['id']: obj for obj in plan['rooms']}
    walls = {obj['id']: obj for obj in plan['walls']}
    rooms['r1025']['x'] = 2730  # Exact shared room boundary.
    walls[1015]['x2'] = 3640   # End at the closet wall; keep entry open.
    items[1035]['x'] = 1905   # Keep the new north/south position, on wall axis.
    items[1171]['x'] = 350    # Let the bedroom door swing fully.
    items[1176].update(x=102.5, y=7157)  # Clear the curtain stack.
    # The full-length mirror belongs beside the closet, outside the south exit.
    items[1270].update(x=2269.5, y=7463.5, rot=90, elev=0, modelFrontAxis='+Z')
    items[1269]['modelFrontAxis'] = '+Z'
    finish_raised_floors(plan)
    return plan


def apply_patch_file(plan, filename):
    patch = json.loads(Path(__file__).with_name(filename).read_text())
    for collection, changes in patch['collections'].items():
        by_id = {obj['id']: obj for obj in plan[collection]}
        for change in changes:
            before, after = change['before'], change['after']
            object_id = (before or after)['id']
            if by_id.get(object_id) != before:
                raise ValueError(f'Review baseline changed: {collection} {object_id}')
            if after is None:
                del by_id[object_id]
            else:
                by_id[object_id] = after
        plan[collection] = list(by_id.values())


def finish_raised_floors(plan):
    """One entry step, flush interior/bath/stair floors, fixed ceiling plane."""
    for room in plan['rooms']:
        if room['floor'] == 1:
            room['floorRaiseMm'] = 0 if room['n'] == '玄関' else 150
    offsets = {'light-ceiling': 0, 'light-down': 0, 'light-spot': 0,
               'fmp-CeilingFan01': 350, 'original-laundry-rail': 500}
    for item in plan['items']:
        if item['type'] not in offsets:
            continue
        x, y = item['x']+item['w']/2, item['y']+item['d']/2
        room = next((r for r in plan['rooms'] if r['floor'] == item['floor']
                     and r['x'] <= x <= r['x']+r['w']
                     and r['y'] <= y <= r['y']+r['d']), None)
        if room is None:
            continue
        floor = item['floor']
        c = room.get('ceiling') or {}
        void_to = c.get('toFloor', floor+1) if c.get('type') == 'void' else None
        # 式は plan_kit に1つだけ置く(ここに書き写すと、片方だけ直して食い違う)。
        item['elev'] = (ceiling_finish_mm(floor, void_to, room.get('floorRaiseMm', 0))
                        - offsets[item['type']])


def apply_review_25_joints(plan):
    """受領版25のあと、掃き出し窓1047を南の外壁へ戻す。

    この窓は受領版24で壁から325mm室内へ動かされていた。**それは位置の
    好みではなく、高さの不具合を避けるための手当てだった。**

      部屋の矩形は壁の芯(y=8190)で終わる。壁の上にある窓は中心が y=8200 に
      来るので、10mm はみ出して「どの部屋にも入っていない」ことになり、
      床上げ150mm・スラブ180mm・基礎450mm が付かず 792mm 沈んでいた。

    原因はアプリ側にあり、assets/js/app-constants.js の item3DBaseY() を
    直した(開口は「基礎の外なら地面」の対象にせず、中心で部屋が見つからない
    ときは開口の両側を見る)。直した結果、壁の上でも室内でも基準高さは
    同じ 0.78m になる。**アプリの修正が前提なので、tools/tests/
    opening-floor.test.cjs がその規則を見張っている。**
    """
    items = {i['id']: i for i in plan['items']}
    items[1047]['y'] = 8110
    # 玄関ポーチを 650 → 630mm。**受領版25で650に上げた結果、天端638mmが
    # 玄関の床(と玄関ドアの下端)630mmより8mm高くなった。** ポーチが室内の
    # 床より高いと、ドアが当たるうえ水が入る。630なら天端618mmで、床より
    # 12mm低い普通の納まりになる。上げた意図(段板500mm・アプローチとの
    # 取り合い)は残る。
    #
    # 検査側の「床とみなす高さ」も500mm固定から基礎+スラブへ直した。
    # 500mm固定のままだと、基礎450mmの家では**どの玄関ドアも「ポーチが
    # 当たって開かない」**になっていた(tools/lint_plan.py の is_furniture)。
    items[1130]['customHeight'] = 630
    return plan


# ── 2026-11 サンプル見直し ─────────────────────────────────────────────
# 利用者の指摘(台所の向き・アプリに無い機能・玄関が浮く)を受けた見直し。
# 方針: 間取りは変えない。**利用者が今の画面で作れる物だけで表す**。

def _drop_site_zones(items):
    """敷地の「外構仕上げ区画」(siteZones) を外す。

    区画は表示と既存区画の編集はできるが、**利用者が新しく作る・消す手段が無い。**
    サンプルだけが使える機能はサンプルに出さない。駐車場・駐輪場の土間は、
    利用者も置ける任意ブロック(コンクリート)で表す。
    """
    for it in items:
        if it['type'] == 'site-rect':
            it.pop('siteZones', None)


def _slab(item_id, name, x, y, w, d, height=10):
    # 地面に置く薄い土間。2Dでは他の物の下に描く(stack -1)。
    return {'id': item_id, 'type': 'custom-block', 'x': x, 'y': y, 'w': w, 'd': d,
            'rot': 0, 'floor': 1, 'flipX': False, 'flipY': False, 'sScale': 1,
            'sX': 0, 'sY': 0, 'color': '#c8c6c0', 'colorCustom': True,
            'customHeight': height, 'name': name, 'texture': 'concrete_brush',
            'elev': 0, 'stack': -1}


def apply_sample_audit_2f(plan):
    items = {obj['id']: obj for obj in plan['items']}
    # 台所: アイランドの流しが食卓側を向いていた(水栓が奥、引出しが食卓側)。
    # 調理する人は背面の加熱台との間に立つので、正面を北へ向ける。
    items[1163]['rot'] = 180
    # 玄関: 高さモデルv2で玄関土間が630mmになったのに、ポーチは450mmのまま。
    # ドアの下に約190mmの段が出て、玄関ドアが宙に浮いて見えた。
    # 3階建てで利用者が決めた納まり(ポーチ630=天端が土間-12mm、段3段で500まで
    # 上がり最後の1段がポーチ)に揃える。
    items[1118]['customHeight'] = 630
    items[1119]['targetHeight'] = 500
    # テラスのウッドデッキは天端438mmで、居間の床(780mm)より342mm低い。
    # ただしデッキは束石と束で立つモデルで、高さZで持ち上げると束石が地面から
    # 浮く。カタログのモデルの高さを変える手段が今のアプリに無いので触らない。
    # 敷地の区画をやめ、駐車場と駐輪場を任意ブロックの土間で表す。
    # 敷地は x -910..10465 / y -1820..11375(南が道路)。
    _drop_site_zones(plan['items'])
    # 平面図は items の並び順に描くので、土間は先頭(最背面)に入れる。
    # 末尾に足すと車と自転車が土間の下に隠れる。
    plan['items'][:0] = [
        _slab(1300, '駐車場', -790, 8570, 7040, 2805),
        _slab(1301, '駐輪場', 7825, 9200, 2400, 2055),
    ]
    return plan


def apply_sample_audit_3f(plan):
    rooms = {obj['id']: obj for obj in plan['rooms']}
    # 2階の吹抜リビングと食卓の間の区画。2.0畳に「LDK」と出ていた。
    rooms['r1070']['n'] = 'リビング'
    # 前庭の区画(敷地の外構仕上げ)をやめる。アプローチは既に任意ブロックで
    # 敷いてあるので、見え方は変わらない。
    _drop_site_zones(plan['items'])
    return plan
