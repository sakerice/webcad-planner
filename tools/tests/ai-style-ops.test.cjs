// AI(チャット・MCP)から使える、色・仕上げの設定(setProps の編集だけの項目)と家具の一括差し替え(swapAssetSet)の検査。
//
// なぜ在るのか
// ------------
// 利用者に「AI から一括差し替えが使えない。家具の配置しかできないのか」と言われ(2026-11-26)、画面の一括差し替えと、
// 設定パネルの床・天井の色、サッシの色、扉の仕上げ、家具の部位ごとの色・素材・艶を、AI からも使えるようにした。
// ここは Worker の ctx(worker/plan-ctx.mjs)で、利用場面どおりに当てて確かめる。画面と同じ結果になるかは
// 画面テスト(settable-panel-parity・worker-ctx-parity・swap-asset-set-op)が照らし合わせる。
//
// 守ること:
//   - 読み取り(図面の取り込み)の動きを変えない。色・仕上げは図面から読めないので、読み取りの指示文と取り込みには出さない
//   - ロックされた物は変えない。失敗したら全部取り消す
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'worker', 'plan-ctx.mjs')).href);
const PlanSettable = require('../../assets/js/plan-settable.js');
const Catalog = require('../../assets/js/plan-core/operations-catalog.js');
const Knowledge = require('../../assets/js/object-knowledge.js');
const furniture = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'data', 'worker-furniture.json'), 'utf8'));
// 凍結間取り(既定プランと同じ形の2階建て)。既定プランは直接読まない。
const plan = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const byId = (p, id) => p.items.find((it) => String(it.id) === String(id)) || p.rooms.find((r) => String(r.id) === String(id));
const EDIT_ONLY = Object.keys(PlanSettable.SETTINGS).flatMap((part) => PlanSettable.SETTINGS[part].filter((s) => s.editOnly).map((s) => s.key));

test('色・仕上げの項目は編集だけ。読み取りの指示文は、足す前と同じ文のまま', async () => {
  assert.deepEqual(EDIT_ONLY.sort(), ['ceilingColor', 'doorFinish', 'finishColors', 'finishRoughness', 'finishTextures', 'floorColor', 'sashColor'].sort());
  const { buildFreePrompt } = await import(pathToFileURL(path.join(ROOT, 'worker', 'plan-free.mjs')).href);
  const now = buildFreePrompt({ pages: 1 });
  for (const k of EDIT_ONLY) assert.ok(!now.includes(k + '（'), '読み取りの指示文に編集だけの項目 ' + k + ' が出た');
  // 編集だけの項目を表から抜いても、読み取りの指示文が1文字も変わらない(= 足した項目は読み取りに効いていない)
  const saved = {};
  Object.keys(PlanSettable.SETTINGS).forEach((part) => {
    saved[part] = PlanSettable.SETTINGS[part];
    PlanSettable.SETTINGS[part] = saved[part].filter((s) => !s.editOnly);
  });
  let without;
  try { without = buildFreePrompt({ pages: 1 }); } finally {
    Object.keys(saved).forEach((part) => { PlanSettable.SETTINGS[part] = saved[part]; });
  }
  assert.equal(now, without, '編集だけの項目が読み取りの指示文を変えた');
  // 読み取りの取り込み(印 edit の無い applySettings)は、編集だけの項目を知らない項目と同じに断る
  const rejected = [];
  const out = PlanSettable.applySettings('room', null, [{ key: 'floorColor', value: '#336699' }, { key: 'floorMaterial', value: 'tile_floor' }], {}, { rejected });
  assert.deepEqual(out, { floorMaterial: 'tile_floor' });
  assert.deepEqual(rejected, ['floorColor=#336699']);
  const r2 = [];
  assert.deepEqual(PlanSettable.applySettings('opening', 'window', 'sashColor=#22252a', {}, { rejected: r2 }), {});
  assert.deepEqual(r2, ['sashColor=#22252a']);
});

