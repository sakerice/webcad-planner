// 共同編集のルームへの書き込みの、ルームをまたいだ全体の上限(worker/room-quota.mjs・worker/collab-room.mjs・worker/routes-rooms.mjs)。
//
// 見ていること:
//   - 画面の書き込み(/update・/save)は 20 回ぶんをまとめて数え、全体・接続元ごとの上限で 429(write_limit)で断る。
//     断ったときルームは1つも変わらない。読むのは止めない。
//   - 外の AI の操作(/op)は積んだ数を1回ずつ数え、全体の上限で断る。画面の数とは別に持つ。
//   - 画面からのルームの作成も接続元ごと・全体で数える。
//   - 数える先が壊れているとき、画面は通し、外の AI は断る。束縛が無いとき(手元の検査)は数えずに通す。
//   - 断るときの文は日本語で、開発の都合(行・費用・トークン)を出さない。返事に retry-after が付く。
// (止めるスイッチの素通りの検査は tools/tests/room-switch-bypass.test.cjs)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeEnv, connect, fakeState } = require('./collab-room-fakes.cjs');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const plan = () => JSON.parse(fs.readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const ORIGIN = 'https://cad-planner.example.test';
const today = () => new Date().toISOString().slice(0, 10);

// 画面からの要求は Origin が付く(ブラウザは同じ出どころへの POST にも付ける)。外の道具の素の HTTP には無い。
async function http(env, method, path, body, { origin = null, ip = null, headers = {} } = {}) {
  const { handleRooms } = await mod('worker/routes-rooms.mjs');
  const url = new URL(path, ORIGIN);
  const init = { method, headers: { ...headers } };
  if (origin) init.headers.origin = origin;
  if (ip) init.headers['cf-connecting-ip'] = ip;
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handleRooms(new Request(url, init), env, url);
}
const SCREEN = { origin: ORIGIN };

// 本物の AiQuota を名前ごとに1つ作る(tools/tests/worker-mcp.test.cjs と同じ)。
async function addQuota(env) {
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const quotas = new Map();
  env.AI_QUOTA = {
    created: [],
    idFromName(name) { return { name: String(name) }; },
    get(id) {
      if (!quotas.has(id.name)) {
        env.AI_QUOTA.created.push(id.name);
        const state = fakeState();
        quotas.set(id.name, { state, instance: new AiQuota(state, env) });
      }
      const q = quotas.get(id.name);
      return { fetch: (input, init) => q.instance.fetch(input instanceof Request ? input : new Request(input, init)) };
    },
  };
  env.quota = (name) => { env.AI_QUOTA.get({ name }); return quotas.get(name); };
  return env;
}
const usedTotal = async (env, name) => Number(await env.quota(name).state.storage.get(`total:${today()}`) || 0);

async function setup({ quota = false } = {}) {
  const rooms = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  if (quota) await addQuota(env);
  const made = await rooms.createRoomWithPlan(env, plan(), ORIGIN);
  return { env, rooms, roomId: made.roomId, room: env.room(made.roomId) };
}
function snapshotRoom(env, room) {
  return JSON.stringify({ storage: Array.from(room.storage.data.entries()), alarm: room.storage.alarmAt(), r2: Array.from(env.PLANS.objects.entries()) });
}
function wallPatch(thick) {
  const wall = { ...plan().walls[0], thick };
  return { type: 'patch', clientId: 'client-a', baseVersion: 1, patch: { collections: { walls: { upserts: [wall], removes: [] } }, fields: {} } };
}
// 利用者に見せる文に、開発の都合を出していないこと
function assertUserText(s) {
  assert.match(s, /[ぁ-ん]/, '日本語でない: ' + s);
  assert.doesNotMatch(s, /トークン|token|費用|料金|円|ドル|\$|行|Durable|quota|limit|\d{3,}/i, '開発の都合が出ている: ' + s);
}

