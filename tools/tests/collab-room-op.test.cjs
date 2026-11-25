// 共同編集のルームの中で、間取りの操作を1つ当てる経路(/op)と読む経路(/read)。段5で外の AI(MCP)から呼ぶ。
// 本物の CollaborationRoom を、偽の storage・R2・WebSocket(collab-room-fakes.cjs)で動かす。
//
// 見ていること:
//   - 当てた結果は、今の共同編集と同じ形の差分(patch)として積まれ、同じルームを開いている全員へ clientId "mcp" で流れる。
//     届いた差分を元のプランに当てると、あとから取得したプラン(GET)と同じになる(Review Focus 3)。
//   - 失敗した操作では、版が進まず、何も積まれず、誰にも流れず、R2 も変わらない(Review Focus 2)。
//   - 無いルーム・期限切れ・形の違う id は、例外でなく {ok:false, code:"room_not_found"}。形の違う id では Durable Object を作らない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeEnv, connect } = require('./collab-room-fakes.cjs');
const PlanCorePatch = require('../../assets/js/plan-core/patch.js');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const plan = () => JSON.parse(fs.readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const ORIGIN = 'https://cad-planner.example.test';

async function setup(p = plan()) {
  const rooms = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  const made = await rooms.createRoomWithPlan(env, p, ORIGIN);
  const room = env.room(made.roomId);
  return { env, made, room, rooms, roomId: made.roomId };
}

async function getPlan(env, roomId) {
  const res = await env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch('https://room/plan');
  assert.equal(res.status, 200);
  return { version: Number(res.headers.get('x-room-version')), plan: await res.json() };
}

// ルームの中身(storage の全部・アラーム・R2)を写す。失敗のあとに1つも変わっていないことを見るため。
function snapshotRoom(env, room) {
  return JSON.stringify({
    storage: Array.from(room.storage.data.entries()),
    alarm: room.storage.alarmAt(),
    r2: Array.from(env.PLANS.objects.entries()),
  });
}

// 操作を1つ当てて、差分の形・配信・取得の一致を確かめる。
async function applyAndCheck(ctx, op, args) {
  const { env, room, rooms, roomId } = ctx;
  const ws = connect(room, 'screen-' + Math.random().toString(16).slice(2));
  const before = await getPlan(env, roomId);
  const res = await rooms.roomOp(env, roomId, op, args);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(Object.keys(res), ['ok', 'version', 'changedIds', 'removedIds', 'warnings']);
  assert.equal(res.version, before.version + 1);
  const msgs = ws.messages();
  assert.equal(msgs.length, 1, '差分が1つだけ届く');
  const msg = msgs[0];
  // source は外の AI の変更の印(ルームが付ける。collab-room-ai-edits.test.cjs)。古い画面は知らない欄として読み飛ばす
  assert.deepEqual(Object.keys(msg), ['type', 'version', 'expiresAt', 'clientId', 'patch', 'source']);
  assert.equal(msg.source, 'ai');
  assert.equal(msg.type, 'patch');
  assert.equal(msg.clientId, 'mcp');
  assert.equal(msg.version, res.version);
  // 今の共同編集と同じ形: {collections:{名前:{upserts:[物], removes:[id 文字]}}, fields:{欄:値}}
  assert.deepEqual(Object.keys(msg.patch), ['collections', 'fields']);
  for (const [name, change] of Object.entries(msg.patch.collections)) {
    assert.ok(PlanCorePatch.COLLECTIONS.includes(name), name);
    assert.deepEqual(Object.keys(change), ['upserts', 'removes']);
    assert.ok(change.upserts.length + change.removes.length > 0);
    change.removes.forEach((id) => assert.equal(typeof id, 'string'));
  }
  for (const key of Object.keys(msg.patch.fields)) assert.ok(PlanCorePatch.SHARED_FIELDS.includes(key), key);
  // 積んだ物と流した物が同じ
  assert.deepEqual(await room.storage.get('patch:' + String(res.version).padStart(12, '0')), msg.patch);
  // 届いた差分を元のプランに当てると、取得したプランと同じ(画面の受け方と同じ当て方)
  const after = await getPlan(env, roomId);
  assert.equal(after.version, res.version);
  const replay = PlanCorePatch.applyPatch(structuredClone(before.plan), msg.patch);
  assert.deepEqual(replay, after.plan);
  ws.close(1000);
  return { res, patch: msg.patch, before: before.plan, after: after.plan };
}

test('createRoomWithPlan: 今の POST /api/rooms と同じ置き方でルームを作る', async () => {
  const { env, made, room } = await setup();
  assert.deepEqual(Object.keys(made), ['roomId', 'url', 'version', 'expiresAt', 'savedAt']);
  assert.equal(made.url, `${ORIGIN}/#room=${made.roomId}`);
  assert.equal(made.version, 1);
  assert.equal(env.PLANS.objects.get(`rooms/${made.roomId}.json`).body, JSON.stringify(plan()));
  assert.equal((await room.storage.get('meta')).roomId, made.roomId);
  const { createRoomWithPlan } = await mod('worker/routes-rooms.mjs');
  assert.deepEqual(await createRoomWithPlan(env, { walls: [] }, ORIGIN), { error: 'invalid_plan', status: 400 });
  // URL の土台は、パスや問い合わせが付いていてもオリジンの / にする(今の経路と同じ)
  const other = await createRoomWithPlan(env, plan(), `${ORIGIN}/mcp?x=1#y`);
  assert.equal(other.url, `${ORIGIN}/#room=${other.roomId}`);
});

test('/op 家具を置く: 版が進み、差分が1つ届き、取得したプランに入っている', async () => {
  const ctx = await setup();
  const { res, patch, after } = await applyAndCheck(ctx, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(res.changedIds.length, 1);
  assert.deepEqual(res.removedIds, []);
  assert.deepEqual(Object.keys(patch.collections), ['items']);
  assert.equal(patch.collections.items.upserts.length, 1);
  const placed = after.items.find((it) => String(it.id) === String(res.changedIds[0]));
  assert.ok(placed);
  assert.equal(placed.floor, 2);
  // 期限と書き戻しの予約は /update と同じに進む
  const meta = await ctx.room.storage.get('meta');
  assert.ok(meta.checkpointDueAt > Date.now() - 1000);
  assert.equal(ctx.room.storage.alarmAt(), meta.checkpointDueAt);
});

test('/op 消す・壁を消す・設定を変える・部屋を足す・動かす: どれも差分を当てると取得と同じ', async () => {
  const ctx = await setup();
  const p = plan();
  const sofa = p.items.find((it) => /Sofa/.test(it.type));
  const del = await applyAndCheck(ctx, 'deleteObjects', { ids: [String(sofa.id)] });
  assert.deepEqual(del.patch.collections.items, { upserts: [], removes: [String(sofa.id)] });
  assert.deepEqual(del.res.removedIds.map(String), [String(sofa.id)]);

  // 壁を消すと外壁の設定表(exteriorWallSettings)の行も片付き、欄ごと fields で届く
  const key = Object.keys(p.exteriorWallSettings.walls)[0];
  const wall = p.walls.find((w) => String(w.id) === key);
  const rw = await applyAndCheck(ctx, 'removeWall', { id: String(wall.id) });
  assert.deepEqual(rw.patch.collections.walls.removes, [String(wall.id)]);
  assert.deepEqual(Object.keys(rw.patch.fields), ['exteriorWallSettings']);
  assert.equal(rw.after.exteriorWallSettings.walls[key], undefined);

  const w2 = p.walls.find((w) => w.id !== wall.id);
  const sp = await applyAndCheck(ctx, 'setProps', { id: String(w2.id), set: { thick: 150 } });
  assert.equal(sp.patch.collections.walls.upserts[0].thick, 150);

  const ar = await applyAndCheck(ctx, 'addRoom', { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 });
  assert.equal(ar.patch.collections.rooms.upserts[0].n, '書庫');

  const mv = await applyAndCheck(ctx, 'moveObject', { id: ar.res.changedIds[0], dx: 910, dy: 0 });
  assert.equal(mv.patch.collections.rooms.upserts.length, 1);

  // 全部を順に流した結果と、最後に取得したプランが同じ
  const last = await getPlan(ctx.env, ctx.roomId);
  assert.equal(last.version, 6);
  assert.equal(last.plan.items.some((it) => it.id === sofa.id), false);
});

// 床材の欄を1つ(floorMaterial)に寄せる(2026-11-25)。ルームの元のプランが古い形(部屋の texture に床材のキー)でも、
// 外の AI の操作で触った部屋は新しい形で届く(画面が開くときと同じ PlanSchema.normalizeFloorMaterials)。
// 触っていない部屋は差分に入れない(画面も開くときに同じに寄せているので、送らなくても食い違わない)。
test('/op 古い形の床材の部屋: 触った部屋だけが floorMaterial の形で届き、ほかの部屋は差分に入らない', async () => {
  const ctx = await setup();
  const p = plan();
  const legacy = p.rooms.filter((r) => r.texture === 'wood_floor' || r.texture === 'tile_floor');
  assert.ok(legacy.length >= 10, '凍結した間取りは古い形の部屋を持つ');
  const target = legacy.find((r) => r.texture === 'wood_floor');
  const mv = await applyAndCheck(ctx, 'moveObject', { id: target.id, dx: 0, dy: 10 });
  assert.equal(mv.patch.collections.rooms.upserts.length, 1, '触った部屋だけが届く');
  const sent = mv.patch.collections.rooms.upserts[0];
  assert.equal(sent.id, target.id);
  assert.equal(sent.floorMaterial, 'wood_floor', '床材は floorMaterial で届く(値はそのまま)');
  assert.equal('texture' in sent, false, '床材のキーを texture に残さない');
  // 床材を変える操作でも同じ(画面の床が変わる形で届く)
  const other = legacy.find((r) => r.texture === 'tile_floor');
  const sp = await applyAndCheck(ctx, 'setProps', { id: other.id, set: { floorMaterial: 'wood_oak' } });
  const changed = sp.patch.collections.rooms.upserts;
  assert.equal(changed.length, 1);
  assert.equal(changed[0].floorMaterial, 'wood_oak');
  assert.equal('texture' in changed[0], false);
  assert.deepEqual(sp.res.warnings, []);
  // 触っていない古い形の部屋は、ルームのプランでもそのまま(寄せただけの部屋を書き戻さない)
  const last = await getPlan(ctx.env, ctx.roomId);
  const untouched = last.plan.rooms.filter((r) => r.id !== target.id && r.id !== other.id && legacy.some((l) => l.id === r.id));
  assert.equal(untouched.length, legacy.length - 2);
  untouched.forEach((r) => assert.equal(r.texture, legacy.find((l) => l.id === r.id).texture));
});

// 土間(floorLevel=doma)と、土間をやめる normal。深さは画面の設定パネル「玄関土間」と同じ HeightModel.domaFloorRaiseMm で、
// 床の厚みで決まる。天井に付いた器具は床の上下ぶん動き(画面の followRoomCeiling と同じ)、下の階の折り上げ天井の上では
// 床を下げられる下限が上がる(画面の CeilingDesigner.floorLoweringLimit と同じ)。画面と同じ値を式で出せない部屋
// (下の階の天井が勾配天井など)は断る。
test('/op 土間: 床の上下が床の厚みで決まる深さで届き、器具も動き、normal で戻る', async () => {
  const HeightModel = require('../../assets/js/height-model.js');
  const p = plan();
  p.heightDefaults = { modelVersion: 2, perFloor: true, floorThickness: 220 };
  p.floors = { 2: { floorThickness: 260 } };
  const ctx = await setup(p);
  const inRoom = (r) => (it) => (it.floor || 1) === r.floor && it.x + it.w / 2 >= r.x && it.x + it.w / 2 <= r.x + r.w && it.y + it.d / 2 >= r.y && it.y + it.d / 2 <= r.y + r.d;
  const fixture = (it) => /^light-/.test(it.type) || it.type === 'fmp-CeilingFan01' || it.type === 'original-laundry-rail';
  const plain = p.rooms.filter((r) => !p.items.some((it) => fixture(it) && inRoom(r)(it)));
  const plain1 = plain.find((r) => r.floor === 1), plain2 = plain.find((r) => r.floor === 2);
  assert.ok(plain1 && plain2, '器具の無い部屋が1階・2階にある');
  for (const [room, want] of [[plain1, -200], [plain2, -240]]) {
    assert.equal(HeightModel.domaFloorRaiseMm(p, room.floor), want);
    const sp = await applyAndCheck(ctx, 'setProps', { id: room.id, set: { floorLevel: 'doma' } });
    assert.deepEqual(sp.res.changedIds.map(String), [String(room.id)]);
    const sent = sp.patch.collections.rooms.upserts.find((r) => r.id === room.id);
    assert.equal(sent.floorRaiseMm, want);
    assert.equal('floorLevel' in sent, false, 'アプリの部屋に floorLevel を残さない');
  }
  // 器具のある部屋: 床が 200 下がると、器具は天井からの下がりを保って床から 200 遠くなる。normal で戻る
  const lit = p.rooms.find((r) => r.floor === 1 && p.items.some((it) => fixture(it) && inRoom(r)(it)));
  const lights = p.items.filter((it) => fixture(it) && inRoom(lit)(it));
  const down = await applyAndCheck(ctx, 'setProps', { id: lit.id, set: { floorLevel: 'doma' } });
  assert.deepEqual(down.res.changedIds.map(String), [String(lit.id)].concat(lights.map((it) => String(it.id))));
  lights.forEach((it) => assert.equal(down.patch.collections.items.upserts.find((x) => x.id === it.id).elev, (Number(it.elev) || 0) + 200));
  const up = await applyAndCheck(ctx, 'setProps', { id: lit.id, set: { floorLevel: 'normal' } });
  assert.equal(up.patch.collections.rooms.upserts.find((r) => r.id === lit.id).floorRaiseMm, 0);
  lights.forEach((it) => assert.equal(up.patch.collections.items.upserts.find((x) => x.id === it.id).elev, Number(it.elev) || 0));
  // 下の階に折り上げ天井(段差が上向きの天井の範囲)がある部屋: 下の階の天井が平らなら、下限まで下げる
  const p2 = plan();
  p2.heightDefaults = { modelVersion: 2 };
  const above = p2.rooms.find((r) => r.floor === 2 && !p2.items.some((it) => fixture(it) && inRoom(r)(it)));
  p2.items.push({ id: 99001, type: 'ceiling-area', floor: 1, x: above.x + 100, y: above.y + 100, w: 600, d: 600, rot: 0, offset: 150 });
  const ctx2 = await setup(p2);
  const r2 = await applyAndCheck(ctx2, 'setProps', { id: above.id, set: { floorLevel: 'doma' } });
  // 床厚 180 の既定: 1階の天井(階高 2580 = 壁 2400+床厚 180 の天端)+段差 150+20 − (2階の床の構造面 2580+床厚 180) = −10。
  // 土間の深さ −160 より浅いところで止まる(画面の CeilingDesigner.floorLoweringLimit と同じ)
  assert.equal(r2.patch.collections.rooms.upserts.find((r) => r.id === above.id).floorRaiseMm, -10);
  // 下の階の部屋が勾配天井だと、天井面が屋根・勾配から決まるので断る
  const p3 = plan();
  p3.heightDefaults = { modelVersion: 2 };
  const below = p3.rooms.find((r) => r.floor === 1 && r.x <= above.x + 100 && above.x + 700 <= r.x + r.w && r.y <= above.y + 100 && above.y + 700 <= r.y + r.d);
  assert.ok(below, '折り上げ天井を置く1階の部屋');
  below.ceiling = { type: 'sloped', lowMm: 2200, highMm: 3000, direction: 90 };
  p3.items.push({ id: 99001, type: 'ceiling-area', floor: 1, x: above.x + 100, y: above.y + 100, w: 600, d: 600, rot: 0, offset: 150 });
  const ctx3 = await setup(p3);
  const ws = connect(ctx3.room, 'screen-b');
  const r3 = await ctx3.rooms.roomOp(ctx3.env, ctx3.roomId, 'setProps', { id: above.id, set: { floorLevel: 'doma' } });
  assert.equal(r3.ok, false);
  assert.match(r3.errors[0].message, /画面で行ってください.*折り上げ天井/);
  assert.equal(ws.sent.length, 0);
});

test('/op 失敗する操作: 版が進まず、何も積まれず、誰にも届かず、R2 も変わらない', async () => {
  const p = plan();
  p.items[1].locked = true;
  const ctx = await setup(p);
  const ws = connect(ctx.room, 'screen-a');
  const snap = snapshotRoom(ctx.env, ctx.room);
  const cases = [
    ['placeItem', { type: 'sofaa', x: 0, y: 0 }, /カタログにありません/],          // 知らない種類(候補つき)
    ['deleteObjects', { ids: ['999999'] }, /./],                                     // 無い id
    ['deleteObjects', { ids: [String(p.items[1].id)] }, /ロック/],                   // ロックした物
    ['placeItem', { type: 'bed', x: 0, y: 0, color: 'red' }, /./],                   // 知らない引数(checkArgs)
    ['setProps', { id: String(p.items[1].id), props: { x: 0 } }, /./],             // 画面用の props は受けない
    ['dropTable', {}, /知らない操作/],                                                 // 知らない操作
    ['placeItem', { type: 'opening-door-model:default', x: 100, y: 0 }, /画面で行ってください/], // Worker が断る操作
  ];
  for (const [op, args, re] of cases) {
    const res = await ctx.rooms.roomOp(ctx.env, ctx.roomId, op, args);
    assert.equal(res.ok, false, op + JSON.stringify(args));
    assert.ok(Array.isArray(res.errors) && res.errors.length >= 1);
    for (const e of res.errors) assert.deepEqual(Object.keys(e).filter((k) => k !== 'candidates'), ['message']);
    assert.match(res.errors.map((e) => e.message).join('\n'), re, op);
    assert.equal(snapshotRoom(ctx.env, ctx.room), snap, op + ' でルームが変わった');
  }
  const unknown = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', { type: 'sofaa', x: 0, y: 0 });
  assert.ok(unknown.errors[0].candidates.includes('sofa'));
  assert.equal(ws.sent.length, 0);
  assert.equal((await getPlan(ctx.env, ctx.roomId)).version, 1);
});

test('/op 何も変わらない操作: 成功として返すが、版は進めず、積まず、流さない', async () => {
  const ctx = await setup();
  const ws = connect(ctx.room, 'screen-a');
  const wall = plan().walls[0];
  const snap = snapshotRoom(ctx.env, ctx.room);
  const res = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'setProps', { id: String(wall.id), set: { thick: wall.thick } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.version, 1);
  assert.equal(snapshotRoom(ctx.env, ctx.room), snap);
  assert.equal(ws.sent.length, 0);
});

test('/op のあとに画面の /update が来ても、版は続きから進み、全部が積まれる', async () => {
  const ctx = await setup();
  const ws = connect(ctx.room, 'screen-a');
  const op = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 });
  const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName(ctx.roomId));
  const res = await stub.fetch('https://room/update', {
    method: 'POST',
    body: JSON.stringify({ type: 'patch', clientId: 'screen-a', baseVersion: 1, patch: { collections: {}, fields: { northDeg: 10 } } }),
  });
  const body = await res.json();
  assert.equal(body.version, 3);
  assert.equal(body.conflict, true, '画面は MCP の版を知らずに送った');
  assert.deepEqual(ws.messages().map((m) => [m.version, m.clientId]), [[2, 'mcp'], [3, 'screen-a']]);
  const got = await getPlan(ctx.env, ctx.roomId);
  assert.equal(got.plan.northDeg, 10);
  assert.ok(got.plan.rooms.some((r) => String(r.id) === String(op.changedIds[0])));
});

