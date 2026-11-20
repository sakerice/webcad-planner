// 白紙から家を作るための操作(plan-core/operations.js): 部屋を壁で囲む・部屋と部屋/外のあいだに窓や扉を付ける・屋根をかける。
// ctx は偽物で、グローバルには触らない。
//
//   addRoomWalls … 隣の部屋と共有する辺に壁を二重に作らない。既にある壁と重なる区間は作らない。外周と間仕切りで厚さを分けられる
//   placeOpening … 2つの部屋が共有する壁の上(または部屋の外に面した壁の上)に置く。既定は中央、端からの距離も指定できる。
//                  吊り元(hinge)・開く向き(opens)は、読み取り(plan-free-apply.js)・lint(tools/lint_plan.py)と同じ決まり
//   addRoof      … 画面の屋根の道具と同じ物(placeItem の roof に、画面の設定欄と同じ roofType・pitch)を作る。
//                  載る階の壁の外周が長方形でなければ、範囲を渡すよう断る(近似の形を作らない)
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../../assets/js/plan-core/operations.js');
const C = require('../../assets/js/plan-core/operations-catalog.js');
const fs = require('node:fs');
const path = require('node:path');

function makeCtx() {
  let n = 100;
  return {
    newId: () => ++n,
    catalog: {
      known: () => true,
      resolveType: (t) => t,
      defaultSize: (t) => ({ 'door-swing': { w: 780, d: 780 }, window: { w: 1690, d: 150 }, roof: { w: 3000, d: 3000 } }[t] || { w: 900, d: 900 }),
      defaultColor: () => undefined,
      model: () => null,
      is: (kind, t) => ({
        windowLike: t === 'window' || t === 'window-door',
        doorLikeOpening: /^door-/.test(t), doorPanel: t === 'door-swing',
      }[kind] || false),
      canSetElevation: () => false,
      applyLightDefaults: () => {},
      contextExteriorHeight: () => 6000,
      contextFloors: () => 2,
      constants: { rulerThickness: 60, walkRouteThickness: 50, walkDefaultSpeed: 1.2 },
    },
    plan: { wallHeightForFloor: () => 2400, floorRaiseForFloor: () => 0, foundationHeight: () => 0 },
  };
}
const run = (plan, ops, ctx) => O.applyOperations(plan, ops, ctx || makeCtx());
// 2部屋: LDK(0,0)-(5000,4000) と 洋室(5000,0)-(8000,4000)。2階に洋室2(0,0)-(8000,4000)
function twoRooms() {
  return {
    walls: [], items: [],
    rooms: [
      { id: 'rm_l', type: 'room', x: 0, y: 0, w: 5000, d: 4000, floor: 1, n: 'LDK' },
      { id: 'rm_b', type: 'room', x: 5000, y: 0, w: 3000, d: 4000, floor: 1, n: '洋室' },
      { id: 'rm_2', type: 'room', x: 0, y: 0, w: 8000, d: 4000, floor: 2, n: '洋室2' },
    ],
  };
}
const len = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
// 同じ線の上で重なっている壁の組(二重の壁)
function doubled(walls) {
  const out = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i], b = walls[j];
      if ((a.floor || 1) !== (b.floor || 1)) continue;
      const h = (w) => w.y1 === w.y2, v = (w) => w.x1 === w.x2;
      const ov = (p1, p2, q1, q2) => Math.min(Math.max(p1, p2), Math.max(q1, q2)) - Math.max(Math.min(p1, p2), Math.min(q1, q2));
      if (h(a) && h(b) && a.y1 === b.y1 && ov(a.x1, a.x2, b.x1, b.x2) > 1) out.push([a.id, b.id]);
      if (v(a) && v(b) && a.x1 === b.x1 && ov(a.y1, a.y2, b.y1, b.y2) > 1) out.push([a.id, b.id]);
    }
  }
  return out;
}

test('addRoomWalls: 2部屋を囲むと、共有する辺の壁は1本だけ。外周は outerThick、間仕切りは thick', () => {
  const r = run(twoRooms(), [{ op: 'addRoomWalls', args: { ids: ['rm_l', 'rm_b'], thick: 105, outerThick: 150 } }]);
  assert.deepEqual(r.errors, []);
  const walls = r.plan.walls;
  assert.deepEqual(doubled(walls), [], '二重の壁がある');
  const total = walls.reduce((a, w) => a + len(w), 0);
  assert.equal(total, 2 * 8000 + 2 * 4000 + 4000, '外周 24m と間仕切り 4m');
  const inner = walls.filter((w) => w.x1 === 5000 && w.x2 === 5000);
  assert.equal(inner.length, 1);
  assert.equal(inner[0].thick, 105);
  assert.ok(walls.filter((w) => w !== inner[0]).every((w) => w.thick === 150), '外周の厚さ');
  assert.ok(walls.every((w) => w.floor === 1));
  assert.deepEqual(r.changedIds.sort(), walls.map((w) => w.id).sort());
});