test('床・天井の色: #rrggbb を小文字で書き、"" で外す。ほかの形は候補つきで断る', async () => {
  const { workerApply } = await load();
  const p = plan();
  const room = p.rooms.find((r) => r.n === '洋室' && r.floor === 1) || p.rooms[0];
  let r = workerApply(p, [{ op: 'setProps', args: { id: room.id, set: { floorColor: '#33AA66', ceilingColor: '#eeeeee' } } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(byId(r.plan, room.id).floorColor, '#33aa66');
  assert.equal(byId(r.plan, room.id).ceilingColor, '#eeeeee');
  r = workerApply(r.plan, [{ op: 'setProps', args: { id: room.id, set: { floorColor: '' } } }]);
  assert.deepEqual(r.errors, []);
  assert.ok(!('floorColor' in byId(r.plan, room.id)), '"" で床の色の欄ごと外れる(パネルの「床カラー解除」と同じ)');
  r = workerApply(p, [{ op: 'setProps', args: { id: room.id, set: { floorColor: 'red' } } }]);
  assert.match(r.errors[0].message, /#rrggbb/);
  assert.equal(r.plan, p, '失敗したらプランは変わらない');
});

test('サッシの色と扉の仕上げは、パネルの選択肢だけ。対象でない扉には書けない', async () => {
  const { workerApply } = await load();
  const p = plan();
  const win = p.items.find((it) => it.type === 'window');
  const door = p.items.find((it) => it.type === 'door-swing');
  const slide = p.items.find((it) => it.type === 'door-slide-s');
  let r = workerApply(p, [{ op: 'setProps', args: { id: win.id, set: { sashColor: '#22252a' } } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(byId(r.plan, win.id).sashColor, '#22252a');
  r = workerApply(p, [{ op: 'setProps', args: { id: win.id, set: { sashColor: '#123456' } } }]);
  assert.deepEqual(r.errors[0].candidates, ['', '#9a9da1', '#22252a', '#f2f2f0']);
  r = workerApply(p, [{ op: 'setProps', args: { id: door.id, set: { doorFinish: 'bath-clear' } } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(byId(r.plan, door.id).doorFinish, 'bath-clear');
  r = workerApply(p, [{ op: 'setProps', args: { id: slide.id, set: { doorFinish: 'bath-clear' } } }]);
  assert.equal(r.errors.length, 1, '引き戸にはパネル仕上げの欄が無い');
});

test('家具の部位ごとの色・素材・艶: パネルと同じに今の値へ重ねる。無い部位・艶の無い部位は候補つきで断る', async () => {
  const { workerApply } = await load();
  const p = plan();
  // 木部と張地の両方を持つ家具を、プランの中から探す
  const it = p.items.find((x) => (furniture.fc[x.type] || []).includes('wood') && (furniture.fc[x.type] || []).includes('fabric'));
  assert.ok(it, '木部と張地のある家具が凍結間取りに無い');
  const channels = furniture.fc[it.type];
  let r = workerApply(p, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { wood: '#5A3A22' } } } }]);
  assert.deepEqual(r.errors, []);
  r = workerApply(r.plan, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { fabric: '#223344' }, finishTextures: { wood: 'wood_oak' }, finishRoughness: { wood: '0.22' } } } }]);
  assert.deepEqual(r.errors, []);
  const got = byId(r.plan, it.id);
  assert.deepEqual(got.finishColors, { wood: '#5a3a22', fabric: '#223344' }, '前に変えた部位の色が残る');
  assert.deepEqual(got.finishTextures, { wood: 'wood_oak' });
  assert.deepEqual(got.finishRoughness, { wood: 0.22 }, '艶は数で書く(パネルと同じ)');
  r = workerApply(r.plan, [{ op: 'setProps', args: { id: it.id, set: { finishTextures: { wood: '' }, finishRoughness: { wood: '' } } } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(byId(r.plan, it.id).finishTextures, null, '部位を外して空になったら null(パネルと同じ)');
  assert.equal(byId(r.plan, it.id).finishRoughness, null);
  r = workerApply(p, [{ op: 'setProps', args: { id: it.id, set: { finishRoughness: { fabric: '0.22' } } } }]);
  assert.match(r.errors[0].message, /艶の設定がありません/);
  assert.ok(!r.errors[0].candidates.includes('fabric'));
  r = workerApply(p, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { leg: '#000000' } } } }]);
  assert.deepEqual(r.errors[0].candidates, channels);
  r = workerApply(p, [{ op: 'setProps', args: { id: it.id, set: { finishTextures: { wood: 'roof_tile' } } } }]);
  assert.ok(r.errors[0].candidates.includes('wood_oak'), '家具の部位に屋根材は貼れない');
  // ロックされた物は変えない
  const q = plan();
  byId(q, it.id).locked = true;
  r = workerApply(q, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { wood: '#000000' } } } }]);
  assert.match(r.errors[0].message, /ロック/);
});