test('/read: 要約と検査。版も返す。ルームは変えない', async () => {
  const ctx = await setup();
  await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 });
  const snap = snapshotRoom(ctx.env, ctx.room);
  const s = await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'summary');
  assert.equal(s.ok, true);
  assert.equal(s.version, 2);
  assert.ok(s.summary.startsWith('<plan_summary>\n'));
  assert.match(s.summary, /書庫/);
  const i = await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'inspect');
  assert.equal(i.ok, true);
  assert.deepEqual(Object.keys(i.inspect).sort(), ['errors', 'ok', 'warnings']);
  const bad = await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'plan');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /summary/);
  assert.equal(snapshotRoom(ctx.env, ctx.room), snap);
});

test('無いルーム・期限切れ・形の違う id は room_not_found。形の違う id では Durable Object を作らない', async () => {
  const ctx = await setup();
  const { rooms, env } = ctx;
  for (const id of ['short', '../rooms/x', 'A'.repeat(23), '', null, undefined, 12, 'AAAAAAAAAAAAAAAAAAAA/A']) {
    const n = env.ROOMS.created.length;
    assert.deepEqual(await rooms.roomOp(env, id, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), { ok: false, code: 'room_not_found' });
    assert.deepEqual(await rooms.roomRead(env, id, 'summary'), { ok: false, code: 'room_not_found' });
    assert.equal(env.ROOMS.created.length, n, String(id));
  }
  const ghost = 'B'.repeat(22);
  assert.deepEqual(await rooms.roomOp(env, ghost, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), { ok: false, code: 'room_not_found' });
  assert.deepEqual(await rooms.roomRead(env, ghost, 'inspect'), { ok: false, code: 'room_not_found' });
  assert.equal(env.room(ghost).storage.data.size, 0, '無いルームに何も書かない');

  // R2 の元の全体が無い(消えた)ルーム
  const lost = await setup();
  lost.env.PLANS.objects.clear();
  assert.deepEqual(await lost.rooms.roomOp(lost.env, lost.roomId, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), { ok: false, code: 'room_not_found' });
  assert.equal((await lost.room.storage.get('meta')).version, 1);

  // 期限切れ: 取得と同じく片付ける(R2 と storage を消し、つないでいる人を閉じる)
  const ws = connect(ctx.room, 'screen-a');
  const meta = await ctx.room.storage.get('meta');
  await ctx.room.storage.put('meta', { ...meta, expiresAt: Date.now() - 1 });
  assert.deepEqual(await rooms.roomOp(env, ctx.roomId, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), { ok: false, code: 'room_not_found' });
  assert.equal(env.PLANS.objects.has(`rooms/${ctx.roomId}.json`), false);
  assert.equal(ctx.room.storage.data.size, 0);
  assert.equal(ws.closeCode, 4001);
  assert.deepEqual(await rooms.roomRead(env, ctx.roomId, 'summary'), { ok: false, code: 'room_not_found' });
});

