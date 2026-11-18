// worker/plan-ctx.mjs(Worker で間取りの操作を当てる ctx・要約・検査)の単体テスト。
// 画面のチャットと同じ結果になるかは、画面テスト worker-ctx-parity.browser.mjs が照らし合わせる。
// ここは、Worker の入口として決めた形(写しに当てる・断る・候補・要約の速さ)を Node で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'worker', 'plan-ctx.mjs')).href);
const Ops = require('../../assets/js/plan-core/operations.js');
const plan = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const center = (o) => ({ x: o.x + o.w / 2, y: o.y + o.d / 2 });
const roomNamed = (p, name, floor) => p.rooms.find((r) => r.n === name && r.floor === floor);

test('代表の操作が当たる(部屋・壁・家具・窓・照明・動かす・回す・消す・設定)', async () => {
  const { workerApply } = await load();
  const p = plan();
  const before = JSON.stringify(p);
  const room = roomNamed(p, '洋室', 1);
  const sofa = p.items.find((it) => /Sofa/.test(it.type));
  const win = p.items.find((it) => it.type === 'window');
  const wall = p.walls[4];
  const cases = [
    { op: 'addRoom', args: { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 } },
    { op: 'addWall', args: { x1: 0, y1: 9000, x2: 3640, y2: 9000, floor: 2 } },
    { op: 'placeItem', args: { type: 'bed', x: 1365, y: 5460, floor: 2 } },
    { op: 'placeItem', args: { type: 'window', x: 1500, y: 0 } },
    { op: 'placeItem', args: { type: 'light-ceiling', x: center(room).x, y: center(room).y } },
    { op: 'moveObject', args: { id: sofa.id, dx: 300, dy: 0 } },
    { op: 'rotateObject', args: { id: sofa.id, by: 90 } },
    { op: 'deleteObjects', args: { ids: [sofa.id, wall.id] } },
    { op: 'setProps', args: { id: win.id, set: { windowHeight: 1000 } } },
    { op: 'setProps', args: { id: wall.id, set: { wallHeight: 2600 } } },
  ];
  for (const op of cases) {
    const r = workerApply(p, [op]);
    assert.deepEqual(r.errors, [], op.op + ' ' + JSON.stringify(op.args));
    assert.ok(r.changedIds.length >= 1, op.op);
    assert.notEqual(r.plan, p, '写しに当てる');
  }
  assert.equal(JSON.stringify(p), before, '渡したプランは変わらない');
  // 照明は天井の高さ、ソファは 300 動き、回転は 0〜360
  const lit = workerApply(p, [cases[4]]).plan.items.at(-1);
  assert.equal(lit.type, 'light-ceiling');
  assert.ok(lit.elev >= 1800 && lit.elev <= 2700, '照明の高さ ' + lit.elev);
  const moved = workerApply(p, [cases[5]]).plan.items.find((it) => it.id === sofa.id);
  assert.equal(moved.x - sofa.x, 300);
  const rot = workerApply(p, [{ op: 'rotateObject', args: { id: sofa.id, rot: -90 } }]).plan.items.find((it) => it.id === sofa.id);
  assert.equal(rot.rot, 270);
});

test('ctx は applyOperations にそのまま渡せる。画面用の props と5階は受けない', async () => {
  const { workerOpsCtx } = await load();
  const p = plan();
  const ctx = workerOpsCtx(p);
  assert.notEqual(ctx.inPlace, true);
  assert.notEqual(ctx.allowProps, true);
  assert.notEqual(ctx.rethrow, true);
  const ok = Ops.applyOperations(p, [{ op: 'placeItem', args: { type: 'sofa', x: 1365, y: 5460 } }], ctx);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.plan.items.at(-1).id, 1288, '連番はプランの id の最大+1 から');
  const props = Ops.applyOperations(p, [{ op: 'setProps', args: { id: p.walls[0].id, props: { color: '#fff' } } }], workerOpsCtx(p));
  assert.match(props.errors[0].message, /props は使えません/);
  const f5 = Ops.applyOperations(p, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, floor: 5 } }], workerOpsCtx(p));
  assert.match(f5.errors[0].message, /1〜4/);
});

test('連番の始まりは画面の ensureObjectIds と同じ数え方(部屋の id の末尾の数も数える)', async () => {
  const { firstNewId } = await load();
  assert.equal(firstNewId({ walls: [{ id: 5 }], items: [{ id: '12' }], rooms: [{ id: 'rm_1700000000000' }] }), 1700000000001);
  assert.equal(firstNewId({ walls: [], items: [], rooms: [] }), 1);
  assert.equal(firstNewId(plan()), 1288);
});