test('一括差し替え: 2階建ての家具を洋館へ。名前でも引け、もう一度呼んでも変わらない', async () => {
  const { workerApply } = await load();
  const p = plan();
  const before = JSON.stringify(p);
  const r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(JSON.stringify(p), before, '渡したプランは変わらない');
  const swapped = r.plan.items.filter((it) => /^rpg-mansion-/.test(it.type));
  assert.ok(swapped.length >= 40, '洋館の物に替わった数 ' + swapped.length);
  // 替えた物は元の中心・向き・階・大きさのまま
  const keep = new Map(p.items.map((it) => [String(it.id), it]));
  swapped.filter((it) => keep.has(String(it.id))).forEach((it) => {
    const o = keep.get(String(it.id));
    assert.equal(it.x + it.w / 2, o.x + o.w / 2); assert.equal(it.y + it.d / 2, o.y + o.d / 2);
    assert.equal(it.rot, o.rot); assert.equal(it.floor, o.floor);
  });
  assert.ok(r.warnings.some((w) => /そのまま残した物/.test(w)), '替えられない物は warnings に理由');
  const byName = workerApply(p, [{ op: 'swapAssetSet', args: { set: '洋館' } }]);
  assert.equal(JSON.stringify(byName.plan), JSON.stringify(r.plan), 'セットの名前でも同じ');
  const again = workerApply(r.plan, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }]);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.changedIds, [], 'もう一度呼んでも変わらない');
});

test('一括差し替え: ロックされた物は替えない。名指しすると失敗。ids・except で選べる', async () => {
  const { workerApply } = await load();
  const p = plan();
  const sofa = p.items.find((it) => /Sofa/.test(it.type));
  sofa.locked = true;
  let r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(JSON.stringify(byId(r.plan, sofa.id)), JSON.stringify(sofa), 'ロックしたソファはそのまま');
  r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [sofa.id] } }]);
  assert.match(r.errors[0].message, /ロック/);
  assert.equal(r.plan, p);
  const q = plan();
  const chair = q.items.find((it) => /Chair/i.test(it.type) && !/Sofa/.test(it.type));
  r = workerApply(q, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [String(chair.id)] } }]);
  assert.deepEqual(r.errors, []);
  assert.ok(/^rpg-mansion-/.test(byId(r.plan, chair.id).type), '名指しした椅子は替わる');
  const others = r.plan.items.filter((it) => String(it.id) !== String(chair.id) && /^rpg-mansion-/.test(it.type));
  assert.deepEqual(others.map((it) => it.id), [], '名指ししなかった物は替わらない');
  r = workerApply(q, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', except: [chair.id] } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(byId(r.plan, chair.id).type, chair.type, 'except の物は替わらない');
  r = workerApply(q, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [999999] } }]);
  assert.match(r.errors[0].message, /置いてある物の中にありません/);
});

test('一括差し替え: 知らないセットは、使えるセットを候補にして失敗する', async () => {
  const { workerApply } = await load();
  const p = plan();
  const r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'ゴシック' } }]);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0].candidates, furniture.sets.map((s) => s.id));
  assert.match(r.errors[0].message, /洋館/);
  assert.equal(r.plan, p);
});

test('道具の定義と、AI に見せる語彙に新しい操作と項目が出る', () => {
  assert.ok(Catalog.OPERATIONS.some((o) => o.name === 'swapAssetSet'));
  assert.deepEqual(Catalog.checkArgs('swapAssetSet', { set: 'rpg-mansion', ids: ['12', 13] }), { ok: true, errors: [] });
  assert.equal(Catalog.checkArgs('swapAssetSet', { ids: [] }).ok, false);
  const vocab = Catalog.describeVocabulary({ settable: PlanSettable, knowledge: Knowledge, assetSets: furniture.sets });
  for (const k of EDIT_ONLY) assert.ok(vocab.includes(k + '（'), '語彙に ' + k);
  assert.match(vocab, /swapAssetSet の set/);
  furniture.sets.forEach((s) => assert.ok(vocab.includes(s.id + ' = ' + s.name), s.id));
  const tool = Catalog.toClaudeTools({ settable: PlanSettable, knowledge: Knowledge, assetSets: furniture.sets }).find((t) => t.name === 'swapAssetSet');
  assert.match(tool.description, /rpg-mansion（洋館）/);
  const setProps = Catalog.toClaudeTools({ settable: PlanSettable, knowledge: Knowledge }).find((t) => t.name === 'setProps');
  assert.match(setProps.description, /finishColors/);
});

