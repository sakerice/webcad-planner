"""Apply an accepted user layout without silently losing edits on regeneration."""
import json
from pathlib import Path


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
        span = max(floor+1, c.get('toFloor', floor+1))-floor+1 if c.get('type') == 'void' else 1
        item['elev'] = span*2700-(180 if floor > 1 else 0)-12-room.get('floorRaiseMm', 0)-offsets[item['type']]
