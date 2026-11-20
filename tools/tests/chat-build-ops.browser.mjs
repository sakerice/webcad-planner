// 白紙から家を作る操作(addRoomWalls・placeOpening・addRoof)を、実物の画面のチャット用の ctx(planChatCtx)で当てる。AI は呼ばない。
//
//   1. 部屋 3 つ(1階 2・2階 1)を足し、壁で囲む → 二重の壁が無い。部屋のあいだの扉は共有する壁の上、窓・玄関ドアは外壁の上に載る
//   2. 屋根(addRoof)は、画面の屋根の道具で置いて設定欄で形と勾配を変えた屋根と、同じ欄・同じ値(位置と大きさを除く)
//   3. 作ったプランを画面に入れると、外観3D に屋根が出る(屋根の物を指す 3D の物がある)。2D の描画で例外が出ない
//
// 写真を output/test-shots/chat-build-ops-*.png に残す(git の管理外)。
// sh tools/run_browser_tests.sh chat-build-ops
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', '..', 'output', 'test-shots');
mkdirSync(SHOTS, { recursive: true });
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items, null, T);

  const out = await page.evaluate(() => {
    const before = JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v));
    const apply = (plan, ops) => PlanCoreOperations.applyOperations(plan, ops, planChatCtx());
    let r = apply(DATA, [
      { op: 'addRoom', args: { name: 'LDK', floor: 1, x: 2730, y: 2275, w: 5460, d: 4550 } },
      { op: 'addRoom', args: { name: '洋室', floor: 1, x: 7280, y: 2275, w: 3640, d: 4550 } },
      { op: 'addRoom', args: { name: '洋室2', floor: 2, x: 4550, y: 2275, w: 9100, d: 4550 } },
    ]);
    if (r.errors.length) return { step: 'rooms', errors: r.errors };
    const ids = r.plan.rooms.slice(-3).map((x) => x.id);
    r = apply(r.plan, [{ op: 'addRoomWalls', args: { ids, thick: 105, outerThick: 150 } }]);
    if (r.errors.length) return { step: 'walls', errors: r.errors };
    const walls = r.plan.walls;
    r = apply(r.plan, [
      { op: 'placeOpening', args: { type: 'door-swing', room: ids[0], to: ids[1], hinge: 'N', opens: 'E' } },
      { op: 'placeOpening', args: { type: 'window', room: ids[0], side: 'S', width: 1690 } },
      { op: 'placeOpening', args: { type: 'door-front', room: ids[1], side: 'S', hinge: 'E', opens: 'S' } },
      { op: 'addRoof', args: { floor: 2, shape: 'hip', pitch: 25 } },
    ]);
    if (r.errors.length) return { step: 'openings', errors: r.errors };
    const plan = r.plan;
    const items = plan.items.slice(-4);
    const roof = items[3];
    // 画面: 屋根の道具で 3 階(2階の上)に置き、設定欄で形と勾配を変える
    const sameData = JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v)) === before;
    onFloorChange(3);
    placeItem('roof', 4550, 2275);
    const screenRoof = DATA.items[DATA.items.length - 1];
    ST.selected = screenRoof;
    updateSelectedProp('roofType', 'hip');
    updateSelectedProp('pitch', 25);
    const strip = (o) => { const c = JSON.parse(JSON.stringify(o, (k, v) => (k.charAt(0) === '_' ? undefined : v))); ['id', 'x', 'y', 'w', 'd'].forEach((k) => delete c[k]); return c; };
    const screenKeys = Object.keys(screenRoof).filter((k) => k.charAt(0) !== '_');
    const roofKeys = Object.keys(roof).filter((k) => k.charAt(0) !== '_');
    const cmp = { screen: strip(screenRoof), ai: strip(roof), screenKeys, roofKeys };
    undoAction();
    onFloorChange(1);
    // 作ったプランを画面に入れる
    ['walls', 'rooms', 'items'].forEach((k) => { DATA[k] = plan[k]; });
    normalizeLoadedPlan({ resetHeights: false, restoreView: false });
    draw2d();
    const roofInData = DATA.items.find((o) => o.type === 'roof');
    return {
      sameData, cmp,
      wallCount: walls.length,
      walls: walls.map((w) => [w.x1, w.y1, w.x2, w.y2, w.floor, w.thick]),
      items: items.map((it) => ({ type: it.type, cx: it.x + it.w / 2, cy: it.y + it.d / 2, w: it.w, rot: it.rot, flipX: it.flipX, flipY: it.flipY, floor: it.floor })),
      roof: { x: roof.x, y: roof.y, w: roof.w, d: roof.d, floor: roof.floor, roofType: roof.roofType, pitch: roof.pitch },
      roofId: roofInData && roofInData.id,
    };
  });
  assert.ok(!out.step, JSON.stringify(out));
  assert.equal(out.sameData, true, 'AI 用の ctx で当てたのに本物の DATA が変わった');
  // 1. 壁: 1階は外周 2×(9100+4550) と間仕切り 4550、2階は外周 2×(9100+4550)。二重なし
  const key = (w) => { const [x1, y1, x2, y2, f] = w; return [f, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].join(','); };
  const len = (w) => Math.hypot(w[2] - w[0], w[3] - w[1]);
  const total = (f) => out.walls.filter((w) => w[4] === f).reduce((a, w) => a + len(w), 0);
  assert.equal(total(1), 2 * (9100 + 4550) + 4550, '1階の壁の長さ');
  assert.equal(total(2), 2 * (9100 + 4550), '2階の壁の長さ');
  assert.equal(new Set(out.walls.map(key)).size, out.walls.length, '同じ壁が2本ある');
  const inner = out.walls.filter((w) => w[0] === 5460 && w[2] === 5460 && w[4] === 1);
  assert.equal(inner.length, 1);
  assert.equal(inner[0][5], 105);
  // 扉・窓
  const [door, win, front] = out.items;
  assert.deepEqual([door.cx, door.cy, door.rot, door.flipX, door.flipY], [5460, 2275, 90, false, true], '部屋のあいだの扉: ' + JSON.stringify(door));
  assert.ok(/^door-swing/.test(door.type));
  assert.deepEqual([win.cx, win.cy, win.rot, win.w], [2730, 4550, 0, 1690], '窓: ' + JSON.stringify(win));
  assert.equal(front.cy, 4550);
  assert.equal(front.cx, 7280);
  assert.deepEqual([front.flipX, front.flipY], [true, false]);
  // 2. 屋根: 画面で作った屋根と同じ欄・同じ値
  assert.deepEqual(out.cmp.roofKeys, out.cmp.screenKeys, '屋根の欄の並びが画面と違う');
  assert.deepEqual(out.cmp.ai, out.cmp.screen, '屋根の値が画面と違う');
  assert.deepEqual(out.roof, { x: -450, y: -450, w: 10000, d: 5450, floor: 3, roofType: 'hip', pitch: 25 });
  await page.screenshot({ path: join(SHOTS, 'chat-build-ops-2d.png') });
  // 3. 外観3D に屋根が出る
  await page.evaluate(() => setView('3d-ext'));
  await page.waitForFunction(() => window.ren && window.sc3, null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(3000);
  const roof3d = await page.evaluate((id) => {
    if (typeof rebuild3D === 'function') rebuild3D();
    let meshes = 0;
    sc3.traverse((o) => { if (o.isMesh && o.userData && o.userData.selectRef && o.userData.selectRef.id === id) meshes++; });
    return meshes;
  }, out.roofId);
  assert.ok(roof3d > 0, '外観3D に屋根が無い');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, 'chat-build-ops-3d.png') });
  assert.deepEqual(errors, []);
  console.log('chat-build-ops: ok (屋根の 3D の物 ' + roof3d + ')');
} finally {
  await browser.close();
}