// 外の AI(MCP)は共同編集のルームの /op から当てる。ルームの検査(誤りが増えないか・共有しない欄を変えないか)を通って積まれること。
test('MCP の経路(ルームの /op): 家具の色と一括差し替えが積まれる。知らないセットは候補つきで失敗する', async () => {
  const { makeEnv } = require('./collab-room-fakes.cjs');
  const rooms = await import(pathToFileURL(path.join(ROOT, 'worker', 'routes-rooms.mjs')).href);
  const env = await makeEnv();
  const p = plan();
  const bed = p.items.find((it) => (furniture.fc[it.type] || []).includes('wood'));
  const made = await rooms.createRoomWithPlan(env, p, 'https://cad-planner.example.test');
  const get = async () => (await env.ROOMS.get(env.ROOMS.idFromName(made.roomId)).fetch('https://room/plan')).json();
  let res = await rooms.roomOp(env, made.roomId, 'setProps', { id: String(bed.id), set: { finishColors: { wood: '#112233' } } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual((await get()).items.find((it) => it.id === bed.id).finishColors, { wood: '#112233' });
  res = await rooms.roomOp(env, made.roomId, 'swapAssetSet', { set: '洋館' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok((await get()).items.filter((it) => /^rpg-mansion-/.test(it.type)).length >= 40);
  res = await rooms.roomOp(env, made.roomId, 'swapAssetSet', { set: 'gothic' });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors[0].candidates, ['rpg-mansion', 'kominka']);
});

test('カラー設定(setAppearance): 家全体と階の色・素材・屋根の質感。外観は印を付けてから書く。知らない値は候補つきで失敗', async () => {
  const { workerApply } = await load();
  const p = plan();
  let r = workerApply(p, [{ op: 'setAppearance', args: { part: 'exterior', color: '#33AA55', texture: 'siding' } }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([r.plan.exteriorWallSettings.whole.linked, r.plan.exteriorWallSettings.whole.color, r.plan.exteriorWallSettings.whole.texture], [true, '#33aa55', 'siding']);
  r = workerApply(p, [{ op: 'setAppearance', args: { part: 'exterior', floor: 2, color: '#223344' } }]);
  assert.deepEqual([r.plan.exteriorWallSettings.whole.linked, r.plan.exteriorWallSettings.floors[2].linked, r.plan.exteriorWallSettings.floors[2].color], [false, true, '#223344']);
  r = workerApply(p, [{ op: 'setAppearance', args: { part: 'interior', floor: 1, texture: 'kominka_juraku' } }]);
  assert.deepEqual([r.plan.interiorWallSettings.whole.linked, r.plan.interiorWallSettings.floors[1].linked, r.plan.interiorWallSettings.floors[1].texture], [false, true, 'kominka_juraku']);
  r = workerApply(p, [{ op: 'setAppearance', args: { part: 'roof', sheen: 'metal' } }]);
  assert.equal(r.plan.roofAppearance.whole.sheen, 'metal');
  r = workerApply(r.plan, [{ op: 'setAppearance', args: { part: 'roof', sheen: '' } }]);
  assert.ok(!('sheen' in r.plan.roofAppearance.whole), '"" で質感の欄ごと外す(設定欄と同じ)');
  for (const [args, re] of [[{ part: 'roof', texture: 'siding' }, /屋根の素材にありません/], [{ part: 'interior', sheen: 'metal' }, /屋根\(part=roof\)だけ/],
    [{ part: 'wall', color: '#000000' }, /interior・exterior・roof/], [{ part: 'roof', floor: 5, color: '#000000' }, /1〜4/], [{ part: 'roof' }, /どれかを渡して/]]) {
    const e = workerApply(p, [{ op: 'setAppearance', args }]);
    assert.match(e.errors[0].message, re, JSON.stringify(args));
    assert.equal(e.plan, p);
  }
});

test('建物の様式(applyBuildingStyle): Worker は理由つきで断る。知らない名前は候補つきで失敗する', async () => {
  const { workerApply } = await load();
  const p = plan();
  let r = workerApply(p, [{ op: 'applyBuildingStyle', args: { set: '洋館' } }]);
  assert.match(r.errors[0].message, /^この操作は house-planner の画面で行ってください\(建物の様式/);
  assert.equal(r.plan, p);
  r = workerApply(p, [{ op: 'applyBuildingStyle', args: { set: 'ゴシック' } }]);
  assert.deepEqual(r.errors[0].candidates, ['rpg-mansion', 'kominka']);
  r = workerApply(p, [{ op: 'applyBuildingStyle', args: { set: 'kominka', parts: ['roof', 'roofs'] } }]);
  assert.match(r.errors[0].message, /roofs/);
  const vocab = Catalog.describeVocabulary({ settable: PlanSettable, knowledge: Knowledge, assetSets: furniture.sets });
  assert.match(vocab, /applyBuildingStyle の set/);
  assert.match(vocab, /setAppearance の texture/);
  assert.match(vocab, /mansion_brick_red=/);
});

// 2026-11-26 の独立レビューで見つかった場面(台だけを選ぶと上の物が二重に残る、家具でない物を選んでも理由が返らない)。
test('一括差し替え: 洗面台だけを選ぶと、上の洗面ボウルも一緒に外す。ボウルがロック・除く物なら台ごと残す', async () => {
  const { workerApply } = await load();
  const p = plan();
  const vanity = p.items.find((it) => it.type === 'fmp-BathroomVanity07');
  const bowl = p.items.find((it) => it.type === 'fmp-WashBasin01');
  assert.ok(vanity && bowl, '凍結間取りに洗面台と洗面ボウルがある');
  let r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [String(vanity.id)] } }]);
  assert.deepEqual(r.errors, []);
  assert.ok(/^rpg-mansion-/.test(byId(r.plan, vanity.id).type), '洗面台は替わる');
  assert.equal(byId(r.plan, bowl.id), undefined, '上の洗面ボウルは一緒に外れる(全部を替えたときと同じ)');
  assert.ok(r.removedIds.includes(bowl.id));
  assert.ok(r.warnings.some((w) => w.includes('id ' + bowl.id) && /一緒に外しました/.test(w)), JSON.stringify(r.warnings));
  const all = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }]);
  assert.equal(JSON.stringify(byId(all.plan, vanity.id)), JSON.stringify(byId(r.plan, vanity.id)), '全部を替えたときと同じ洗面台');
  // ボウルを除く・ロックすると、台ごと替えずに残す(浮いた物・二重の物を作らない)
  for (const [label, args, prep] of [['除く', { set: 'rpg-mansion', ids: [String(vanity.id)], except: [String(bowl.id)] }, null],
    ['ロック', { set: 'rpg-mansion', ids: [String(vanity.id)] }, (q) => { byId(q, bowl.id).locked = true; }]]) {
    const q = plan();
    if (prep) prep(q);
    r = workerApply(q, [{ op: 'swapAssetSet', args }]);
    assert.deepEqual(r.errors, [], label);
    assert.equal(byId(r.plan, vanity.id).type, vanity.type, label + ': 洗面台は替えない');
    assert.equal(JSON.stringify(byId(r.plan, bowl.id)), JSON.stringify(byId(q, bowl.id)), label + ': ボウルもそのまま');
    assert.ok(r.warnings.some((w) => w.includes('id ' + bowl.id) && /台だけを替えられない/.test(w)), label + ' ' + JSON.stringify(r.warnings));
  }
});