test('差分の作り方: 共有しない欄が変わったら差分にせず知らせる。物の並びと null の扱いは画面と同じ', async () => {
  const { buildRoomPatch } = await mod('worker/collab-room.mjs');
  const a = plan();
  const b = structuredClone(a);
  assert.equal(buildRoomPatch(a, b).patch, null, '変わらなければ差分なし');
  b.items.push({ id: 5000, type: 'bed', x: 0, y: 0, w: 1000, d: 2000, floor: 1 });
  b.items[0] = { ...b.items[0], x: 5 };
  b.rooms = b.rooms.filter((r) => r.id !== 'r1019');
  b.northDeg = 20;
  delete b.roofAppearance;
  const r = buildRoomPatch(a, b);
  assert.deepEqual(r.unshared, []);
  assert.deepEqual(r.patch.collections.items.upserts.map((o) => o.id), [a.items[0].id, 5000]);
  assert.deepEqual(r.patch.collections.rooms, { upserts: [], removes: ['r1019'] });
  assert.deepEqual(r.patch.fields, { roofAppearance: null, northDeg: 20 });
  assert.deepEqual(PlanCorePatch.applyPatch(structuredClone(a), r.patch), { ...b, roofAppearance: null });
  // 差分は写し(あとで b を書き換えても差分は変わらない)
  b.items[0].x = 99;
  assert.equal(r.patch.collections.items.upserts[0].x, 5);
  const c = structuredClone(a);
  c.viewState = { cam: 1 };
  c.planFixes = { x: true };
  assert.deepEqual(buildRoomPatch(a, c).unshared.sort(), ['planFixes', 'viewState']);
});

