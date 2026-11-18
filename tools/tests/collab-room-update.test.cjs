// 共同編集のルーム(worker/collab-room.mjs)の、今ある経路の動き。
// 本物の CollaborationRoom と routes-rooms.mjs を、偽の storage・R2・WebSocket(collab-room-fakes.cjs)で動かす。
//
// 段5で /update の処理を関数に切り出した(外の AI の操作と共用するため)。切り出しの前にこのテストを書いて通し、
// 切り出しの後も同じに通ることを確かめた。外から見た動き(返事の欄・状態・積み方・配信・R2 への置き方)を変えないための物。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeEnv, connect } = require('./collab-room-fakes.cjs');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const plan = () => JSON.parse(fs.readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const ORIGIN = 'https://cad-planner.example.test';

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

test('POST /api/rooms: R2 に置き、meta を初期化し、共有の URL を返す', async () => {
  const env = await makeEnv();
  const p = plan();
  const before = Date.now();
  const made = await createRoom(env, p);
  assert.deepEqual(Object.keys(made), ['roomId', 'url', 'version', 'expiresAt', 'savedAt']);
  assert.match(made.roomId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(made.url, `${ORIGIN}/#room=${made.roomId}`);
  assert.equal(made.version, 1);
  assert.ok(made.savedAt >= before);
  assert.equal(made.expiresAt, made.savedAt + 60 * 24 * 60 * 60 * 1000);
  const stored = env.PLANS.objects.get(`rooms/${made.roomId}.json`);
  assert.equal(stored.body, JSON.stringify(p));
  assert.deepEqual(stored.customMetadata, { updatedAt: String(made.savedAt), expiresAt: String(made.expiresAt), version: '1' });
  assert.deepEqual(stored.httpMetadata, { contentType: 'application/json' });
  const room = env.room(made.roomId);
  assert.deepEqual(await room.storage.get('meta'), {
    roomId: made.roomId, version: 1, updatedAt: made.savedAt, expiresAt: made.expiresAt,
    savedAt: made.savedAt, dirtySince: null, checkpointDueAt: null,
  });
  assert.equal(room.storage.alarmAt(), made.expiresAt);
});

test('POST /api/rooms: 形の違うプランは 400、ルームを作らない', async () => {
  const env = await makeEnv();
  const res = await call(env, 'POST', '/api/rooms', { walls: [] });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid_plan' });
  const bad = await call(env, 'POST', '/api/rooms', '{oops');
  assert.equal(bad.status, 400);
  assert.equal(env.ROOMS.created.length, 0);
  assert.equal(env.PLANS.objects.size, 0);
});

test('GET /api/rooms/:id: 元の全体に積んだ差分を当てて返す。版は見出しに', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const res = await call(env, 'GET', `/api/rooms/${made.roomId}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-room-version'), '1');
  assert.deepEqual(await res.json(), plan());
  const missing = await call(env, 'GET', '/api/rooms/AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(missing.status, 404);
  const badId = await call(env, 'GET', '/api/rooms/short');
  assert.equal(badId.status, 404);
  assert.deepEqual(env.ROOMS.created.filter((n) => n === 'short'), [], '形の違う id では Durable Object を作らない');
});

test('POST /update: 版を進め、差分を積み、期限と書き戻しの予約を更新し、全員へ流す', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const a = connect(room, 'client-a');
  const b = connect(room, 'client-b');
  const sofa = plan().items[0];
  const patch = { collections: { items: { upserts: [{ ...sofa, x: sofa.x + 300 }], removes: [] } }, fields: {} };
  const t0 = Date.now();
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'client-a', baseVersion: 1, patch });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['version', 'expiresAt', 'savedAt', 'checkpointPending', 'conflict']);
  assert.equal(body.version, 2);
  assert.equal(body.savedAt, made.savedAt);
  assert.equal(body.checkpointPending, true);
  assert.equal(body.conflict, false);
  assert.ok(body.expiresAt >= t0 + 60 * 24 * 60 * 60 * 1000);

  const meta = await room.storage.get('meta');
  assert.equal(meta.version, 2);
  assert.equal(meta.expiresAt, body.expiresAt);
  assert.ok(meta.dirtySince >= t0);
  assert.equal(meta.checkpointDueAt, Math.min(meta.updatedAt + 10000, meta.dirtySince + 30000));
  assert.equal(room.storage.alarmAt(), meta.checkpointDueAt);
  assert.deepEqual(await room.storage.get('patch:000000000002'), patch);

  for (const ws of [a, b]) {
    assert.deepEqual(ws.messages(), [{ type: 'patch', version: 2, expiresAt: body.expiresAt, clientId: 'client-a', patch }]);
  }
  // 古い版を土台にした差分も受けて積む(conflict で知らせるだけ)。dirtySince は最初の未保存の時刻のまま
  const res2 = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, {
    type: 'patch', clientId: 'x'.repeat(80), baseVersion: 1,
    patch: { collections: { items: { upserts: [], removes: [String(sofa.id)] } }, fields: { northDeg: 15 } },
  });
  const body2 = await res2.json();
  assert.equal(body2.version, 3);
  assert.equal(body2.conflict, true);
  assert.equal((await room.storage.get('meta')).dirtySince, meta.dirtySince);
  assert.equal(a.messages()[1].clientId, 'x'.repeat(64), 'clientId は 64 文字で切る');
  assert.deepEqual(Array.from((await room.storage.list({ prefix: 'patch:' })).keys()), ['patch:000000000002', 'patch:000000000003']);

  const got = await call(env, 'GET', `/api/rooms/${made.roomId}`);
  assert.equal(got.headers.get('x-room-version'), '3');
  const after = await got.json();
  assert.equal(after.items.some((it) => String(it.id) === String(sofa.id)), false);
  assert.equal(after.northDeg, 15);
  assert.equal(env.PLANS.objects.get(`rooms/${made.roomId}.json`).body, JSON.stringify(plan()), '書き戻しまで R2 は元のまま');
});

test('POST /update: 形の違う本文は 400、期限切れは 410。どちらも何も積まず流さない', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const a = connect(room, 'client-a');
  for (const body of [{ type: 'snapshot', patch: {} }, { type: 'patch' }]) {
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_patch' });
  }
  const broken = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, '{');
  assert.equal(broken.status, 400);
  assert.equal((await room.storage.get('meta')).version, 1);
  assert.equal(a.sent.length, 0);

  const meta = await room.storage.get('meta');
  await room.storage.put('meta', { ...meta, expiresAt: Date.now() - 1 });
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', baseVersion: 1, patch: {} });
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { error: 'expired' });
  assert.equal((await room.storage.list({ prefix: 'patch:' })).size, 0);
  assert.equal(a.sent.length, 0);
  // 取得は期限切れのルームを片付ける(R2 と storage を消し、つないでいる人を閉じる)
  const got = await call(env, 'GET', `/api/rooms/${made.roomId}`);
  assert.equal(got.status, 410);
  assert.equal(env.PLANS.objects.has(`rooms/${made.roomId}.json`), false);
  assert.equal(room.storage.data.size, 0);
  assert.equal(a.closeCode, 4001);
});

test('POST /update: 大きな差分はその場で R2 に書き戻し、patch のあとに checkpoint を流す', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const a = connect(room, 'client-a');
  const sofa = plan().items[0];
  const patch = { collections: { items: { upserts: [{ ...sofa, memo: 'あ'.repeat(600000) }], removes: [] } }, fields: {} };
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'client-a', baseVersion: 1, patch });
  const body = await res.json();
  assert.equal(body.version, 2);
  assert.equal(body.checkpointPending, false);
  assert.ok(body.savedAt >= made.savedAt);
  assert.equal((await room.storage.list({ prefix: 'patch:' })).size, 0, '積まずに書き戻す');
  const stored = env.PLANS.objects.get(`rooms/${made.roomId}.json`);
  assert.equal(JSON.parse(stored.body).items[0].memo.length, 600000);
  assert.equal(stored.customMetadata.version, '2');
  const meta = await room.storage.get('meta');
  assert.equal(meta.dirtySince, null);
  assert.equal(meta.checkpointDueAt, null);
  assert.deepEqual(a.messages().map((m) => m.type), ['patch', 'checkpoint']);
  assert.equal(a.messages()[1].version, 2);
  assert.equal(a.messages()[1].savedAt, body.savedAt);
});

test('alarm: 書き戻しの予約の時刻を過ぎていれば、積んだ差分を R2 に書き戻して checkpoint を流す', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const a = connect(room, 'client-a');
  await call(env, 'POST', `/api/rooms/${made.roomId}/update`, {
    type: 'patch', clientId: 'client-a', baseVersion: 1, patch: { collections: {}, fields: { northDeg: 30 } },
  });
  const meta = await room.storage.get('meta');
  await room.storage.put('meta', { ...meta, checkpointDueAt: Date.now() - 1 });
  await room.instance.alarm();
  assert.equal(JSON.parse(env.PLANS.objects.get(`rooms/${made.roomId}.json`).body).northDeg, 30);
  assert.equal((await room.storage.list({ prefix: 'patch:' })).size, 0);
  assert.deepEqual(a.messages().map((m) => m.type), ['patch', 'checkpoint']);
});

test('POST /save: 全体を R2 に置き直し、積んだ差分を消し、snapshot を流す', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const a = connect(room, 'client-a');
  await call(env, 'POST', `/api/rooms/${made.roomId}/update`, {
    type: 'patch', clientId: 'client-a', baseVersion: 1, patch: { collections: {}, fields: { northDeg: 30 } },
  });
  const p = plan();
  p.northDeg = 45;
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/save`, { clientId: 'client-a', baseVersion: 2, plan: p });
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['version', 'expiresAt', 'savedAt']);
  assert.equal(body.version, 3);
  assert.equal((await room.storage.list({ prefix: 'patch:' })).size, 0);
  assert.equal(env.PLANS.objects.get(`rooms/${made.roomId}.json`).body, JSON.stringify(p));
  assert.deepEqual(a.messages().map((m) => m.type), ['patch', 'snapshot']);
});

test('外へ出している経路は今までどおり。ルームの中の経路は /api/rooms/:id/… から呼べない', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  for (const path of ['/initialize', '/op', '/read', '/plan']) {
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}${path}`, { op: 'placeItem', args: {} });
    assert.equal(res.status, 404, path);
  }
  assert.equal((await env.room(made.roomId).storage.get('meta')).version, 1);
});
