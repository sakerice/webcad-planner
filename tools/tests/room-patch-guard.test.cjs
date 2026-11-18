// 共同編集のルーム(worker/collab-room.mjs)が、形の壊れた差分・プランを受け付けないこと。
// 本物の CollaborationRoom と routes-rooms.mjs を、偽の storage・R2・WebSocket(collab-room-fakes.cjs)で動かす。
//
// 確かめること:
//   - /update: 形の壊れた差分・危ない鍵(__proto__・constructor・prototype)・深すぎ・大きすぎは 400 で、ルームは変わらない
//     (版・積んだ差分・配信・GET の中身)。Object.prototype も汚れない。
//   - /update: 正当な差分(部屋を足す・物を動かす・消す・欄を null に・既定プランと手元の固定プラン全体)は今までどおり通る。
//   - POST /api/rooms と /save: 危ない鍵・深すぎのプランは 400 で、ルームを作らない・変えない。手元のプランは全部通る。
//   - すでに壊れた差分が積まれているルームでも、GET・/read が例外で落ちずに読める。
// 攻撃の差分の固定集は tools/tests/fixtures/injection/room-patches.json。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeEnv, connect } = require('./collab-room-fakes.cjs');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const readJson = (rel) => JSON.parse(fs.readFileSync(join(ROOT, rel), 'utf8'));
const plan = () => readJson('tools/tests/fixtures/house-2f.json');
const CORPUS = readJson('tools/tests/fixtures/injection/room-patches.json');
const PAYLOADS = readJson('tools/tests/fixtures/injection/payloads.json');
const ORIGIN = 'https://cad-planner.example.test';
const P = require('../../assets/js/plan-core/patch.js');

// 手元にある正当なプラン(固定プラン・互換の保存データ)を全部集める。
// tools/default-plans/*.json は既定プランを作る側の手直しの記録(差分とは別の形)なので入れない。
// 出荷している既定プラン(assets/ の2つ)は、テストから読まない決まり(fixture-only.test.cjs)なので入れない。
// その2つが通ることは、作業の報告(task-2-report.md)に書いた手で走らせた確かめで見た。
function legitPlans() {
  const dirs = ['tools/tests/fixtures', 'tools/tests/fixtures/compat'];
  const out = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(join(ROOT, dir))) {
      if (!name.endsWith('.json') || name === 'golden.json') continue;
      let p;
      try { p = readJson(dir + '/' + name); } catch { continue; }
      if (p && typeof p === 'object' && Array.isArray(p.walls) && Array.isArray(p.items) && Array.isArray(p.rooms)) out.push({ name: dir + '/' + name, plan: p });
    }
  }
  return out;
}

// Object.prototype が汚れていないこと
const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
function assertCleanPrototype(where) {
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(','), PROTO_NAMES, where + ': Object.prototype に欄が増えた');
  const probe = {};
  for (const k of ['polluted', 'color', 'textureFlipX', 'texture']) assert.equal(probe[k], undefined, where + ': Object.prototype.' + k);
}

async function call(env, method, path, body) {
  const { handleRooms } = await mod('worker/routes-rooms.mjs');
  const url = new URL(path, ORIGIN);
  const init = { method };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handleRooms(new Request(url, init), env, url);
}

async function createRoom(env, p = plan()) {
  const res = await call(env, 'POST', '/api/rooms', p);
  assert.equal(res.status, 201, 'ルームを作れない');
  return res.json();
}

async function getPlan(env, roomId) {
  const res = await call(env, 'GET', `/api/rooms/${roomId}`);
  assert.equal(res.status, 200);
  return res.json();
}

// 深さ n の入れ子(いちばん内側は 1)
function nested(n) { let v = 1; for (let i = 0; i < n; i++) v = { a: v }; return v; }