test('/op 新しい物の id を使い回さない: 置く→消す→置くで別の id。部屋も同じ連番', async () => {
  const ctx = await setup();
  const bed = { type: 'bed', x: 1365, y: 5460, floor: 2 };
  const first = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', bed);
  const id1 = first.changedIds[0];
  assert.equal((await ctx.room.storage.get('meta')).nextId, Number(id1) + 1);
  const del = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'deleteObjects', { ids: [String(id1)] });
  assert.equal(del.ok, true);
  const second = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', bed);
  assert.notEqual(String(second.changedIds[0]), String(id1));
  assert.equal(Number(second.changedIds[0]), Number(id1) + 1);
  const room = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { x: 20000, y: 20000, w: 2730, d: 3640 });
  assert.equal(room.changedIds[0], 'rm_' + (Number(id1) + 2));
  assert.equal((await ctx.room.storage.get('meta')).nextId, Number(id1) + 3);
});

test('/op 画面から大きい id の物が届いたあとは、それより大きい id を使う', async () => {
  const ctx = await setup();
  await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName(ctx.roomId));
  const big = { id: 900000, type: 'bed', x: 0, y: 9000, w: 1000, d: 2000, rot: 0, floor: 2 };
  await stub.fetch('https://room/update', {
    method: 'POST',
    body: JSON.stringify({ type: 'patch', clientId: 'screen-a', baseVersion: 2, patch: { collections: { items: { upserts: [big], removes: [] } }, fields: {} } }),
  });
  const res = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(res.changedIds[0], 900001);
  // 画面がその物を消したあとも、連番は戻らない
  await stub.fetch('https://room/update', {
    method: 'POST',
    body: JSON.stringify({ type: 'patch', clientId: 'screen-a', baseVersion: 3, patch: { collections: { items: { upserts: [], removes: ['900000', '900001'] } }, fields: {} } }),
  });
  const again = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', { type: 'bed', x: 1365, y: 5460, floor: 2 });
  assert.equal(again.changedIds[0], 900002);
});

