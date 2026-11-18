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
