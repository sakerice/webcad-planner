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
