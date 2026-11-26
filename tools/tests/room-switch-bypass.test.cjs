// 「外部の AI からの変更を受け付ける」を止めたルームを、素の HTTP で書き換えられないこと
// (worker/collab-room.mjs・worker/routes-rooms.mjs・worker/room-screen.mjs)。
//
// 見ていること:
//   - 止めている間、画面からでない(Origin の無い・よその出どころの)/api/rooms/:id/update・/save は 403 で断られ、
//     ルームは1つも変わらず、部屋の人へ何も配らない。
//   - 画面(Origin が自分の出どころ・本番のホスト・アプリ版の capacitor://localhost・手元の開発のホスト)の
//     共同編集は、止めている間も今までどおり通る。
//   - スイッチの切り替え(/ai-edits)は画面からだけ受ける(外から「受け付ける」に戻せない)。
//   - 画面の印の見出し(x-room-screen)を外から付けてきても通らない。
//   - 止めていないルームは、今までどおり Origin が無くても /update・/save が通る。
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

// 画面からの要求は Origin が付く(ブラウザは同じ出どころへの POST にも付ける)。外の道具の素の HTTP には無い。
async function http(env, method, path, body, { origin = null, headers = {}, base = ORIGIN } = {}) {
  const { handleRooms } = await mod('worker/routes-rooms.mjs');
  const url = new URL(path, base);
  const init = { method, headers: { ...headers } };
  if (origin) init.headers.origin = origin;
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handleRooms(new Request(url, init), env, url);
}
const SCREEN = { origin: ORIGIN };

async function setup() {
  const rooms = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  const made = await rooms.createRoomWithPlan(env, plan(), ORIGIN);
  return { env, rooms, roomId: made.roomId, room: env.room(made.roomId) };
}
function snapshotRoom(env, room) {
  return JSON.stringify({ storage: Array.from(room.storage.data.entries()), alarm: room.storage.alarmAt(), r2: Array.from(env.PLANS.objects.entries()) });
}
function wallPatch(thick, baseVersion = 1) {
  const wall = { ...plan().walls[0], thick };
  return { type: 'patch', clientId: 'client-a', baseVersion, patch: { collections: { walls: { upserts: [wall], removes: [] } }, fields: {} } };
}

test('止めている間、画面からでない /update・/save は断り、ルームは変わらない', async () => {
  const { env, roomId, room } = await setup();
  const ws = connect(room, 'screen-a');
  const off = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true }, SCREEN);
  assert.equal(off.status, 200);
  ws.clear();
  const before = snapshotRoom(env, room);

  // ルームの id を知った外の道具が、素の HTTP で呼ぶ
  const up = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155));
  assert.equal(up.status, 403);
  const body = await up.json();
  assert.equal(body.error, 'ai_edits_off');
  assert.match(body.message, /利用者が外部 AI からの変更を止めています/);
  const save = await http(env, 'POST', `/api/rooms/${roomId}/save`, { clientId: 'x', baseVersion: 1, plan: plan() });
  assert.equal(save.status, 403);
  assert.equal((await save.json()).error, 'ai_edits_off');
  // 画面の印の見出しを自分で付けてきても通らない(受け口が消してから付け直す)
  const forged = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155), { headers: { 'x-room-screen': '1' } });
  assert.equal(forged.status, 403);
  // よその出どころのページからも通らない
  for (const origin of ['https://evil.example', 'null', 'https://cad-planner.example.test.evil.example']) {
    const other = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155), { origin });
    assert.equal(other.status, 403, origin);
  }
  assert.equal(snapshotRoom(env, room), before, 'ルームが変わった');
  assert.deepEqual(ws.messages(), [], '部屋の人に何か配った');
  // 読むのは止めない
  assert.equal((await http(env, 'GET', `/api/rooms/${roomId}`)).status, 200);
});

test('止めている間も、画面(同じ出どころ・本番のホスト・アプリ版・手元の開発)の /update・/save は通る', async () => {
  const { env, roomId } = await setup();
  await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true }, SCREEN);
  let version = 1;
  const origins = [ORIGIN, 'https://cad-planner.srapps.us', 'capacitor://localhost', 'http://localhost:8787', 'http://127.0.0.1:8932'];
  for (const origin of origins) {
    const up = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(150 + version, version), { origin });
    assert.equal(up.status, 200, origin);
    version = (await up.json()).version;
    const save = await http(env, 'POST', `/api/rooms/${roomId}/save`, { clientId: 'x', baseVersion: version, plan: plan() }, { origin });
    assert.equal(save.status, 200, origin);
    version = (await save.json()).version;
  }
  // プレビューのホスト(*.workers.dev)でも、自分の出どころなら通る
  const preview = 'https://abc-webcad-planner.example.workers.dev';
  const up = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(190, version), { origin: preview, base: preview });
  assert.equal(up.status, 200);
});

test('スイッチの切り替えは画面からだけ受ける(外から「受け付ける」に戻せない)', async () => {
  const { env, rooms, roomId, room } = await setup();
  // 外からは止めることもできない(切り替えはどちら向きも画面だけ)
  const offOutside = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true });
  assert.equal(offOutside.status, 403);
  assert.equal(!!(await room.storage.get('meta')).aiEditsOff, false);
  await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: true }, SCREEN);
  const before = snapshotRoom(env, room);
  const back = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: false });
  assert.equal(back.status, 403);
  const forged = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: false }, { headers: { 'x-room-screen': '1' } });
  assert.equal(forged.status, 403);
  assert.equal(snapshotRoom(env, room), before);
  assert.equal((await room.storage.get('meta')).aiEditsOff, true);
  const op = await rooms.roomOp(env, roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(op.code, 'ai_edits_off', '外の AI の操作が通った');
  // 画面(アプリ版も)からは戻せる
  const on = await http(env, 'POST', `/api/rooms/${roomId}/ai-edits`, { off: false }, { origin: 'capacitor://localhost' });
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { aiEditsOff: false });
});

test('止めていないルームは、今までどおり Origin が無くても /update・/save が通る', async () => {
  const { env, roomId } = await setup();
  const up = await http(env, 'POST', `/api/rooms/${roomId}/update`, wallPatch(155));
  assert.equal(up.status, 200);
  const save = await http(env, 'POST', `/api/rooms/${roomId}/save`, { clientId: 'x', baseVersion: 2, plan: plan() });
  assert.equal(save.status, 200);
});