// ── ルームをまたいだ全体の上限 ────────────────────────────────────
test('画面の書き込み: 20 回ぶんをまとめて数え、残りは meta に持つ', async () => {
  const { env, roomId, room } = await setup({ quota: true });
  const Q = await mod('worker/room-quota.mjs');
  assert.equal(Q.ROOM_WRITE_LEASE, 20);
  for (let i = 0; i < 20; i++) {
    const res = await http(env, 'POST', `/api/rooms/${roomId}/update`, { ...wallPatch(100 + i), baseVersion: 1 + i }, { ...SCREEN, ip: '203.0.113.5' });
    assert.equal(res.status, 200, 'i=' + i);
  }
  assert.equal(await usedTotal(env, 'room-writes'), 20, '20 回で1回ぶんのまとめ取り');
  assert.deepEqual((await room.storage.get('meta')).writeLease, { day: today(), left: 0 });
  const next = await http(env, 'POST', `/api/rooms/${roomId}/update`, { ...wallPatch(200), baseVersion: 21 }, { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(next.status, 200);
  assert.equal(await usedTotal(env, 'room-writes'), 40);
  // 手動保存も同じ残りから引く
  const save = await http(env, 'POST', `/api/rooms/${roomId}/save`, { clientId: 'x', baseVersion: 22, plan: plan() }, { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(save.status, 200);
  assert.deepEqual((await room.storage.get('meta')).writeLease, { day: today(), left: 18 });
  assert.equal(await usedTotal(env, 'room-writes'), 40);
  // 前の日の残りは使わない
  const meta = await room.storage.get('meta');
  await room.storage.put('meta', { ...meta, writeLease: { day: '2000-01-01', left: 15 } });
  await http(env, 'POST', `/api/rooms/${roomId}/update`, { ...wallPatch(210), baseVersion: 23 }, { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(await usedTotal(env, 'room-writes'), 60);
});

test('画面の書き込み: 全体の上限に当たると、どのルームも 429 で断り、ルームは変わらない', async () => {
  const { env, rooms, roomId, room } = await setup({ quota: true });
  const Q = await mod('worker/room-quota.mjs');
  const other = await rooms.createRoomWithPlan(env, plan(), ORIGIN);
  // ほかのルームたちが、きょうの全体の数を使い切った
  await env.quota('room-writes').state.storage.put(`total:${today()}`, Q.ROOM_WRITES_TOTAL);
  const ws = connect(room, 'screen-a');
  const before = snapshotRoom(env, room);
  for (const id of [roomId, other.roomId]) {
    const res = await http(env, 'POST', `/api/rooms/${id}/update`, wallPatch(155), { ...SCREEN, ip: '203.0.113.5' });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, 'write_limit');
    assert.equal(res.headers.get('retry-after'), '600', '画面が送り直しを待つ長さ');
    assertUserText(body.message);
  }
  const save = await http(env, 'POST', `/api/rooms/${roomId}/save`, { clientId: 'x', baseVersion: 1, plan: plan() }, { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(save.status, 429);
  assert.equal(snapshotRoom(env, room), before, 'ルームが変わった');
  assert.deepEqual(ws.messages(), []);
  // 読むのは止めない
  assert.equal((await http(env, 'GET', `/api/rooms/${roomId}`)).status, 200);
  // 形の違う差分は、数える前に 400(上限のときも理由が変わらない)
  const bad = await http(env, 'POST', `/api/rooms/${roomId}/update`, { type: 'patch', patch: { x: 1 } }, SCREEN);
  assert.equal(bad.status, 400);
});

test('画面の書き込み: 1つの接続元が自分の上限を使い切っても、ほかの接続元は通る', async () => {
  const { env, roomId } = await setup({ quota: true });
  const Q = await mod('worker/room-quota.mjs');
  assert.ok(Q.ROOM_WRITES_PER_USER < Q.ROOM_WRITES_TOTAL);
  const storage = env.quota('room-writes').state.storage;
  await storage.put({ [`total:${today()}`]: Q.ROOM_WRITES_PER_USER, [`who:${today()}:203.0.113.5`]: Q.ROOM_WRITES_PER_USER });
  const mine = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155), { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(mine.status, 429);
  const yours = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155), { ...SCREEN, ip: '198.51.100.7' });
  assert.equal(yours.status, 200);
});

test('画面の書き込み: 数える先が壊れていても共同編集は止めない。束縛が無ければ数えない', async () => {
  const { env, roomId, room } = await setup();
  let asked = 0;
  env.AI_QUOTA = { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => { asked++; throw new Error('down'); } }) };
  const res = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155), SCREEN);
  assert.equal(res.status, 200);
  assert.equal(asked, 1);
  assert.equal('writeLease' in (await room.storage.get('meta')), false);
  delete env.AI_QUOTA;
  const plain = await http(env, 'POST', `/api/rooms/${roomId}/update`, { ...wallPatch(160), baseVersion: 2 }, SCREEN);
  assert.equal(plain.status, 200);
});

test('外の AI の操作: 積んだ数を全体で数え、上限に当たるとどのルームも断る。数えられないときも断る', async () => {
  const { env, rooms, roomId, room } = await setup({ quota: true });
  const Q = await mod('worker/room-quota.mjs');
  const ok = await rooms.roomOp(env, roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(await usedTotal(env, 'room-ops'), 1);
  // 引数の誤りは数えない
  const bad = await rooms.roomOp(env, roomId, 'placeItem', { type: 'no-such-thing', x: 0, y: 0, floor: 1 });
  assert.equal(bad.ok, false);
  assert.equal(await usedTotal(env, 'room-ops'), 1);
  // 画面の数とは別に数える
  assert.equal(await usedTotal(env, 'room-writes'), 0);

  await env.quota('room-ops').state.storage.put(`total:${today()}`, Q.ROOM_OPS_TOTAL);
  const before = snapshotRoom(env, room);
  const full = await rooms.roomOp(env, roomId, 'placeItem', { type: 'bed', x: 2365, y: 5460, floor: 2 });
  assert.equal(full.ok, false);
  assert.equal(full.code, 'op_limit_all');
  assertUserText(full.errors[0].message);
  assert.equal(snapshotRoom(env, room).replace(/"mcpOps":\{[^}]*\}/, ''), before.replace(/"mcpOps":\{[^}]*\}/, ''), 'ルームが変わった');
  // 画面の書き込みは、外の AI の数が尽きても通る
  const screen = await http(env, 'POST', `/api/rooms/${roomId}/update`, { ...wallPatch(155), baseVersion: 2 }, SCREEN);
  assert.equal(screen.status, 200);
  // 読むのは止めない
  assert.equal((await rooms.roomRead(env, roomId, 'summary')).ok, true);

  // MCP の返事は、全体の上限と分かる日本語になる
  env.ASSETS = { fetch: async () => new Response('static') };
  const router = (await mod('worker/router.mjs')).default;
  const res = await router.fetch(new Request(ORIGIN + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'placeItem', arguments: { plan: roomId, type: 'bed', x: 2365, y: 5460, floor: 2 } } }),
  }), env);
  const result = (await res.json()).result;
  assert.equal(result.isError, true);
  const text = result.content.map((c) => c.text).join('\n');
  assert.match(text, /失敗の種類: 回数の上限（きょうは、この受け口からの変更が全体の上限に達しました）/);
  assert.match(text, /house-planner で開く: /);

  // 数える先が壊れている → 積まずに「一時的な失敗」
  const broken = await setup();
  broken.env.AI_QUOTA = { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => { throw new Error('down'); } }) };
  const b0 = snapshotRoom(broken.env, broken.room);
  const busy = await broken.rooms.roomOp(broken.env, broken.roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(busy.ok, false);
  assert.equal(busy.code, 'op_busy');
  assertUserText(busy.errors[0].message);
  assert.equal(snapshotRoom(broken.env, broken.room), b0);
});