test('一括差し替え: 家具でない物を選ぶと、その id と理由を warnings に書く。空の ids・両方に書いた id・壁の id は失敗', async () => {
  const { workerApply } = await load();
  const p = plan();
  const win = p.items.find((it) => it.type === 'window');
  const chair = p.items.find((it) => /Chair/i.test(it.type) && !/Sofa/.test(it.type));
  let r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [String(win.id), String(chair.id)] } }]);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('id ' + win.id) && /家具ではない/.test(w)), JSON.stringify(r.warnings));
  for (const [args, re] of [[{ set: 'rpg-mansion', ids: [] }, /ids が空です/], [{ set: 'rpg-mansion', ids: [String(chair.id)], except: [chair.id] }, /両方にあります/],
    [{ set: 'rpg-mansion', ids: [String(p.walls[0].id)] }, /壁・部屋は選べず/], [{ set: 'x'.repeat(5000) }, /…」はありません/]]) {
    r = workerApply(p, [{ op: 'swapAssetSet', args }]);
    assert.match(r.errors[0].message, re, JSON.stringify(args).slice(0, 80));
    assert.ok(r.errors[0].message.length < 300, '失敗文に送った値を丸ごと写さない');
  }
});

test('家具の部位の色は "" で既定に戻せる。全部の部位を戻すと欄ごと null(パネルの「素材の色を元に戻す」と同じ形)', async () => {
  const { workerApply } = await load();
  const p = plan();
  const it = p.items.find((x) => (furniture.fc[x.type] || []).includes('wood') && (furniture.fc[x.type] || []).includes('fabric'));
  let r = workerApply(p, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { wood: '#112233', fabric: '#445566' } } } }]);
  r = workerApply(r.plan, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { wood: '' } } } }]);
  assert.deepEqual(byId(r.plan, it.id).finishColors, { fabric: '#445566' });
  r = workerApply(r.plan, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { fabric: '' } } } }]);
  assert.equal(byId(r.plan, it.id).finishColors, null);
  r = workerApply(p, [{ op: 'setProps', args: { id: it.id, set: { finishColors: { wood: 'y'.repeat(100000) } } } }]);
  assert.ok(r.errors[0].message.length < 400, '失敗文に送った値を丸ごと写さない: ' + r.errors[0].message.length);
});

