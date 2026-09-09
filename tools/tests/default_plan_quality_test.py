"""Preset regression gates; check geometry and the measurement itself."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('lint', ROOT/'tools/lint_plan.py')
lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint)


class StorageMeasurement(unittest.TestCase):
    def plan(self, rooms, items):
        return {'rooms': rooms, 'items': items, 'walls': []}

    def test_real_cabinet_counted_once_and_clipped_to_room(self):
        room = {'x': 0, 'y': 0, 'w': 4000, 'd': 4000, 'floor': 1, 'n': '寝室'}
        cabinet = {'type': 'original-wardrobe', 'x': 3500, 'y': 0, 'w': 1000, 'd': 600, 'floor': 1, 'rot': 0}
        total, dedicated, furniture = lint.storage_areas(self.plan([room], [cabinet, dict(cabinet)]))
        self.assertEqual(total, 16)
        self.assertEqual(dedicated, 0)
        self.assertAlmostEqual(furniture, .3)

    def test_cabinet_inside_storage_is_not_added_twice(self):
        room = {'x': 0, 'y': 0, 'w': 2000, 'd': 2000, 'floor': 1, 'n': '収納'}
        cabinet = {'type': 'original-wardrobe', 'x': 0, 'y': 0, 'w': 1000, 'd': 600, 'floor': 1, 'rot': 0}
        self.assertEqual(lint.storage_areas(self.plan([room], [cabinet])), (4, 4, 0))

    def test_hanging_and_kitchen_cabinets_do_not_inflate_storage(self):
        room = {'x': 0, 'y': 0, 'w': 2000, 'd': 2000, 'floor': 1, 'n': 'キッチン'}
        cabinet = {'type': 'original-wardrobe', 'x': 0, 'y': 0, 'w': 1000, 'd': 600, 'floor': 1, 'rot': 0}
        self.assertEqual(lint.storage_areas(self.plan([room], [cabinet])), (4, 0, 0))
        room['n'] = '寝室'
        cabinet['elev'] = 900
        self.assertEqual(lint.storage_areas(self.plan([room], [cabinet])), (4, 0, 0))

    def test_front_direction_matches_positive_z_asset(self):
        for rot in (0, 90, 180, 270):
            expected = lint._front_dir({'rot': rot})
            actual = lint._front_dir({'rot': (rot+180)%360, 'modelFrontAxis': '+Z'})
            self.assertAlmostEqual(actual[0], expected[0])
            self.assertAlmostEqual(actual[1], expected[1])

    def test_ceiling_fixture_uses_actual_finished_ceiling(self):
        room = {'x': 0, 'y': 0, 'w': 2000, 'd': 2000, 'floor': 1, 'n': 'ランドリー'}
        rail = {'id': 1, 'type': 'original-laundry-rail', 'x': 500, 'y': 900, 'w': 1100, 'd': 80, 'floor': 1, 'elev': 2188}
        data = self.plan([room], [rail])
        self.assertEqual(lint.check12_ceiling_clash(data), [])
        self.assertEqual(lint.check33_light_mount(data), [])
        rail['elev'] += 100
        self.assertTrue(lint.check12_ceiling_clash(data))
        self.assertTrue(lint.check33_light_mount(data))

    def test_voids_are_large_and_have_no_upper_floor_rooms(self):
        for file, minimum in [('default_plan.json', 13), ('default_plan_3f.json', 14)]:
            data = json.loads((ROOT/'assets'/file).read_text())
            voids = [r for r in data['rooms'] if r.get('ceiling', {}).get('type') == 'void']
            self.assertGreaterEqual(sum(r['w']*r['d']/1e6 for r in voids), minimum)
            for void in voids:
                vb = (void['x'], void['y'], void['x']+void['w'], void['y']+void['d'])
                for room in data['rooms']:
                    if not void['floor'] < room['floor'] <= void['ceiling']['toFloor']:
                        continue
                    rb = (room['x'], room['y'], room['x']+room['w'], room['y']+room['d'])
                    overlap = lint.rect_overlap(vb, rb)
                    self.assertFalse(overlap[0] > 0 and overlap[1] > 0, (file, room))

    def test_both_generators_normalize_all_positive_z_assets(self):
        for file in ['default_plan.json', 'default_plan_3f.json']:
            data = json.loads((ROOT/'assets'/file).read_text())
            for item in data['items']:
                if item['type'].startswith(('original-', 'im0261-')) or item['type'] in ('fmp-AirConditionerWall01', 'ac-outdoor'):
                    self.assertEqual(item.get('modelFrontAxis'), '+Z', (file, item['id'], item['type']))

    def test_open_curtain_fabric_is_gathered_at_outer_edges(self):
        # Inspect the actual fabric primitive rather than assuming its local side.
        import math, struct
        for file in ['default_plan.json', 'default_plan_3f.json']:
            data = json.loads((ROOT/'assets'/file).read_text())
            windows = [i for i in data['items'] if i['type'] in ('window', 'window-door')]
            for item in data['items']:
                if not item['type'].startswith('original-curtain-open-'):
                    continue
                x, y = lint.center(item)
                window = min((w for w in windows if w['floor'] == item['floor']), key=lambda w: math.dist((x,y),lint.center(w)))
                if window['w'] <= item['w']:
                    continue
                blob = (ROOT/'assets/models/original'/f"{item['type']}.glb").read_bytes()
                size = struct.unpack_from('<I', blob, 12)[0]
                gltf = json.loads(blob[20:20+size])
                accessors = [gltf['accessors'][p['attributes']['POSITION']] for m in gltf['meshes'] for p in m['primitives']]
                xmin = min(a['min'][0] for a in accessors)
                xmax = max(a['max'][0] for a in accessors)
                fabric = next(gltf['accessors'][p['attributes']['POSITION']] for m in gltf['meshes'] for p in m['primitives'] if gltf['materials'][p['material']]['name'].startswith('fabric_'))
                offset = ((fabric['min'][0]+fabric['max'][0])/2-(xmin+xmax)/2)/(xmax-xmin)*item['w']
                offset *= -1 if item.get('flipX') else 1
                angle = -math.radians(item['rot'])
                wx, wy = lint.center(window)
                distance = abs(y-math.sin(angle)*offset-wy) if window['rot'] == 90 else abs(x+math.cos(angle)*offset-wx)
                self.assertGreater(distance, window['w']/2-300, (file, item['id'], distance))

    def test_accepted_user_plan_keeps_documented_lint_findings_visible(self):
        # This is a delivery audit, not a claim that the user's layout passes.
        import subprocess, re
        for filename, expected in [('default_plan.json', [1,6,17,18,23,32,36,41,42]),
                                   ('default_plan_3f.json', [18])]:
            result = subprocess.run(['python3', str(ROOT/'tools/lint_plan.py'), str(ROOT/'assets'/filename)], capture_output=True, text=True, check=True)
            self.assertEqual([int(n) for n in re.findall(r'^== (\d+)\.', result.stdout, re.M)], expected)

    def test_reviewed_deletions_survive_regeneration(self):
        import subprocess, tempfile
        patch = json.loads((ROOT/'tools/default_plan_3f_user_review.json').read_text())
        removed = {c['before']['id'] for c in patch['collections']['items'] if c['after'] is None}
        self.assertEqual(len(removed), 22)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'plan.json'
            subprocess.run(['python3', str(ROOT/'tools/make_default_plan_3f.py'), str(out)], check=True, capture_output=True)
            plan = json.loads(out.read_text())
            self.assertFalse(removed & {i['id'] for i in plan['items']})
            self.assertEqual(plan, json.loads((ROOT/'assets/default_plan_3f.json').read_text()))

    def test_latest_user_revision_regenerates_and_keeps_user_layout(self):
        import subprocess, tempfile
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'plan.json'
            subprocess.run(['python3', str(ROOT/'tools/make_default_plan_2f.py'), str(out)], check=True)
            plan = json.loads(out.read_text())
        self.assertEqual(plan, json.loads((ROOT/'assets/default_plan.json').read_text()))
        self.assertEqual(plan, json.loads((ROOT/'docs/quality-review/default-plans-release/user-plan-25.json').read_text()))
        ids = {i['id']: i for i in plan['items']}
        self.assertFalse({1102,1180,1194,1195} & ids.keys())
        self.assertTrue({1228,1229,1230,1231,1233,1234,1235,1236,1237,1238,1240,1241} <= ids.keys())
        self.assertEqual(ids[1178]['rot'], 180)
        self.assertEqual(ids[1115]['latticeHeight'], 2400)
        self.assertEqual(ids[1116]['latticeHeight'], 2400)

    def test_review23_parking_has_house_side_exit_without_expanding_parcel(self):
        plan = json.loads((ROOT/'tools/tests/fixtures/review23-house-2f.json').read_text())
        items = {i['id']:i for i in plan['items']}
        site = next(i for i in plan['items'] if i['type']=='site-rect')
        self.assertEqual((site['x'],site['y'],site['w'],site['d']),(-910,-1820,11375,13195))
        car = lint.aabb(items[1124])
        screen = lint.aabb(items[1115])
        self.assertGreaterEqual(car[1]-screen[3],800)
        self.assertEqual(items[1124]['rot'],90)
        self.assertEqual(min(w['y1'] for w in plan['walls']),-600)

    def test_migrated_fmp_front_matches_legacy_physical_direction(self):
        for rot in (0, 90, 180, 270):
            before = lint._front_dir({'type':'fmp-CabinetD01','rot':rot})
            after = lint._front_dir({'type':'fmp-CabinetD01','rot':(rot+180)%360,'modelFacingVersion':1})
            for a, b in zip(before, after):
                self.assertAlmostEqual(a, b)

    def test_second_review_keeps_added_storage_and_removed_objects(self):
        plan = json.loads((ROOT/'assets/default_plan_3f.json').read_text())
        ids = {i['id'] for i in plan['items']}
        patch = json.loads((ROOT/'tools/default_plan_3f_review_22.json').read_text())
        removed = {c['before']['id'] for c in patch['collections']['items'] if c['after'] is None}
        added = {c['after']['id'] for c in patch['collections']['items'] if c['before'] is None}
        self.assertEqual(len(removed), 5)
        self.assertEqual(len(added), 2)
        self.assertFalse(removed & ids)
        self.assertTrue(added <= ids)

    def test_both_presets_have_flush_interior_floors_and_inward_washers(self):
        for filename in ('default_plan.json', 'default_plan_3f.json'):
            plan = json.loads((ROOT/'assets'/filename).read_text())
            for r in plan['rooms']:
                if r['floor'] == 1:
                    self.assertEqual(r.get('floorRaiseMm'), 0 if r['n'] == '玄関' else 150)
            for i in plan['items']:
                if i['type'] == 'washer':
                    self.assertAlmostEqual(lint._front_dir(i)[1], 1)

    def test_review23_island_has_clear_circulation_on_all_four_sides(self):
        plan = json.loads((ROOT/'tools/tests/fixtures/review23-house-2f.json').read_text())
        island = next(i for i in plan['items'] if i['type'] == 'original-kitchen-island')
        x0, y0, x1, y1 = lint.aabb(island)
        zones = [(x0-800,y0,x0,y1), (x1,y0,x1+1000,y1),
                 (x0,y0-1000,x1,y0), (x0,y1,x1,y1+900)]
        obstacles = [lint.aabb(i) for i in plan['items'] if i is not island
                     and i.get('floor',1)==1 and lint.is_furniture(i)
                     and (i.get('elev') or 0)<500]
        obstacles += [b[:4] for b in lint._wall_boxes(plan,1)]
        for zone in zones:
            for obstacle in obstacles:
                self.assertFalse(lint.rects_intersect(zone,obstacle,1), (zone,obstacle))
        self.assertEqual(lint.check36_work_triangle(plan), [])


if __name__ == '__main__':
    unittest.main()
