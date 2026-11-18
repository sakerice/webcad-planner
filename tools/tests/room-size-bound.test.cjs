// 共同編集の部屋の保存の上限の見積もりが、同じ id の物を並べたプランや古い部屋でもすり抜けないこと(2026-11-19 再検査)。
// 本物の CollaborationRoom と routes-rooms.mjs を、偽の storage・R2・WebSocket(collab-room-fakes.cjs)で動かす。
//
// 差分の当て方(plan-core/patch.js)は、同じ id の物が何個あっても全部をその upsert の物に置き換える。
// そのため「当てたあとは 本体 + 積んだ差分 + 今回の差分 より大きくならない」は id が重ならないときだけ成り立つ。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeEnv } = require('./collab-room-fakes.cjs');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const plan = () => JSON.parse(fs.readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const ORIGIN = 'https://cad-planner.example.test';
const P = require('../../assets/js/plan-core/patch.js');

async function call(env, method, path, body) {
  const { handleRooms } = await mod('worker/routes-rooms.mjs');
  const url = new URL(path, ORIGIN);
  const init = { method };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handleRooms(new Request(url, init), env, url);
}
async function createRoom(env, p = plan()) {
  const res = await call(env, 'POST', '/api/rooms', p);
  assert.equal(res.status, 201);
  return res.json();
}
const dupPlan = (n) => ({ walls: [], items: Array.from({ length: n }, () => ({ id: 'a' })), rooms: [] });