test('/op 検査の誤りが増える操作は積まずに断る。もとからある誤りは直せる', async () => {
  const ctx = await setup();
  const ws = connect(ctx.room, 'screen-a');
  const snap = snapshotRoom(ctx.env, ctx.room);
  const res = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { x: 0, y: 0, w: 1e308, d: 1000 });
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /間取りのデータが正しくなくなるため、行いませんでした/);
  assert.match(res.errors[0].message, /rooms\[\d+\]/);
  assert.equal(snapshotRoom(ctx.env, ctx.room), snap);
  assert.equal(ws.sent.length, 0);

  // もとから誤りのあるプラン(位置が範囲外の部屋)でも、ほかの物を消したり足したりできる(誤りの位置がずれても増えたとはみなさない)
  const p = plan();
  p.rooms.push({ ...p.rooms[0], id: 'r9999', x: 1e308 });
  const broken = await setup(p);
  const before = await broken.rooms.roomRead(broken.env, broken.roomId, 'inspect');
  assert.equal(before.inspect.ok, false);
  const del = await broken.rooms.roomOp(broken.env, broken.roomId, 'deleteObjects', { ids: ['r1019'] });
  assert.equal(del.ok, true, JSON.stringify(del));
  const fix = await broken.rooms.roomOp(broken.env, broken.roomId, 'deleteObjects', { ids: ['r9999'] });
  assert.equal(fix.ok, true);
  assert.equal((await broken.rooms.roomRead(broken.env, broken.roomId, 'inspect')).inspect.ok, true);
});