// 大きいので固定集に書かず、ここで作る差分。どれも上限の1つ外。
function generatedBad() {
  const up = (name, item) => ({ collections: { [name]: { upserts: [item], removes: [] } }, fields: {} });
  const manyKeys = { id: 1 };
  for (let i = 0; i < 50001; i++) manyKeys['k' + i] = 1;
  return [
    // 差分の根を1段として 22 段まで。物は5段目なので、物の中の入れ子は 17 段まで
    { id: 'too-deep-upsert', patch: up('items', { id: 1, deep: nested(18) }) },
    { id: 'too-deep-field', patch: { collections: {}, fields: { exteriorWallSettings: nested(21) } } },   // 欄の値は3段目
    { id: 'too-many-removes', patch: { collections: { walls: { upserts: [], removes: Array.from({ length: 50001 }, (_, i) => String(i)) } }, fields: {} } },
    { id: 'too-many-keys', patch: up('items', manyKeys) },
    { id: 'too-long-string', patch: up('items', { id: 1, texture: 'a'.repeat(10 * 1024 * 1024 + 1) }) },
    { id: 'too-long-key', patch: up('items', { id: 1, ['k'.repeat(1001)]: 1 }) },
    { id: 'too-long-id', patch: up('items', { id: 'i'.repeat(201) }) },
    { id: 'too-long-remove-id', patch: { collections: { items: { upserts: [], removes: ['r'.repeat(201)] } }, fields: {} } },
    { id: 'id-infinity-sent-as-null', patch: up('items', { id: 1e400 }) },   // JSON にすると null になる(有限でない数は JSON では送れない)
  ];
}

test('/update: 形の壊れた差分・危ない鍵・深すぎ・大きすぎは 400 で、ルームは何も変わらない', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const ws = connect(room, 'client-b');
  const before = JSON.stringify(await getPlan(env, made.roomId));
  const metaBefore = await room.storage.get('meta');
  const cases = CORPUS.bad.concat(generatedBad());
  // 継承した鍵(固定集の inheritedKeys)を、集まりの名前・欄の名前・物の中の鍵に入れた形も足す
  for (const key of PAYLOADS.inheritedKeys) {
    cases.push({ id: 'inherited-collection-' + key, patch: JSON.parse(`{"collections":{${JSON.stringify(key)}:{"upserts":[],"removes":[]}},"fields":{}}`) });
    cases.push({ id: 'inherited-field-' + key, patch: JSON.parse(`{"collections":{},"fields":{${JSON.stringify(key)}:{"polluted":1}}}`) });
  }
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    cases.push({ id: 'unsafe-key-deep-' + key, patch: JSON.parse(`{"collections":{"walls":{"upserts":[{"id":1,"a":{"b":[{${JSON.stringify(key)}:{"polluted":1}}]}}],"removes":[]}},"fields":{}}`) });
  }
  assert.ok(cases.length >= 60, '試す差分が少ない: ' + cases.length);
  const accepted = [];
  for (const c of cases) {
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'client-a', baseVersion: 1, patch: c.patch });
    const body = await res.json().catch(() => null);
    if (res.status !== 400 || !body || body.error !== 'invalid_patch') accepted.push(c.id + ' → ' + res.status);
    assertCleanPrototype(c.id);
  }
  assert.deepEqual(accepted, [], '断られなかった差分');
  assert.deepEqual(await room.storage.get('meta'), metaBefore, 'meta が変わった');
  assert.equal((await room.storage.list({ prefix: 'patch:' })).size, 0, '差分が積まれた');
  assert.equal(ws.sent.length, 0, '相手へ流れた');
  assert.equal(JSON.stringify(await getPlan(env, made.roomId)), before, 'プランが変わった');
});

test('/update: 本文が素のオブジェクトでないときも 400', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  for (const body of ['[1]', '"patch"', '5', 'null', JSON.stringify([{ type: 'patch', patch: {} }])]) {
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, body);
    assert.equal(res.status, 400, body);
  }
  assert.equal((await env.room(made.roomId).storage.get('meta')).version, 1);
});