test('一括差し替え: 洗面ボウルだけを選ぶと、替えずに「台 id を一緒に選んでください」と返す(元の洗面台の上に二重に載せない)', async () => {
  const { workerApply } = await load();
  const p = plan();
  const vanity = p.items.find((it) => it.type === 'fmp-BathroomVanity07');
  const bowl = p.items.find((it) => it.type === 'fmp-WashBasin01');
  const r = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [String(bowl.id)] } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(JSON.stringify(byId(r.plan, bowl.id)), JSON.stringify(bowl), 'ボウルはそのまま');
  assert.equal(JSON.stringify(byId(r.plan, vanity.id)), JSON.stringify(vanity), '洗面台もそのまま');
  assert.ok(r.warnings.some((w) => w.includes('台 id ' + vanity.id + ' を一緒に選んでください')), JSON.stringify(r.warnings));
  const both = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [String(bowl.id), String(vanity.id)] } }]);
  assert.ok(/^rpg-mansion-/.test(byId(both.plan, vanity.id).type), '両方を選べば替わる');
});

test('カラー設定: 結果に変わった設定(changedSettings)を載せる。階を書いて家全体が切れたら知らせる。無い階は失敗', async () => {
  const { workerApply } = await load();
  const p = plan();
  let r = workerApply(p, [{ op: 'setAppearance', args: { part: 'interior', color: '#123456' } }]);
  assert.deepEqual(r.changedSettings, ['内観（壁紙）の家全体']);
  r = workerApply(r.plan, [{ op: 'setAppearance', args: { part: 'interior', floor: 2, color: '#654321' } }]);
  assert.deepEqual(r.changedSettings, ['内観（壁紙）の2階']);
  assert.ok(r.warnings.some((w) => /家全体の設定をやめて階ごとの設定にしました/.test(w)), JSON.stringify(r.warnings));
  const same = workerApply(r.plan, [{ op: 'setAppearance', args: { part: 'interior', floor: 2, color: '#654321' } }]);
  assert.equal(same.changedSettings, undefined, '同じ値なら変わった設定は無い');
  r = workerApply(p, [{ op: 'setAppearance', args: { part: 'roof', floor: 4, color: '#000000' } }]);
  assert.match(r.errors[0].message, /4 階はありません\(ある階: 1・2/);
  const style = workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }]);
  assert.equal(style.changedSettings, undefined, '設定表を変えない操作の結果の形は今までどおり');
});