test('/op・/read 引数と本文の大きさの上限: 当てずに失敗で返す', async () => {
  const ctx = await setup();
  const snap = snapshotRoom(ctx.env, ctx.room);
  const many = Array.from({ length: 201 }, (_, i) => String(i));
  let deep = 1;
  for (let i = 0; i < 6; i++) deep = { a: deep };
  const cases = [
    ['addRoom', { name: 'あ'.repeat(501), x: 0, y: 0, w: 1000, d: 1000 }, /500 字まで/],
    ['deleteObjects', { ids: many }, /200 件まで/],
    ['setProps', { id: '1002', set: deep }, /6 段まで/],
  ];
  for (const [op, args, re] of cases) {
    const res = await ctx.rooms.roomOp(ctx.env, ctx.roomId, op, args);
    assert.equal(res.ok, false, op);
    assert.match(res.errors[0].message, re);
  }
  // ちょうど上限(500 字)は大きさの検査を通り、操作の検査の段まで進む(部屋の名前は操作の側で 40 字までなので、そこで断られる)
  const atLimit = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { name: 'あ'.repeat(500), x: 20000, y: 20000, w: 1000, d: 1000 });
  assert.equal(atLimit.ok, false);
  assert.match(atLimit.errors[0].message, /40 字まで/);
  const okName = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { name: 'あ'.repeat(40), x: 20000, y: 20000, w: 1000, d: 1000 });
  assert.equal(okName.ok, true);
  const snap2 = snapshotRoom(ctx.env, ctx.room);
  assert.notEqual(snap2, snap);
  // 本文が 64KB を超える
  const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName(ctx.roomId));
  for (const path of ['/op', '/read']) {
    const res = await stub.fetch('https://room' + path, { method: 'POST', body: JSON.stringify({ op: 'addRoom', what: 'summary', pad: 'x'.repeat(65 * 1024) }) });
    const body = await res.json();
    assert.equal(body.ok, false, path);
    assert.ok(body.errors[0].message, path);
  }
  assert.equal(snapshotRoom(ctx.env, ctx.room), snap2);
});