test('/update: 正当な差分(部屋を足す・物を動かす・消す・欄を null に)は今までどおり通る', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const p = plan();
  const sofa = p.items.find((it) => /Sofa/.test(it.type));
  const wall = p.walls[3];
  const send = async (patch, version) => {
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'client-a', baseVersion: version, patch });
    assert.equal(res.status, 200, JSON.stringify(patch).slice(0, 200));
    return res.json();
  };
  const newRoom = { id: 'rm9001', type: 'room', n: '書庫', x: 20000, y: 20000, w: 2730, d: 3640, floor: 1, color: '#e8e0cc' };
  await send({ collections: { rooms: { upserts: [newRoom], removes: [] } }, fields: {} }, 1);
  const moved = { ...sofa, x: sofa.x + 300, y: String(sofa.y) };   // 座標が数の文字でも通す(古い保存データを弾かない)
  await send({ collections: { items: { upserts: [moved], removes: [] } }, fields: {} }, 2);
  await send({ collections: { walls: { upserts: [], removes: [String(wall.id)] }, items: { upserts: [], removes: [] } } }, 3);
  // 画面は、プランに無い欄を null として送る
  const fields = {};
  for (const k of P.SHARED_FIELDS) fields[k] = null;
  await send({ collections: {}, fields }, 4);
  await send({ collections: {}, fields: { northDeg: 15, autoRoomLights: false, floors: { 1: { wallHeight: 2500 } } } }, 5);
  const after = await getPlan(env, made.roomId);
  assert.ok(after.rooms.some((r) => r.id === 'rm9001'));
  assert.equal(after.items.find((it) => it.id === sofa.id).x, sofa.x + 300);
  assert.ok(!after.walls.some((w) => String(w.id) === String(wall.id)));
  assert.equal(after.northDeg, 15);
  assert.equal(after.autoRoomLights, false);
  assertCleanPrototype('正当な差分');
});

// 画面の buildSharedPatch が基準なしで作る形(全部の物と全部の共有する欄)。
// 画面は送る前に必ず id の無い物へ id を振る(app-state.js の ensureObjectIds。共有の部屋に入ったときも
// installSharedPlan が呼ぶ)ので、ここでも同じ振り方をしてから組む。id の無い物は古い保存データ(compat/legacy-quirks.json)にある。
function withIds(p) {
  let next = 1;
  const scan = (v) => { if (v === undefined || v === null) return; const m = String(v).match(/(\d+)$/); if (m) next = Math.max(next, +m[1] + 1); };
  for (const c of P.COLLECTIONS) p[c].forEach((o) => scan(o.id));
  p.walls.forEach((w) => { if (w.id === undefined || w.id === null) w.id = next++; });
  p.items.forEach((i) => { if (i.id === undefined || i.id === null) i.id = next++; });
  p.rooms.forEach((r) => { if (!r.id) r.id = 'rm' + (next++); });
  return p;
}
function wholePlanPatch(p) {
  p = withIds(structuredClone(p));
  const patch = { collections: {}, fields: {} };
  for (const name of P.COLLECTIONS) patch.collections[name] = { upserts: p[name], removes: [] };
  for (const k of P.SHARED_FIELDS) patch.fields[k] = p[k] === undefined ? null : p[k];
  return patch;
}