test('addRoomWalls: 既にある壁と重なる区間は作らず、残りの区間だけ作る。2回呼んでも増えない', () => {
  const plan = twoRooms();
  plan.walls.push({ id: 1, x1: 0, y1: 0, x2: 3000, y2: 0, floor: 1, thick: 120 });   // 北の辺の西 3m は既にある
  const r = run(plan, [{ op: 'addRoomWalls', args: { ids: ['rm_l'] } }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(doubled(r.plan.walls), []);
  const north = r.plan.walls.filter((w) => w.y1 === 0 && w.y2 === 0 && w.id !== 1);
  assert.equal(north.length, 1);
  assert.deepEqual([Math.min(north[0].x1, north[0].x2), Math.max(north[0].x1, north[0].x2)], [3000, 5000]);
  const again = run(r.plan, [{ op: 'addRoomWalls', args: { ids: ['rm_l'] } }]);
  assert.deepEqual(again.errors, []);
  assert.equal(again.plan.walls.length, r.plan.walls.length, '2回めで壁が増えた');
  assert.ok(again.warnings.some((w) => /既に壁/.test(w)));
});

test('addRoomWalls: 部屋の代わりに多角形(points)と階でも囲める。部屋でない id・空の指定は断る', () => {
  const r = run(twoRooms(), [{ op: 'addRoomWalls', args: { floor: 2, points: [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 4000 }, { x: 0, y: 4000 }] } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.plan.walls.length, 4);
  assert.ok(r.plan.walls.every((w) => w.floor === 2));
  assert.match(run(twoRooms(), [{ op: 'addRoomWalls', args: { ids: ['nope'] } }]).errors[0].message, /nope/);
  assert.ok(run(twoRooms(), [{ op: 'addRoomWalls', args: {} }]).errors.length);
});

function walled() {
  return run(twoRooms(), [{ op: 'addRoomWalls', args: { ids: ['rm_l', 'rm_b', 'rm_2'] } }]).plan;
}

test('placeOpening: 2つの部屋のあいだの扉は、共有する壁の上の中央に載る', () => {
  const plan = walled();
  const r = run(plan, [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', to: 'rm_b' } }]);
  assert.deepEqual(r.errors, []);
  const d = r.plan.items.at(-1);
  assert.equal(d.type, 'door-swing');
  assert.equal(d.rot, 90, '南北に走る壁なので 90°');
  assert.deepEqual([d.x + d.w / 2, d.y + d.d / 2], [5000, 2000], '共有する壁の上の中央');
  const wall = r.plan.walls.find((w) => w.x1 === 5000 && w.x2 === 5000);
  assert.ok(wall, '共有する壁が無い');
});

test('placeOpening: 端からの距離(offset)は、北か西の端から開口の端までの長さ。幅も渡せる', () => {
  const r = run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_b', to: 'rm_l', offset: 300, width: 800 } }]);
  assert.deepEqual(r.errors, []);
  const d = r.plan.items.at(-1);
  assert.equal(d.w, 800);
  assert.deepEqual([d.x + d.w / 2, d.y + d.d / 2], [5000, 300 + 400]);
  assert.ok(run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_b', to: 'rm_l', offset: 3500, width: 800 } }]).errors.length, '壁からはみ出す位置を断らない');
});

test('placeOpening: 外に面した壁(side)に窓。共有する辺は外ではない', () => {
  const r = run(walled(), [{ op: 'placeOpening', args: { type: 'window', room: 'rm_l', to: 'outside', side: 'S' } }]);
  assert.deepEqual(r.errors, []);
  const w = r.plan.items.at(-1);
  assert.equal(w.rot, 0);
  assert.deepEqual([w.x + w.w / 2, w.y + w.d / 2], [2500, 4000]);
  const east = run(walled(), [{ op: 'placeOpening', args: { type: 'window', room: 'rm_l', side: 'E' } }]);
  assert.match(east.errors[0].message, /外に面/);
});

test('placeOpening: 壁が無い辺には置かない(先に壁を作るよう伝える)。部屋が接していなければ断る', () => {
  const none = run(twoRooms(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', to: 'rm_b' } }]);
  assert.match(none.errors[0].message, /addRoomWalls/);
  const p = walled();
  p.rooms.push({ id: 'rm_x', type: 'room', x: 20000, y: 0, w: 3000, d: 3000, floor: 1 });
  const far = run(p, [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', to: 'rm_x' } }]);
  assert.match(far.errors[0].message, /接して/);
  assert.match(run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', to: 'rm_2' } }]).errors[0].message, /階が違/);
});

test('placeOpening: 吊り元と開く向きは、読み取り・lint と同じ決まり(吊り元は flipX 側の端、開く側は flipY)', () => {
  // 横の壁(rot 0): u=(1,0)・v=(0,1)。吊り元が東なら flipX=true、南(v の向き)へ開くなら flipY=false
  const s = run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', side: 'S', hinge: 'E', opens: 'S' } }]).plan.items.at(-1);
  assert.equal(s.flipX, true);
  assert.equal(s.flipY, false);
  const n = run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', side: 'S', hinge: 'W', opens: 'N' } }]).plan.items.at(-1);
  assert.equal(n.flipX, false);
  assert.equal(n.flipY, true);
  // 縦の壁(rot 90): u=(0,1)・v=(-1,0)。吊り元が南なら flipX=true、西(v の向き)へ開くなら flipY=false
  const v = run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', to: 'rm_b', hinge: 'S', opens: 'W' } }]).plan.items.at(-1);
  assert.equal(v.flipX, true);
  assert.equal(v.flipY, false);
  // 壁と平行でない向きは断る
  assert.ok(run(walled(), [{ op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', side: 'S', hinge: 'N' } }]).errors.length);
  // 開き戸でない物に吊り元は渡せない
  assert.ok(run(walled(), [{ op: 'placeOpening', args: { type: 'window', room: 'rm_l', side: 'S', hinge: 'E' } }]).errors.length);
});

test('placeOpening: 同じ壁の同じ所に開口が既にあれば断る', () => {
  const p = run(walled(), [{ op: 'placeOpening', args: { type: 'window', room: 'rm_l', side: 'S' } }]).plan;
  const r = run(p, [{ op: 'placeOpening', args: { type: 'window-door', room: 'rm_l', side: 'S' } }]);
  assert.match(r.errors[0].message, /重な/);
});

test('addRoof: 2階の壁の外周(長方形)に、軒の出を足して屋根をかける。屋根の物は floor=3(画面と同じ決まり)', () => {
  const r = run(walled(), [{ op: 'addRoof', args: { floor: 2, shape: 'hip', pitch: 25, overhang: 500 } }]);
  assert.deepEqual(r.errors, []);
  const roof = r.plan.items.at(-1);
  assert.equal(roof.type, 'roof');
  assert.equal(roof.floor, 3);
  assert.equal(roof.roofType, 'hip');
  assert.equal(roof.pitch, 25);
  assert.deepEqual([roof.x, roof.y, roof.w, roof.d, roof.rot], [-500, -500, 9000, 5000, 0]);
});

test('addRoof: 画面の屋根の道具で置いて設定欄で変えた屋根と、同じ欄・同じ値になる', () => {
  const plan = walled();
  const byOp = run(plan, [{ op: 'addRoof', args: { floor: 2, shape: 'gable', ridge: 'NS', pitch: 35, overhang: 450 } }]).plan.items.at(-1);
  // 画面: 屋根の道具で置く(placeItem の roof)→ 設定欄で形と勾配を変える
  const placed = run(plan, [{ op: 'placeItem', args: { type: 'roof', x: 4000, y: 2000, w: 8900, d: 4900, floor: 3 } }]).plan.items.at(-1);
  placed.roofType = 'gable-y';
  placed.pitch = 35;
  const strip = (o) => { const c = { ...o }; delete c.id; return c; };
  assert.deepEqual(Object.keys(byOp), Object.keys(placed), '欄の並びが画面と違う');
  assert.deepEqual(strip(byOp), strip(placed));
});

test('addRoof: 片流れの低い側・切妻の棟の向き・勾配の範囲', () => {
  const plan = walled();
  const one = (args) => run(plan, [{ op: 'addRoof', args: Object.assign({ floor: 2, overhang: 0 }, args) }]);
  // 片流れは rot=0 で低い側が北(読み取りと同じ)。東が低いなら 90°で、幅と奥行きを入れ替えて同じ範囲を覆う
  const n = one({ shape: 'mono' }).plan.items.at(-1);
  assert.deepEqual([n.rot, n.w, n.d], [0, 8000, 4000]);
  const s = one({ shape: 'mono', low: 'S' }).plan.items.at(-1);
  assert.equal(s.rot, 180);
  const e = one({ shape: 'mono', low: 'E' }).plan.items.at(-1);
  assert.deepEqual([e.rot, e.w, e.d, e.x + e.w / 2, e.y + e.d / 2], [90, 4000, 8000, 4000, 2000]);
  // 切妻は棟の向きを省くと長い辺に沿う
  assert.equal(one({ shape: 'gable' }).plan.items.at(-1).roofType, 'gable');
  assert.equal(one({ shape: 'gable', ridge: 'NS' }).plan.items.at(-1).roofType, 'gable-y');
  // 勾配は画面と同じ 5〜60°。外れたら端に寄せて warnings
  const steep = one({ shape: 'gable', pitch: 80 });
  assert.equal(steep.plan.items.at(-1).pitch, 60);
  assert.ok(steep.warnings.some((w) => /60/.test(w)));
  // 画面に無い形は断り、候補を返す
  const bad = one({ shape: 'dome' });
  assert.ok(bad.errors.length);
  assert.ok(bad.errors[0].candidates.includes('hip-ridge'));
});

test('addRoof: 壁の外周が長方形でなければ断り、範囲(x,y,w,d)を渡せば その範囲にかける。同じ階で重なる屋根は断る', () => {
  const plan = walled();
  // L字: 2階に部屋を足して北へ張り出す
  const l = run(plan, [{ op: 'addRoom', args: { x: 1000, y: -1000, w: 2000, d: 2000, floor: 2 } }, { op: 'addRoomWalls', args: { ids: ['rm_101'] } }]);
  assert.deepEqual(l.errors, [], JSON.stringify(l.errors));
  const auto = run(l.plan, [{ op: 'addRoof', args: { floor: 2, shape: 'gable' } }]);
  assert.match(auto.errors[0].message, /長方形/);
  const rect = run(l.plan, [{ op: 'addRoof', args: { floor: 2, shape: 'gable', x: 4000, y: 2000, w: 8000, d: 4000, overhang: 0 } }]);
  assert.deepEqual(rect.errors, []);
  const twice = run(rect.plan, [{ op: 'addRoof', args: { floor: 2, shape: 'flat', x: 4000, y: 2000, w: 8000, d: 4000 } }]);
  assert.match(twice.errors[0].message, /屋根が既に/);
  // 壁の無い階
  assert.match(run(twoRooms(), [{ op: 'addRoof', args: { floor: 2, shape: 'gable' } }]).errors[0].message, /壁/);
});

test('道具の定義: 新しい3つの操作が載り、引数の検査を通る', () => {
  for (const name of ['addRoomWalls', 'placeOpening', 'addRoof']) {
    assert.ok(C.OPERATIONS.some((o) => o.name === name), name);
    assert.ok(O.OPS[name], name);
  }
  assert.ok(C.checkArgs('addRoomWalls', { ids: ['rm_l'], thick: 105 }).ok);
  assert.ok(C.checkArgs('placeOpening', { type: 'door-swing', room: 'rm_l', to: 'rm_b', hinge: 'S', opens: 'W', offset: 100, width: 780 }).ok);
  assert.ok(C.checkArgs('addRoof', { floor: 2, shape: 'gable', ridge: 'NS', pitch: 30, overhang: 450 }).ok);
  assert.ok(!C.checkArgs('addRoof', { floor: 2, shape: 'gable', color: 'red' }).ok);
});

test('屋根の形の表は、画面の設定欄(index.html の roofTypeOptions)と同じ', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const body = html.slice(html.indexOf('function roofTypeOptions(){'), html.indexOf('function isDoorItemType('));
  const screen = [...body.matchAll(/\['([a-z-]+)','/g)].map((m) => m[1]);
  assert.deepEqual(O.ROOF_TYPES, screen);
});

test('Worker の ctx(MCP の受け口が使う)でも、壁・扉・窓・屋根が同じに作れる', async () => {
  const { pathToFileURL } = require('node:url');
  const { workerOpsCtx } = await import(pathToFileURL(path.join(__dirname, '../../worker/plan-ctx.mjs')).href);
  const plan = twoRooms();
  const r = O.applyOperations(plan, [
    { op: 'addRoomWalls', args: { ids: ['rm_l', 'rm_b', 'rm_2'], thick: 105, outerThick: 150 } },
    { op: 'placeOpening', args: { type: 'door-swing', room: 'rm_l', to: 'rm_b', hinge: 'S', opens: 'W' } },
    { op: 'placeOpening', args: { type: 'window', room: 'rm_l', side: 'S' } },
    { op: 'placeOpening', args: { type: 'door-front', room: 'rm_b', side: 'S', hinge: 'E', opens: 'S' } },
    { op: 'addRoof', args: { floor: 2, shape: 'gable', pitch: 30 } },
  ], workerOpsCtx(plan));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(doubled(r.plan.walls), []);
  const [door, win, front, roof] = r.plan.items.slice(-4);
  assert.deepEqual([door.x + door.w / 2, door.y + door.d / 2, door.rot, door.flipX, door.flipY], [5000, 2000, 90, true, false]);
  assert.equal(door.d, door.w, '開き戸の奥行きは幅と同じ');
  assert.deepEqual([win.x + win.w / 2, win.y + win.d / 2, win.rot], [2500, 4000, 0]);
  assert.equal(front.type, 'door-front');
  assert.deepEqual([roof.type, roof.floor, roof.roofType, roof.pitch], ['roof', 3, 'gable', 30]);
});