test('roomOp・roomRead: ルームの中で例外が出ても、返事が JSON でなくても、例外を外へ出さず「いまは操作できません」で返す', async () => {
  const ctx = await setup();
  const want = { ok: false, errors: [{ message: 'いまは操作できませんでした。少し待ってからもう一度お試しください。' }] };
  const real = ctx.room.instance;
  const origApply = real.applyOp;
  const origRead = real.read;
  // ルームの中の処理が投げる
  real.applyOp = async () => { throw new Error('boom'); };
  real.read = async () => { throw new Error('boom'); };
  assert.deepEqual(await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), want);
  assert.deepEqual(await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'summary'), want);
  real.applyOp = origApply;
  real.read = origRead;
  // 返事が JSON でない・ルームの返事の形でない・成功の形なのに状態が失敗
  const origFetch = real.fetch;
  const replies = [
    () => new Response('Internal Error', { status: 500 }),
    () => new Response(JSON.stringify({ error: 'not_found' }), { status: 500 }),
    () => new Response(JSON.stringify([1, 2]), { status: 200 }),
    () => new Response(JSON.stringify({ ok: true, version: 9 }), { status: 500 }),
  ];
  for (const reply of replies) {
    real.fetch = async () => reply();
    assert.deepEqual(await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), want);
    assert.deepEqual(await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'inspect'), want);
  }
  // Durable Object を引くところで投げる
  real.fetch = origFetch;
  const env2 = { ...ctx.env, ROOMS: { idFromName: () => { throw new Error('boom'); }, get: () => null } };
  assert.deepEqual(await ctx.rooms.roomOp(env2, ctx.roomId, 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 }), want);
  // 無いルームと本文の誤りは、状態が 404・400 でもそのまま返す
  const missing = await ctx.rooms.roomOp(ctx.env, 'A'.repeat(22), 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 });
  assert.deepEqual(missing, { ok: false, code: 'room_not_found' });
  const badWhat = await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'everything');
  assert.equal(badWhat.ok, false);
  assert.match(badWhat.errors[0].message, /summary か inspect/);
  // 元に戻せば普通に動く
  const ok = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 });
  assert.equal(ok.ok, true);
});

test('createRoomWithPlan: origin が URL として読めなければ、R2 に置く前に止まり、ルームも作らない', async () => {
  const rooms = await mod('worker/routes-rooms.mjs');
  const env = await makeEnv();
  for (const bad of ['', 'not a url', '/relative/path', undefined]) {
    await assert.rejects(() => rooms.createRoomWithPlan(env, plan(), bad));
  }
  assert.equal(env.PLANS.objects.size, 0);
  assert.equal(env.PLANS.puts.length, 0);
  assert.deepEqual(env.ROOMS.created, []);
});

test('同時の呼び出し: R2 の読み込みが遅くても、/op・/update・/op・/op は1つずつ当たり、版は抜けも重なりもなく進み、id も重ならない', async () => {
  const ctx = await setup();
  const ws = connect(ctx.room, 'screen-a');
  // 偽の R2 の読み込みを遅らせる(1回ごとに少しずつ違う長さ)。ルームの中の順番待ちが無いと、ここで追い越しが起きる。
  const realGet = ctx.env.PLANS.get.bind(ctx.env.PLANS);
  let n = 0;
  ctx.env.PLANS.get = async (key) => {
    const wait = [30, 5, 20, 1][n++ % 4];
    await new Promise((r) => setTimeout(r, wait));
    return realGet(key);
  };
  const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName(ctx.roomId));
  const screenItem = { id: 800000, type: 'bed', x: 0, y: 9000, w: 1000, d: 2000, rot: 0, floor: 2 };
  const bed = { type: 'bed', x: 1365, y: 5460, floor: 2 };
  const [a, upd, b, c] = await Promise.all([
    ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', bed),
    stub.fetch('https://room/update', {
      method: 'POST',
      body: JSON.stringify({ type: 'patch', clientId: 'screen-a', baseVersion: 1, patch: { collections: { items: { upserts: [screenItem], removes: [] } }, fields: {} } }),
    }).then((r) => r.json()),
    ctx.rooms.roomOp(ctx.env, ctx.roomId, 'placeItem', bed),
    ctx.rooms.roomOp(ctx.env, ctx.roomId, 'addRoom', { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 }),
  ]);
  for (const r of [a, b, c]) assert.equal(r.ok, true, JSON.stringify(r));
  // 投げた順に1つずつ当たる
  assert.deepEqual([a.version, upd.version, b.version, c.version], [2, 3, 4, 5]);
  // 配信も版の順に、抜けなく1つずつ
  assert.deepEqual(ws.messages().map((m) => m.version), [2, 3, 4, 5]);
  // 積んだ差分も 2〜5 が1つずつ
  const journal = Array.from(ctx.room.storage.data.keys()).filter((k) => k.startsWith('patch:')).sort();
  assert.deepEqual(journal, [2, 3, 4, 5].map((v) => 'patch:' + String(v).padStart(12, '0')));
  // 新しい物の id は重ならない(画面から届いた 800000 のあとは、それより大きい)
  const ids = [a.changedIds[0], b.changedIds[0], c.changedIds[0]].map(String);
  assert.equal(new Set(ids.concat(['800000'])).size, 4, ids.join(','));
  assert.ok(Number(b.changedIds[0]) > 800000);
  ctx.env.PLANS.get = realGet;
  const got = await getPlan(ctx.env, ctx.roomId);
  assert.equal(got.version, 5);
  const all = got.plan.items.map((i) => String(i.id)).concat(got.plan.rooms.map((r) => String(r.id)), got.plan.walls.map((w) => String(w.id)));
  assert.equal(new Set(all).size, all.length, '取得したプランの id に重なりが無い');
});