test('POST /api/rooms と /save: 同じ集まりに同じ id が 8 個を超えるプランは 400(手元の正当なプランは最大2個)', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, 'POST', '/api/rooms', dupPlan(9))).status, 400);
  assert.equal((await call(env, 'POST', '/api/rooms', dupPlan(8))).status, 201, '8 個までは通す');
  const made = await createRoom(env);
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/save`, { clientId: 'a', baseVersion: 1, plan: dupPlan(50000) });
  assert.equal(res.status, 400);
  assert.equal((await env.room(made.roomId).storage.get('meta')).version, 1);
  // 数の id と文字の id は同じ鍵(String)で当たるので、合わせて数える
  const mixed = { walls: [], items: [...Array(5)].map(() => ({ id: 7 })).concat([...Array(5)].map(() => ({ id: '7' }))), rooms: [] };
  assert.equal((await call(env, 'POST', '/api/rooms', mixed)).status, 400);
});

// 検査の前に置かれた、同じ id が多い本体(R2)を持つ古い部屋
async function oldRoomWithDups(env, n) {
  const made = await createRoom(env);
  const body = JSON.stringify(dupPlan(n));
  env.PLANS.objects.get(`rooms/${made.roomId}.json`).body = body;
  return made;
}

test('/update: 同じ id が多い本体の部屋では、小さい差分でも当てたあとが上限を超えるなら 413。プランを作らずに断る', async () => {
  const env = await makeEnv();
  const made = await oldRoomWithDups(env, 50000);
  const room = env.room(made.roomId);
  // 当てて測る道に入ったら分かるようにする(膨らんだプランをメモリに作らないこと)
  let materialized = 0;
  const orig = room.instance.materializePlan.bind(room.instance);
  room.instance.materializePlan = async (...a) => { materialized++; return orig(...a); };
  const patch = { collections: { items: { upserts: [{ id: 'a', x: 0, y: 0, pad: 'p'.repeat(2000) }], removes: [] } } };
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 1, patch });
  assert.equal(res.status, 413);
  assert.equal(materialized, 0, '当ててから測った');
  assert.equal((await room.storage.get('meta')).version, 1);
  assert.equal((await room.storage.list({ prefix: 'patch:' })).size, 0);
  // 当てても増えない差分(新しい id の物)は通る
  const ok = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 1, patch: { collections: { items: { upserts: [{ id: 'b', x: 1 }], removes: [] } } } });
  assert.equal(ok.status, 200);
  const got = await call(env, 'GET', `/api/rooms/${made.roomId}`);
  assert.ok((await got.text()).length < 2 * 1024 * 1024);
});

test('/update: 同じ id が2個の正当な部屋で、上限近くの差分は実際に測って判断する', async () => {
  const env = await makeEnv();
  const p = plan();
  p.items.push({ ...p.items[0] });   // 同じ id が2個(raised-floor-plan.json に実際にある形)
  const made = await createRoom(env, p);
  const big = { ...p.items[0], memo: 'm'.repeat(5 * 1024 * 1024) };
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 1, patch: { collections: { items: { upserts: [big], removes: [] } } } });
  assert.equal(res.status, 413, '2個とも 5MB に置き換わると 10MB を超える');
  const half = { ...p.items[0], memo: 'm'.repeat(3 * 1024 * 1024) };
  const ok = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 1, patch: { collections: { items: { upserts: [half], removes: [] } } } });
  assert.equal(ok.status, 200);
});

test('/update: 積んだ差分の大きさを持たない古い部屋では、積んである差分を1回数えて meta に書く', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  // 古い部屋: 積んだ差分が 9.8MB ぶんあり、meta に journalBytes・planBytes が無い
  for (let i = 0; i < 7; i++) {
    await room.storage.put('patch:' + String(i + 2).padStart(12, '0'), { collections: { items: { upserts: [{ id: 'old' + i, memo: 'o'.repeat(1400 * 1000) }], removes: [] } } });
  }
  const meta = await room.storage.get('meta');
  delete meta.journalBytes; delete meta.planBytes;
  await room.storage.put('meta', { ...meta, version: 8 });
  let materialized = 0;
  const orig = room.instance.materializePlan.bind(room.instance);
  room.instance.materializePlan = async (...a) => { materialized++; return orig(...a); };
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 8, patch: { collections: { items: { upserts: [{ id: 'new', memo: 'n'.repeat(1400 * 1000) }], removes: [] } } } });
  assert.equal(res.status, 413, '積んである差分を数えずに受けた');
  assert.ok(materialized >= 1, '見積もりが上限を超えたのに測っていない');
  const small = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 8, patch: { collections: {}, fields: { northDeg: 5 } } });
  assert.equal(small.status, 200);
  const after = await room.storage.get('meta');
  assert.ok(Number.isFinite(after.journalBytes) && after.journalBytes > 9 * 1000 * 1000, '数えた大きさを meta に書いていない: ' + after.journalBytes);
});

test('差分の当て方: id が Object.prototype の名前の物は、upserts でも removes でも飛ばす', () => {
  const p = { walls: [{ id: 'constructor', v: 0 }, { id: 1 }], items: [], rooms: [] };
  P.applyPatch(p, { collections: { walls: { upserts: [{ id: 'toString', v: 1 }, { id: 'constructor', v: 2 }, { id: 2 }], removes: ['__proto__', 'constructor'] } } });
  assert.deepEqual(p.walls, [{ id: 'constructor', v: 0 }, { id: 1 }, { id: 2 }]);
});

// ── 最終検査のあと(2026-11-19)。id の無い物・null の物を並べて、見積もりをすり抜ける形 ──
const noIdPlan = (n, mk) => ({ walls: [], items: Array.from({ length: n }, mk), rooms: [] });
const bigUpsert = (id) => ({ collections: { items: { upserts: [{ id, x: 0, y: 0, pad: 'p'.repeat(2000) }], removes: [] } } });

test('/save のあと id の無い物・null の物に当てる upsert は断られ、部屋は膨らまない(検査役の3つの形)', async () => {
  const forms = [
    ['id 無し × 50000 に "undefined"', noIdPlan(50000, () => ({})), 'undefined'],
    ['null × 50000 に "null"', noIdPlan(50000, () => ({ id: null })), 'null'],
    ['"undefined" × 8 + id 無し × 49992 に "undefined"', noIdPlan(50000, (_, i) => (i < 8 ? { id: 'undefined' } : {})), 'undefined'],
  ];
  for (const [label, p, id] of forms) {
    const env = await makeEnv();
    const made = await createRoom(env);
    const saved = await call(env, 'POST', `/api/rooms/${made.roomId}/save`, { clientId: 'a', baseVersion: 1, plan: p });
    assert.equal(saved.status, 200, label + ' /save(id の無い物を含む古いプランは弾かない)');
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 2, patch: bigUpsert(id) });
    assert.equal(res.status, 400, label);
    const got = await call(env, 'GET', `/api/rooms/${made.roomId}`);
    assert.ok((await got.text()).length < 2 * 1024 * 1024, label + ': 部屋が膨らんだ');
  }
});

test('差分の当て方: プランの id の無い物・null の物には upsert を当てない(古い Worker が積んだ差分でも膨らまない)', async () => {
  const p = noIdPlan(5, (_, i) => (i % 2 ? {} : { id: null }));
  P.applyPatch(p, { collections: { items: { upserts: [{ id: 'undefined', v: 1 }, { id: 'null', v: 2 }, { v: 3 }], removes: [] } } });
  // 当たらない upsert は新しい物として足す。id の無い upsert の物は、今までどおり "undefined" の鍵で1つにまとまる(後の物が勝つ)
  assert.equal(p.items.length, 7);
  assert.deepEqual(p.items.slice(5), [{ v: 3 }, { id: 'null', v: 2 }]);
  assert.ok(p.items.slice(0, 5).every((x) => Object.keys(x).length <= 1), 'id の無い物・null の物が置き換わった');
  // removes は今までどおり idOf で当てる(画面は id を振る前の物を "undefined" で消す)
  P.applyPatch(p, { collections: { items: { upserts: [], removes: ['undefined'] } } });
  assert.deepEqual(p.items.map((x) => x.id), [null, null, null, 'null']);
  // 古い Worker が積んだ差分の部屋を開いても膨らまない
  const env = await makeEnv();
  const made = await createRoom(env);
  env.PLANS.objects.get(`rooms/${made.roomId}.json`).body = JSON.stringify(noIdPlan(50000, () => ({})));
  await env.room(made.roomId).storage.put('patch:000000000002', bigUpsert('undefined'));
  const got = await call(env, 'GET', `/api/rooms/${made.roomId}`);
  assert.ok((await got.text()).length < 2 * 1024 * 1024);
});

test('作成と /save の「同じ id は 8 個まで」は、当て方と同じ鍵で数える(id の無い物は upsert が当たらないので数えない)', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, 'POST', '/api/rooms', noIdPlan(9, () => ({ id: 'undefined' })))).status, 400, '文字の "undefined" は同じ鍵');
  assert.equal((await call(env, 'POST', '/api/rooms', noIdPlan(50, () => ({})))).status, 201, 'id の無い物そのものは断らない');
  assert.equal((await call(env, 'POST', '/api/rooms', noIdPlan(9, () => ({ id: '' })))).status, 400, '空の文字の id は同じ鍵として数える');
});

test('見積もりの2段目: 安い見積もりが上限を超えても、当て方と同じ規則の上界が収まれば、当てずに受ける', async () => {
  const env = await makeEnv();
  const p = plan();
  p.items.push({ ...p.items[0] });   // 同じ id が2個(安い見積もりは差分に2を掛ける)
  const made = await createRoom(env, p);
  const room = env.room(made.roomId);
  let materialized = 0;
  const orig = room.instance.materializePlan.bind(room.instance);
  room.instance.materializePlan = async (...a) => { materialized++; return orig(...a); };
  // 新しい id の 6MB の物: 安い見積もりは 本体 + 12MB で上限を超えるが、実際には1つ足すだけ
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 1, patch: { collections: { items: { upserts: [{ id: 'new', memo: 'm'.repeat(6 * 1024 * 1024) }], removes: [] } } } });
  assert.equal(res.status, 200);
  assert.equal(materialized, 1, '上界が上限以下なら、書き戻しのとき以外にプランを作らない');
});

// 性質: 無作為のプランと差分の列で、当て方と同じ規則で数えた上界 ≥ 実際に当てた大きさ。
// 数え方が当て方とずれたら落ちる(id の無い物・null・数と文字の id・重なる id・removes・欄を混ぜる)。
test('性質: patchGrowthBound の上界は、実際に当てたあとの大きさ以上(無作為 400 通り)', async () => {
  const { upsertKeyCounts, maxSameId } = await mod('worker/room-guard.mjs');
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const ids = [undefined, null, 1, '1', 2, 'a', '', 'undefined', 'null', 3];
  const mkItem = () => { const o = { x: rnd(1000), pad: 'q'.repeat(rnd(40)) }; const id = ids[rnd(ids.length)]; if (id !== undefined) o.id = id; return o; };
  const size = (v) => Buffer.byteLength(JSON.stringify(v === undefined ? null : v));
  for (let trial = 0; trial < 400; trial++) {
    const p = { walls: [], items: [], rooms: [] };
    for (const name of P.COLLECTIONS) for (let i = rnd(12); i > 0; i--) p[name].push(mkItem());
    if (rnd(2)) p.northDeg = rnd(360);
    const counts = upsertKeyCounts(p);
    const countOf = (name, key) => counts[name].get(key) || 0;
    const k = Math.max(1, maxSameId(p));
    let bound = size(p), quick = size(p);
    const q = JSON.parse(JSON.stringify(p));
    for (let step = rnd(5) + 1; step > 0; step--) {
      const patch = { collections: {}, fields: {} };
      for (const name of P.COLLECTIONS) {
        if (!rnd(2)) continue;
        const upserts = []; for (let i = rnd(4); i > 0; i--) upserts.push(mkItem());
        const removes = []; for (let i = rnd(3); i > 0; i--) removes.push(String(ids[rnd(ids.length)]));
        patch.collections[name] = { upserts, removes };
      }
      if (rnd(2)) patch.fields.northDeg = rnd(360);
      if (rnd(3) === 0) patch.fields.floors = { 1: { pad: 'f'.repeat(rnd(50)) } };
      bound += P.patchGrowthBound(patch, countOf, size);
      quick += size(patch) * k;
      P.applyPatch(q, patch);
      assert.ok(size(q) <= bound, `試行 ${trial}: 上界 ${bound} < 実際 ${size(q)}`);
      assert.ok(size(q) <= quick, `試行 ${trial}: 安い見積もり ${quick} < 実際 ${size(q)}`);
    }
  }
});

test('Worker の大きさの数え方は、当て方と同じ関数(PlanCorePatch.upsertKey・patchGrowthBound)を使う', () => {
  const guard = fs.readFileSync(join(ROOT, 'worker/room-guard.mjs'), 'utf8');
  const room = fs.readFileSync(join(ROOT, 'worker/collab-room.mjs'), 'utf8');
  assert.match(guard, /PlanCorePatch\.upsertKey\(/, 'room-guard.mjs が当て方の鍵の関数を使っていない');
  assert.match(room, /PlanCorePatch\.patchGrowthBound\(/, 'collab-room.mjs が当て方と同じ上界の関数を使っていない');
  assert.ok(!/String\(item\.id\)/.test(guard), 'room-guard.mjs が自前で id を文字にして数えている');
});