test('/update・POST /api/rooms・/save: 手元の正当なプランは全部通る(既定プランを写した固定プランと、いちばん大きい固定プラン)', async () => {
  const plans = legitPlans();
  const names = plans.map((x) => x.name);
  for (const must of ['tools/tests/fixtures/house-2f.json', 'tools/tests/fixtures/review23-house-2f.json', 'tools/tests/fixtures/compat/saved-3f.json', 'tools/tests/fixtures/raised-floor-plan.json', 'tools/tests/fixtures/compat/legacy-quirks.json']) {
    assert.ok(names.includes(must), must + ' が無い');
  }
  const env = await makeEnv();
  for (const { name, plan: p } of plans) {
    const made = await createRoom(env, p);
    const empty = { walls: [], items: [], rooms: [] };
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/save`, { clientId: 'client-a', baseVersion: 1, plan: p });
    assert.equal(res.status, 200, name + ' /save');
    const other = await createRoom(env, empty);
    const up = await call(env, 'POST', `/api/rooms/${other.roomId}/update`, { type: 'patch', clientId: 'client-a', baseVersion: 1, patch: wholePlanPatch(p) });
    assert.equal(up.status, 200, name + ' /update ' + (await up.text()).slice(0, 200));
    const got = await getPlan(env, other.roomId);
    // 差分は id ごとに当てるので、id が重なる物(raised-floor-plan.json に実際にある)は1つになる
    for (const c of P.COLLECTIONS) assert.equal(got[c].length, new Set(p[c].map((o) => String(o.id))).size, name + ' ' + c);
  }
  assertCleanPrototype('正当なプラン');
});

test('POST /api/rooms と /save: 危ない鍵・深すぎのプランは 400 で、ルームを作らない・変えない', async () => {
  const bad = [
    JSON.parse('{"walls":[],"items":[],"rooms":[],"__proto__":{"polluted":1}}'),
    JSON.parse('{"walls":[{"id":1,"constructor":{"prototype":{"polluted":1}}}],"items":[],"rooms":[]}'),
    JSON.parse('{"walls":[],"items":[{"id":1,"finishColors":{"__proto__":{"polluted":1}}}],"rooms":[]}'),
    JSON.parse('{"walls":[],"items":[],"rooms":[],"exteriorWallSettings":{"walls":{"1":{"prototype":1}}}}'),
    { walls: [], items: [{ id: 1, deep: nested(18) }], rooms: [] },   // プランの根を1段として 20 段まで(物は3段目)
    { walls: [], items: [{ id: 1, ['k'.repeat(1001)]: 1 }], rooms: [] },
  ];
  const env = await makeEnv();
  for (const p of bad) {
    const res = await call(env, 'POST', '/api/rooms', p);
    assert.equal(res.status, 400, JSON.stringify(p).slice(0, 120));
    assert.equal((await res.json()).error, 'invalid_plan');
  }
  assert.equal(env.ROOMS.created.length, 0, 'ルームを作った');
  assert.equal(env.PLANS.objects.size, 0, 'R2 に置いた');
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const before = JSON.stringify(await getPlan(env, made.roomId));
  for (const p of bad) {
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/save`, { clientId: 'client-a', baseVersion: 1, plan: p });
    assert.equal(res.status, 400, '/save ' + JSON.stringify(p).slice(0, 120));
  }
  assert.equal((await room.storage.get('meta')).version, 1);
  assert.equal(JSON.stringify(await getPlan(env, made.roomId)), before);
  assertCleanPrototype('プラン全体');
});

test('createRoomWithPlan(外の AI の道)も同じ検査を通る', async () => {
  const { createRoomWithPlan } = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  const r = await createRoomWithPlan(env, JSON.parse('{"walls":[],"items":[],"rooms":[],"constructor":{"prototype":{"polluted":1}}}'), ORIGIN);
  assert.deepEqual(r, { error: 'invalid_plan', status: 400 });
  const ok = await createRoomWithPlan(env, plan(), ORIGIN);
  assert.ok(ok.roomId);
});

test('すでに壊れた差分が積まれたルームでも、GET・/read・書き戻しが例外で落ちない', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const p = plan();
  const broken = [
    { collections: { walls: { upserts: 'abc', removes: [] } } },
    { collections: { items: { upserts: [null, 5, 'x', [1]], removes: 'abc' } } },
    { collections: 'x', fields: 'y' },
    JSON.parse('{"collections":{},"fields":{"__proto__":{"polluted":"journal"},"constructor":{"prototype":{"polluted":"journal"}}}}'),
    JSON.parse('{"collections":{"rooms":{"upserts":[{"id":"rm1","__proto__":{"polluted":"journal"}}],"removes":[]}}}'),
    null,
    'abc',
    { collections: { items: { upserts: [{ id: p.items[0].id, x: 1 }], removes: [] } } },   // 正当な差分は当たる
  ];
  let v = 1;
  for (const patch of broken) {
    v += 1;
    await room.storage.put('patch:' + String(v).padStart(12, '0'), patch);
  }
  const meta = await room.storage.get('meta');
  await room.storage.put('meta', { ...meta, version: v });
  const got = await getPlan(env, made.roomId);
  assert.equal(got.items.find((it) => it.id === p.items[0].id).x, 1, '正当な差分が当たっていない');
  assert.equal(got.walls.length, p.walls.length);
  assert.equal(got.polluted, undefined);
  assert.ok(!got.rooms.some((r) => r.id === 'rm1'), '危ない鍵を含む物が入った');
  const { roomRead } = await mod('worker/routes-rooms.mjs');
  const read = await roomRead(env, made.roomId, 'summary');
  assert.equal(read.ok, true, JSON.stringify(read));
  const done = await room.instance.checkpoint(await room.storage.get('meta'));
  assert.ok(done, '書き戻せない');
  assertCleanPrototype('壊れた差分の読み');
});