test('断る: 台の上・吹き抜けの天井の器具・器具のある部屋の天井高。プランは変わらない', async () => {
  const { workerApply, REFUSAL } = await load();
  const p = plan();
  const before = JSON.stringify(p);
  const table = p.items.find((it) => /Table/.test(it.type) && (it.floor || 1) === 1);
  const voidRoom = p.rooms.find((r) => r.ceiling && r.ceiling.type === 'void');
  const lit = p.items.find((it) => it.type === 'light-down' && it.floor === 1);
  const litRoom = p.rooms.find((r) => r.floor === 1 && center(lit).x >= r.x && center(lit).x <= r.x + r.w && center(lit).y >= r.y && center(lit).y <= r.y + r.d);
  const cases = [
    [{ op: 'placeItem', args: { type: 'plant', x: center(table).x, y: center(table).y } }, /台・棚・基礎/],
    [{ op: 'placeItem', args: { type: 'light-ceiling', x: center(voidRoom).x, y: center(voidRoom).y } }, /勾配天井・吹き抜け/],
    [{ op: 'placeItem', args: { type: 'fmp-CeilingFan01', x: center(voidRoom).x, y: center(voidRoom).y } }, /勾配天井・吹き抜け/],
    [{ op: 'setProps', args: { id: litRoom.id, set: { ceilingHeight: 2600 } } }, /天井に付いた照明/],
    [{ op: 'setProps', args: { id: litRoom.id, set: { void: 'yes' } } }, /天井に付いた照明/],
    [{ op: 'placeItem', args: { type: 'opening-door-model:default', x: 1500, y: 0 } }, /モデルを指定して/],
  ];
  for (const [op, why] of cases) {
    const r = workerApply(p, [op]);
    assert.equal(r.errors.length, 1, JSON.stringify(op));
    assert.ok(r.errors[0].message.startsWith(REFUSAL), r.errors[0].message);
    assert.match(r.errors[0].message, why);
    assert.equal(r.plan, p);
  }
  assert.equal(JSON.stringify(p), before);
  // 器具の無い部屋の天井高は変えられる
  const plain = p.rooms.find((r) => !p.items.some((it) => /^light-|CeilingFan|laundry-rail/.test(it.type) && it.floor === r.floor
    && center(it).x >= r.x && center(it).x <= r.x + r.w && center(it).y >= r.y && center(it).y <= r.y + r.d));
  assert.deepEqual(workerApply(p, [{ op: 'setProps', args: { id: plain.id, set: { ceilingHeight: 2600 } } }]).errors, []);
});

test('段差の部屋の柱は、画面と同じく段差の下まで伸ばす', async () => {
  const { workerApply } = await load();
  const p = plan();
  const room = roomNamed(p, '洋室', 1);
  room.skipLevelMm = 600;
  const r = workerApply(p, [{ op: 'placeItem', args: { type: 'column', x: room.x + 300, y: room.y + 300 } }]);
  assert.deepEqual(r.errors, []);
  const col = r.plan.items.at(-1);
  assert.equal(col.baseLevel, 'under');
  assert.ok(col.columnHeight >= 600);
  room.skipLevelMm = 300;
  const low = workerApply(p, [{ op: 'placeItem', args: { type: 'column', x: room.x + 300, y: room.y + 300 } }]).plan.items.at(-1);
  assert.equal(low.baseLevel, undefined, '段差が 400 未満なら伸ばさない(床の上げとの合計で見る)');
});

test('知らない種類は候補つきで断る。分類名は家具に引く', async () => {
  const { workerApply } = await load();
  const p = plan();
  const r = workerApply(p, [{ op: 'placeItem', args: { type: 'sofaa', x: 0, y: 0 } }]);
  assert.match(r.errors[0].message, /カタログにありません/);
  assert.ok(r.errors[0].candidates.includes('sofa'), JSON.stringify(r.errors[0].candidates));
  const ku = workerApply(p, [{ op: 'placeItem', args: { type: 'kitchen-unit', x: 0, y: 0 } }]);
  assert.match(ku.errors[0].message, /部品の台を並べて/);
  assert.ok(ku.errors[0].candidates.includes('kitchen-sink'));
  const sofa = workerApply(p, [{ op: 'placeItem', args: { type: 'sofa', x: 1365, y: 5460 } }]).plan.items.at(-1);
  assert.match(sofa.type, /^(fmp-|im0261-|original-)/, '分類名 sofa はカタログの家具になる');
  const hood = workerApply(p, [{ op: 'placeItem', args: { type: 'range-hood', x: 1365, y: 5460 } }]).plan.items.at(-1);
  assert.equal(hood.elev, 1650, '読み取りと同じ取付の高さ');
});

