// 外部 AI(MCP の受け口 /api/mcp → ルームの /op)の変更に、ルームが印を付けて配ること。利用者が止められること。
//
// 見ていること:
//   - /op の差分は source:"ai" を付けて配る。画面の /update の差分には付かない(clientId を "mcp" と名乗っても、本文に source を入れても)。
//   - POST /api/rooms/:id/ai-edits {off:true} で止めると、meta に残り、部屋にいる全員へ {type:"ai-edits", off:true} が届く。
//     版・期限・プランは変わらない。同じ値をもう一度送っても書かず、配らない。
//   - 止めている間の /op は {ok:false, code:"ai_edits_off"} で断り、ルームは1つも変えず、回数も数えない。/read は通る。
//   - MCP の返事は「利用者が外部 AI からの変更を止めています」と分かる文になる(失敗の返し方は今までと同じ形)。
//   - 切り替えの受け口は、形の違う本文を 400、大きすぎる本文を 413、無いルームを 410 で断る。
//   - {off:false} で戻すと、また /op が通る。
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

async function http(env, method, path, body) {
  const { handleRooms } = await mod('worker/routes-rooms.mjs');
  const url = new URL(path, ORIGIN);
  const init = { method };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handleRooms(new Request(url, init), env, url);
}

async function setup() {
  const rooms = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  const made = await rooms.createRoomWithPlan(env, plan(), ORIGIN);
  return { env, rooms, roomId: made.roomId, room: env.room(made.roomId) };
}

function snapshotRoom(env, room) {
  return JSON.stringify({ storage: Array.from(room.storage.data.entries()), alarm: room.storage.alarmAt(), r2: Array.from(env.PLANS.objects.entries()) });
}

test('/op の差分にだけ source:"ai" が付き、画面の /update の差分には付かない', async () => {
  const { env, rooms, roomId, room } = await setup();
  const ws = connect(room, 'screen-a');
  const res = await rooms.roomOp(env, roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(res.ok, true, JSON.stringify(res));
  const ai = ws.messages().filter((m) => m.type === 'patch');
  assert.equal(ai.length, 1);
  assert.equal(ai[0].source, 'ai');
  assert.equal(ai[0].clientId, 'mcp');
  ws.clear();
  // 画面が "mcp" を名乗り、本文に source を入れても、印は付かない
  const p = plan();
  const wall = { ...p.walls[0], thick: 155 };
  const up = await http(env, 'POST', `/api/rooms/${roomId}/update`, { type: 'patch', clientId: 'mcp', source: 'ai', baseVersion: res.version, patch: { collections: { walls: { upserts: [wall], removes: [] } }, fields: {} } });
  assert.equal(up.status, 200);
  const human = ws.messages().filter((m) => m.type === 'patch');
  assert.equal(human.length, 1);
  assert.equal('source' in human[0], false, '画面の差分に印が付いた');
  assert.deepEqual(Object.keys(human[0]), ['type', 'version', 'expiresAt', 'clientId', 'patch'], '画面の差分の形が変わった(古い画面のため変えない)');
});

test('止めると meta に残って全員へ届き、/op を断る。/read は通る。戻すとまた通る', async () => {
  const { env, rooms, roomId, room } = await setup();
  const a = connect(room, 'screen-a');
  const b = connect(room, 'screen-b');
  const metaBefore = await room.storage.get('meta');
  const off = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true, clientId: 'screen-a' });
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { aiEditsOff: true });
  const meta = await room.storage.get('meta');
  assert.equal(meta.aiEditsOff, true);
  assert.equal(meta.version, metaBefore.version, '版が進んだ');
  assert.equal(meta.expiresAt, metaBefore.expiresAt, '期限が変わった');
  for (const ws of [a, b]) {
    assert.deepEqual(ws.messages(), [{ type: 'ai-edits', off: true }], '本文の clientId を配った');
    ws.clear();
  }
  // 同じ値をもう一度: 書かず、配らない
  const again = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true });
  assert.equal(again.status, 200);
  assert.deepEqual(a.messages(), []);

  // 止めている間の /op は断り、何も変えない。回数も数えない
  const before = snapshotRoom(env, room);
  const opsBefore = { ...room.instance.mcpOps };
  const res = await rooms.roomOp(env, roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ai_edits_off');
  assert.match(res.errors[0].message, /利用者が外部 AI からの変更を止めています/);
  assert.equal(snapshotRoom(env, room), before, '止めているのにルームが変わった');
  assert.deepEqual(room.instance.mcpOps, opsBefore, '止めている間の呼び出しを数えた');
  assert.deepEqual(a.messages(), [], '止めているのに配った');
  // 読むのは通る
  const read = await rooms.roomRead(env, roomId, 'summary');
  assert.equal(read.ok, true);

  // 戻すと通る
  const on = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: false });
  assert.deepEqual(await on.json(), { aiEditsOff: false });
  assert.deepEqual(b.messages().filter((m) => m.type === 'ai-edits'), [{ type: 'ai-edits', off: false }]);
  const ok = await rooms.roomOp(env, roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('切り替えの受け口は、形の違う本文・大きすぎる本文・無いルームを断る', async () => {
  const { env, roomId, room } = await setup();
  for (const body of [{ off: 'yes' }, { off: 1 }, {}, [], 'null', 'not json', { on: true }]) {
    const res = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, body);
    assert.equal(res.status, 400, `本文 ${JSON.stringify(body)} を受けた`);
  }
  const big = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, JSON.stringify({ off: true, pad: 'x'.repeat(2000) }));
  assert.equal(big.status, 413);
  assert.equal((await room.storage.get('meta')).aiEditsOff, undefined, '断った本文で値が変わった');
  // GET は受けない
  const get = await http(env, 'GET', `/api/rooms/${roomId}/ai-edits`);
  assert.equal(get.status, 404);
  // 無いルーム・形の違う id
  const none = await http(env, 'POST', '/api/rooms/NoSuchRoomNoSuchRoom00/ai-edits', { off: true });
  assert.equal(none.status, 410);
  const bad = await http(env, 'POST', '/api/rooms/short/ai-edits', { off: true });
  assert.equal(bad.status, 404);
});

test('MCP の返事: 止めているときは「利用者が外部 AI からの変更を止めています」と分かる失敗になる', async () => {
  const { env, roomId } = await setup();
  env.ASSETS = { fetch: async () => new Response('static') };
  env.AI_QUOTA = { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }) }) };
  const router = (await mod('worker/router.mjs')).default;
  await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true });
  const callTool = async (name, args) => {
    const res = await router.fetch(new Request('https://cad-planner.example.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }), env);
    const body = await res.json();
    return body.result;
  };
  const r = await callTool('placeItem', { plan: roomId, type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(r.isError, true);
  const text = r.content.map((c) => c.text).join('\n');
  assert.match(text, /失敗の種類: 利用者が外部 AI からの変更を止めています/);
  assert.match(text, /利用者が外部 AI からの変更を止めています。プランを読むことはできますが/);
  assert.match(text, /できませんでした。プランは変わっていません。/);
  assert.match(text, new RegExp('house-planner で開く: ' + ORIGIN.replace(/\./g, '\\.') + '/#room=' + roomId));
  // 読む道具は通る
  const g = await callTool('get_plan', { plan: roomId });
  assert.equal(g.isError, false, g.content.map((c) => c.text).join('\n'));
});