test('/op: 引数に危ない鍵があれば断る(ルームは変わらない)', async () => {
  const { roomOp } = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  const made = await createRoom(env);
  const p = plan();
  const res = await roomOp(env, made.roomId, 'setProps', JSON.parse(`{"id":${JSON.stringify(p.items[0].id)},"set":{"__proto__":{"polluted":1}}}`));
  assert.equal(res.ok, false);
  assert.equal((await env.room(made.roomId).storage.get('meta')).version, 1);
  assertCleanPrototype('/op');
});

// ── 検査のあとの直し(2026-11-19)。検査役が見つけたすり抜けを1つずつ ──

test('/update: 座標の空の文字は null と同じく通す(古い保存データを弾かない)', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: 1,
    patch: { collections: { items: { upserts: [{ id: 'i1', type: 'bed', x: '', y: 0, w: 900, d: 2000 }], removes: [] } } } });
  assert.equal(res.status, 200);
});

// 画面は受けた壁の id を鍵に、外壁の設定表へ壁ごとの行を作り(getExteriorWallSetting)、次の変更でその表を送り返す。
// その送り返しが通ること(id が Object.prototype の名前なら、壁そのものを最初に断る)。
test('/update: 壁を受けた画面が補完した外壁の設定表を送り返しても通る(id が数・文字・UUID)', async () => {
  const { workerOpsCtx } = await mod('worker/plan-ctx.mjs');
  const Ops = require('../../assets/js/plan-core/operations.js');
  for (const id of [9001, 'w12', '3f2a9c4e-1b7d-4c55-9a0e-7d2f5b1c8e44', '']) {
    const env = await makeEnv();
    const made = await createRoom(env);
    const wall = { id, floor: 1, x1: 0, y1: 20000, x2: 3000, y2: 20000, thick: 120 };
    const send = (patch, v) => call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: v, patch });
    assert.equal((await send({ collections: { walls: { upserts: [wall], removes: [] } } }, 1)).status, 200, String(id));
    const p = await getPlan(env, made.roomId);
    Ops.applyProp(p.walls.find((w) => w.id === id), 'exteriorColor', '#123456', p, workerOpsCtx(p));
    const back = await send({ collections: {}, fields: { exteriorWallSettings: p.exteriorWallSettings } }, 2);
    assert.equal(back.status, 200, String(id) + ' ' + (await back.text()));
  }
});