test('壁を消すと外壁の設定表の行も片付く。外壁の色は設定表に書く', async () => {
  const { workerApply, workerOpsCtx } = await load();
  const p = plan();
  const key = Object.keys(p.exteriorWallSettings.walls)[0];
  const wall = p.walls.find((w) => String(w.id) === key);
  const r = workerApply(p, [{ op: 'removeWall', args: { id: wall.id } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.plan.exteriorWallSettings.walls[key], undefined);
  assert.ok(p.exteriorWallSettings.walls[key], '元のプランは変わらない');
  const q = plan();
  Ops.applyProp(q.walls[0], 'exteriorColor', '#123456', q, workerOpsCtx(q));
  assert.equal(q.exteriorWallSettings.walls[String(q.walls[0].id)].color, '#123456');
});

test('要約は <plan_summary> の囲みつき。物を3倍にしても 5ms 以内(20回の中央値)', async () => {
  const { workerSummarize } = await load();
  const p = plan();
  const s = workerSummarize(p);
  assert.ok(s.startsWith('<plan_summary>\n') && s.endsWith('\n</plan_summary>'));
  assert.match(s, /id=r1019 部屋「浴室」/);
  assert.match(s, /light-down（ダウンライト）/, '呼び名は種類の表から');
  const big = plan();
  const extra = [];
  for (let k = 1; k <= 2; k++) big.items.forEach((it) => extra.push(Object.assign({}, it, { id: it.id + k * 100000 })));
  big.items = big.items.concat(extra);
  workerSummarize(big);
  const times = [];
  for (let i = 0; i < 20; i++) { const t0 = performance.now(); workerSummarize(big); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const median = times[10];
  assert.ok(median <= 5, '要約の中央値 ' + median.toFixed(2) + 'ms(物 ' + big.items.length + ' 個)');
});

test('検査は {ok, errors, warnings} を返す', async () => {
  const { workerInspect } = await load();
  const r = workerInspect(plan());
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings));
  const broken = plan();
  broken.items.push(Object.assign({}, broken.items[0]));
  assert.equal(workerInspect(broken).ok, false, 'id の重なりは誤り');
});

test('連番の数え始めを外から渡せる。渡さなければ今までどおり plan の最大 + 1。部屋も同じ連番', async () => {
  const { workerApply, firstNewId } = await load();
  const p = plan();
  const base = firstNewId(p);
  const bed = { op: 'placeItem', args: { type: 'bed', x: 1365, y: 5460, floor: 2 } };
  const a = workerApply(p, [bed]);
  assert.equal(a.plan.items.at(-1).id, base);
  assert.equal(a.nextId, base + 1);
  const b = workerApply(p, [bed], { firstId: base + 50 });
  assert.equal(b.plan.items.at(-1).id, base + 50);
  assert.equal(b.nextId, base + 51);
  const c = workerApply(p, [bed], { firstId: 3 });
  assert.equal(c.plan.items.at(-1).id, base, 'plan の値より小さい数え始めは使わない');
  const r = workerApply(p, [{ op: 'addRoom', args: { x: 20000, y: 20000, w: 2730, d: 3640 } }], { firstId: base + 7 });
  assert.equal(r.plan.rooms.at(-1).id, 'rm_' + (base + 7));
  assert.equal(r.nextId, base + 8);
});

test('要約: 種類名が constructor・__proto__ の物があっても例外にならない', async () => {
  const { workerSummarize } = await load();
  const p = plan();
  for (const t of ['constructor', '__proto__', 'toString']) {
    p.items.push({ id: 'odd-' + t + '-1', type: t, x: 0, y: 0, w: 500, d: 500, floor: 1 });
    p.items.push({ id: 'odd-' + t + '-2', type: t, x: 600, y: 0, w: 500, d: 500, floor: 2 });
  }
  const s = workerSummarize(p);
  assert.ok(s.startsWith('<plan_summary>\n') && s.endsWith('\n</plan_summary>'));
  for (const t of ['constructor', '__proto__', 'toString']) assert.ok(s.includes('id=odd-' + t + '-1 ' + t + ' 1階'), t);
});