test('画面からのルームの作成: 接続元ごと・全体で数え、上限で 429。形の違うプランは数えない', async () => {
  const env = await addQuota(await makeEnv());
  const Q = await mod('worker/room-quota.mjs');
  const made = await http(env, 'POST', '/api/rooms', plan(), { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(made.status, 201);
  assert.equal(await usedTotal(env, 'room-create-screen'), 1);
  const bad = await http(env, 'POST', '/api/rooms', { walls: [] }, { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(bad.status, 400);
  assert.equal(await usedTotal(env, 'room-create-screen'), 1);

  const storage = env.quota('room-create-screen').state.storage;
  await storage.put(`who:${today()}:203.0.113.5`, Q.SCREEN_ROOM_CREATE_PER_USER);
  const rooms0 = env.PLANS.objects.size;
  const mine = await http(env, 'POST', '/api/rooms', plan(), { ...SCREEN, ip: '203.0.113.5' });
  assert.equal(mine.status, 429);
  const body = await mine.json();
  assert.equal(body.error, 'room_create_limit');
  assertUserText(body.message);
  assert.equal(env.PLANS.objects.size, rooms0, 'R2 に置いた');
  const yours = await http(env, 'POST', '/api/rooms', plan(), { ...SCREEN, ip: '198.51.100.7' });
  assert.equal(yours.status, 201);
  await storage.put(`total:${today()}`, Q.SCREEN_ROOM_CREATE_TOTAL);
  const all = await http(env, 'POST', '/api/rooms', plan(), { ...SCREEN, ip: '198.51.100.9' });
  assert.equal(all.status, 429);
  // 外の AI が作るルームの数("room-create")とは別に数える
  assert.equal(env.AI_QUOTA.created.includes('room-create'), false);

  // 数える先が壊れていても、画面からは作れる
  const env2 = await makeEnv();
  env2.AI_QUOTA = { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => { throw new Error('down'); } }) };
  assert.equal((await http(env2, 'POST', '/api/rooms', plan(), SCREEN)).status, 201);
});

test('上限の値: 1日の書き込みの行の見積もりが Durable Object の無料枠に収まる', async () => {
  const Q = await mod('worker/room-quota.mjs');
  const rows = Q.ROOM_WRITES_TOTAL * 5 + (Q.ROOM_WRITES_TOTAL / Q.ROOM_WRITE_LEASE) * 2 + Q.ROOM_OPS_TOTAL * 7 + Q.SCREEN_ROOM_CREATE_TOTAL * 4 + 300 * 4;
  assert.ok(rows <= 80000, '見積もり ' + rows + ' 行(枠は 10 万行。AI の回数ぶんの余裕を残す)');
  // 5 秒に1回の編集を4時間(2,880 回)続けても、接続元ごとの上限に当たらない
  assert.ok(Q.ROOM_WRITES_PER_USER >= 2880);
});