test('POST /api/rooms と /save: 物がオブジェクトでない・id が使えない名前・欄の形の誤りのプランは 400', async () => {
  const base = () => plan();
  const bad = [
    ['walls-null', (p) => { p.walls.push(null); }],
    ['items-number', (p) => { p.items.push(5); }],
    ['rooms-string', (p) => { p.rooms.push('x'); }],
    ['wall-id-constructor', (p) => { p.walls[0].id = 'constructor'; }],
    ['room-name-toString', (p) => { p.rooms[0].n = { toString: 1, valueOf: 1 }; }],
    ['item-type-object', (p) => { p.items[0].type = {}; }],
    ['ext-walls-string', (p) => { p.exteriorWallSettings = { walls: 'x' }; }],
    ['roof-floors-string', (p) => { p.roofAppearance = { whole: null, floors: 'x' }; }],
    ['walls-not-array', (p) => { p.walls = { 0: p.walls[0] }; }],
  ];
  const env = await makeEnv();
  for (const [name, edit] of bad) {
    const p = base(); edit(p);
    const res = await call(env, 'POST', '/api/rooms', p);
    assert.equal(res.status, 400, name);
  }
  assert.equal(env.ROOMS.created.length, 0);
  const made = await createRoom(env);
  const before = JSON.stringify(await getPlan(env, made.roomId));
  for (const [name, edit] of bad) {
    const p = base(); edit(p);
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/save`, { clientId: 'a', baseVersion: 1, plan: p });
    assert.equal(res.status, 400, '/save ' + name);
  }
  assert.equal(JSON.stringify(await getPlan(env, made.roomId)), before);
  assertCleanPrototype('物ごとのプランの検査');
});

test('/update: 当てたあとのプランが保存の上限(10MB)を超える差分は 413 で、部屋は変わらない。書き戻しは通り続ける', async () => {
  const env = await makeEnv();
  const made = await createRoom(env);
  const room = env.room(made.roomId);
  const ws = connect(room, 'b');
  let version = 1, rejected = null;
  for (let i = 0; i < 9; i++) {
    const item = { id: 'big' + i, type: 'bed', x: 0, y: 0, w: 900, d: 2000, memo: 'x'.repeat(1400 * 1000) };
    const res = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: version, patch: { collections: { items: { upserts: [item], removes: [] } } } });
    if (res.status === 413) { rejected = i; break; }
    assert.equal(res.status, 200, 'i=' + i);
    version = (await res.json()).version;
  }
  assert.ok(rejected !== null, '上限を超える差分を受け付けた');
  const metaBefore = await room.storage.get('meta');
  const sentBefore = ws.sent.length;
  const again = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: version, patch: { collections: { items: { upserts: [{ id: 'big-x', memo: 'y'.repeat(1400 * 1000) }], removes: [] } } } });
  assert.equal(again.status, 413);
  assert.deepEqual(await room.storage.get('meta'), metaBefore, '断ったのに meta が変わった');
  assert.equal(ws.sent.length, sentBefore, '断ったのに流した');
  const got = await call(env, 'GET', `/api/rooms/${made.roomId}`);
  assert.ok((await got.text()).length <= 10 * 1024 * 1024);
  assert.ok(await room.instance.checkpoint(await room.storage.get('meta')), '書き戻せない');
  // 小さい差分は今までどおり通る
  const small = await call(env, 'POST', `/api/rooms/${made.roomId}/update`, { type: 'patch', clientId: 'a', baseVersion: version, patch: { collections: {}, fields: { northDeg: 5 } } });
  assert.equal(small.status, 200);
});

test('/read・/op: 保存済みのプランの形が崩れていても例外で落ちず、分かる失敗を返す', async () => {
  const { roomRead, roomOp } = await mod('worker/routes-rooms.mjs');
  const { BROKEN_PLAN_MESSAGE } = await mod('worker/collab-room.mjs');
  const env = await makeEnv();
  const made = await createRoom(env);
  // 検査の前に置かれた本体(R2)を作る: 部屋の名前と壁の階が、文字に直せないオブジェクト
  const p = plan();
  p.rooms[0].n = { toString: 1, valueOf: 1 };
  p.walls[0].floor = { toString: 1, valueOf: 1 };
  env.PLANS.objects.get(`rooms/${made.roomId}.json`).body = JSON.stringify(p);
  for (const what of ['summary', 'inspect']) {
    const r = await roomRead(env, made.roomId, what);
    assert.deepEqual(r, { ok: false, errors: [{ message: BROKEN_PLAN_MESSAGE }] }, what);
  }
  const op = await roomOp(env, made.roomId, 'moveObject', { id: p.items[1].id, dx: 10, dy: 0 });
  assert.deepEqual(op, { ok: false, errors: [{ message: BROKEN_PLAN_MESSAGE }] });
  assert.equal((await env.room(made.roomId).storage.get('meta')).version, 1);
});

test('/op: 操作が作る差分も同じ検査を通す(検査の前に作られた部屋の、使えない名前の壁)', async () => {
  const { roomOp } = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  const made = await createRoom(env);
  const p = plan();
  p.walls[0].id = 'constructor';
  env.PLANS.objects.get(`rooms/${made.roomId}.json`).body = JSON.stringify(p);
  const { BROKEN_PLAN_MESSAGE } = await mod('worker/collab-room.mjs');
  const op = await roomOp(env, made.roomId, 'setProps', { id: 'constructor', set: { wallHeight: 2600 } });
  assert.deepEqual(op, { ok: false, errors: [{ message: BROKEN_PLAN_MESSAGE }] });
  assert.equal((await env.room(made.roomId).storage.get('meta')).version, 1);
  assert.equal((await env.room(made.roomId).storage.list({ prefix: 'patch:' })).size, 0);
});