test('外の AI の回数の上限: /op はルームごとに1日 600 回(成功・失敗を問わず)。601 回めは当てず、版も差分も進まない。日付が変わると戻る', async () => {
  const room = await mod('worker/collab-room.mjs');
  assert.equal(room.MCP_OPS_PER_DAY, 600);
  const small = { walls: [], items: [], rooms: [{ id: 'r1', n: '洋室', x: 0, y: 0, w: 2730, d: 3640, floor: 1 }] };
  const ctx = await setup(small);
  // 400 回は成功(名前を変える)、200 回は失敗(無い id)
  for (let i = 0; i < 400; i++) {
    const r = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'renameRoom', { id: 'r1', name: '洋室' + i });
    assert.equal(r.ok, true, String(i));
  }
  for (let i = 0; i < 200; i++) {
    const r = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'renameRoom', { id: 'nope', name: 'x' });
    assert.equal(r.ok, false);
    assert.notEqual(r.code, 'op_limit', String(i));
  }
  const ws = connect(ctx.room, 'screen-a');
  const snap = snapshotRoom(ctx.env, ctx.room);
  const over = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'renameRoom', { id: 'r1', name: '和室' });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'op_limit');
  assert.equal(over.errors[0].message, room.MCP_OP_LIMIT_MESSAGE);
  assert.equal(snapshotRoom(ctx.env, ctx.room), snap, '版も差分も meta も変わらない');
  assert.deepEqual(ws.messages(), [], '誰にも届かない');
  // meta には成功した分の数だけが残る(失敗の分を数えるためだけには書かない)
  const meta = await ctx.room.storage.get('meta');
  assert.equal(meta.mcpOps.n, 400);
  assert.equal(meta.version, 401);
  // 画面からの /update と取得は今までどおり通る
  const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName(ctx.roomId));
  const upd = await stub.fetch('https://room/update', {
    method: 'POST', body: JSON.stringify({ type: 'patch', clientId: 'screen-a', baseVersion: 401, patch: { collections: {}, fields: { northDeg: 5 } } }),
  });
  assert.equal(upd.status, 200);
  assert.equal((await upd.json()).version, 402);
  assert.equal((await getPlan(ctx.env, ctx.roomId)).plan.northDeg, 5);
  assert.equal((await ctx.room.storage.get('meta')).mcpOps.n, 400, '/update は数を変えない');
  // ルームが眠ってメモリが消えたら、meta の数(成功の 400)から数え直す: あと 200 回
  ctx.room.instance = new room.CollaborationRoom(ctx.room.state, ctx.env);
  for (let i = 0; i < 200; i++) {
    const r = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'renameRoom', { id: 'nope', name: 'x' });
    assert.notEqual(r.code, 'op_limit', String(i));
  }
  assert.equal((await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'renameRoom', { id: 'r1', name: '和室' })).code, 'op_limit');
  // 日付(UTC)が変わると戻る
  const realNow = Date.now;
  Date.now = () => realNow() + 24 * 60 * 60 * 1000;
  try {
    const next = await ctx.rooms.roomOp(ctx.env, ctx.roomId, 'renameRoom', { id: 'r1', name: '和室' });
    assert.equal(next.ok, true, JSON.stringify(next));
    assert.equal((await ctx.room.storage.get('meta')).mcpOps.n, 1);
  } finally {
    Date.now = realNow;
  }
});

test('外の AI の回数の上限: /read はルームごとに1分 60 回。61 回めは断り、1分たつと戻る。書き込みは増えない', async () => {
  const room = await mod('worker/collab-room.mjs');
  assert.equal(room.MCP_READS_PER_MINUTE, 60);
  const ctx = await setup();
  const snap = snapshotRoom(ctx.env, ctx.room);
  for (let i = 0; i < 60; i++) {
    const r = await ctx.rooms.roomRead(ctx.env, ctx.roomId, i % 2 ? 'summary' : 'inspect');
    assert.equal(r.ok, true, String(i));
  }
  const over = await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'summary');
  assert.equal(over.ok, false);
  assert.equal(over.code, 'read_limit');
  assert.equal(over.errors[0].message, room.MCP_READ_LIMIT_MESSAGE);
  assert.equal(snapshotRoom(ctx.env, ctx.room), snap, '読むだけでは storage も R2 も変わらない');
  // 画面からの取得には掛からない
  assert.equal((await getPlan(ctx.env, ctx.roomId)).version, 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 61 * 1000;
  try {
    assert.equal((await ctx.rooms.roomRead(ctx.env, ctx.roomId, 'summary')).ok, true);
  } finally {
    Date.now = realNow;
  }
});
