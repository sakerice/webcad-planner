// plan-core/progress.js(段階ごとの出来具合)の単体テスト。
// 空のプラン → 床だけ → 壁まで → 屋根まで → 扉・窓まで と、既定の2階建てプランで数える。
// 段階は plan-core/operations.js の操作で作る(AI が作るのと同じ物)。
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../../assets/js/plan-core/operations.js');
const P = require('../../assets/js/plan-core/progress.js');

function makeCtx() {
  let n = 100;
  return {
    newId: () => ++n,
    catalog: {
      known: () => true, resolveType: (t) => t,
      defaultSize: (t) => ({ 'door-front': { w: 900, d: 200 }, window: { w: 1690, d: 150 }, 'door-swing': { w: 780, d: 780 } }[t] || { w: 900, d: 900 }),
      defaultColor: () => undefined, model: () => null,
      is: (kind, t) => ({ windowLike: /^window/.test(t), doorLikeOpening: /^door-/.test(t), doorPanel: t === 'door-swing' }[kind] || false),
      canSetElevation: () => false, applyLightDefaults: () => {}, contextExteriorHeight: () => 6000, contextFloors: () => 2,
      constants: { rulerThickness: 60, walkRouteThickness: 50, walkDefaultSpeed: 1.2 },
    },
    plan: { wallHeightForFloor: () => 2400, floorRaiseForFloor: () => 0, foundationHeight: () => 0 },
  };
}
const ctx = makeCtx();
function apply(plan, ops) {
  const r = O.applyOperations(plan, ops, ctx);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  return r.plan;
}
const KIND = { 'fmp-Toilet': 'toilet', 'fmp-Bath': 'bathtub', 'fmp-Sofa': 'sofa', 'fmp-Bed': 'bed' };
const kindOf = (t) => KIND[t] || null;

const empty = { walls: [], rooms: [], items: [] };
const site = apply(empty, [
  { op: 'placeItem', args: { type: 'site-rect', x: 4000, y: 4000, w: 14000, d: 14000 } },
  { op: 'placeItem', args: { type: 'foundation', x: 4000, y: 2000, w: 8000, d: 4000 } },
]);
const floor = apply(site, [
  { op: 'addRoom', args: { name: 'LDK', floor: 1, x: 2500, y: 2000, w: 5000, d: 4000 } },
  { op: 'addRoom', args: { name: '玄関', floor: 1, x: 6500, y: 2000, w: 3000, d: 4000 } },
  { op: 'addRoom', args: { name: '洋室', floor: 2, x: 4000, y: 2000, w: 8000, d: 4000 } },
]);
const ids = floor.rooms.map((r) => r.id);
const walled = apply(floor, [{ op: 'addRoomWalls', args: { ids } }]);
const roofed = apply(walled, [{ op: 'addRoof', args: { floor: 2, shape: 'gable' } }]);
const opened = apply(roofed, [
  { op: 'placeOpening', args: { type: 'door-front', room: ids[1], side: 'S' } },
  { op: 'placeOpening', args: { type: 'door-swing', room: ids[0], to: ids[1] } },
  { op: 'placeOpening', args: { type: 'window', room: ids[0], side: 'S' } },
  { op: 'placeOpening', args: { type: 'window', room: ids[2], side: 'S' } },
]);

test('空のプラン: 何も無く、足りない最初の段階は敷地。住設と家具は分類が引けるときだけ数える', () => {
  const p = P.stageProgress(empty, { kindOf });
  assert.deepEqual([p.site, p.foundation, p.rooms, p.walls, p.roofs], [0, 0, 0, 0, 0]);
  assert.equal(p.topFloor, null);
  assert.equal(p.roofOverTop, null, '壁が無いので屋根が要るかは決まらない');
  assert.equal(p.exteriorDoors, null, '1階に部屋が無いので数えない');
  assert.deepEqual(p.fixtures, { toilet: 0, bath: 0, kitchen: 0, vanity: 0 });
  assert.equal(p.furniture, 0);
  assert.equal(P.nextStage(p), '敷地');
  assert.deepEqual(P.progressIssues(p), [], '空のプランに指摘は出さない');
  const noKind = P.stageProgress(empty);
  assert.equal(noKind.fixtures, null);
  assert.ok(!P.progressLines(noKind).some((l) => /住設|家具/.test(l)), '分類が引けないのに住設・家具を書いた');
});

test('床だけ: 部屋は全部「壁で囲まれていない」。足りない段階は壁', () => {
  const p = P.stageProgress(floor);
  assert.deepEqual([p.site, p.foundation, p.rooms, p.walls], [1, 1, 3, 0]);
  assert.deepEqual(p.roomsPerFloor, { 1: 2, 2: 1 });
  assert.deepEqual(p.unwalled.map((r) => r.id).sort(), ids.slice().sort());
  assert.equal(P.nextStage(p), '壁');
  assert.equal(p.exteriorDoors, 0);
  assert.deepEqual(P.progressIssues(p).filter((t) => /外へ出る扉/.test(t)), [], '壁が無いうちは扉の指摘をしない');
  assert.equal(P.progressIssues(p).filter((t) => /壁で囲まれていません/.test(t)).length, 3);
});

test('壁まで: 囲まれていない部屋 0。屋根なし・外に出る扉なし・窓の無い居室を指摘する', () => {
  const p = P.stageProgress(walled);
  assert.deepEqual(p.unwalled, []);
  assert.equal(p.topFloor, 2);
  assert.equal(p.roofOverTop, false);
  assert.equal(P.nextStage(p), '屋根');
  const issues = P.progressIssues(p);
  assert.ok(issues.includes('2階の上に屋根がありません'));
  assert.ok(issues.includes('1階に外へ出る扉（玄関ドアなど）がありません'));
  assert.deepEqual(p.windowless.map((r) => r.name).sort(), ['LDK', '洋室'], '玄関は居室でない');
});

test('屋根まで → 扉・窓まで: 屋根の指摘が消え、外に出る扉 1、窓の無い居室 0。家具が無ければ次は家財', () => {
  const r = P.stageProgress(roofed);
  assert.equal(r.roofOverTop, true);
  assert.equal(P.nextStage(r), 'ドア・窓');
  const p = P.stageProgress(opened, { kindOf });
  assert.equal(p.exteriorDoors, 1, '部屋のあいだの扉は外に出る扉に数えない');
  assert.deepEqual(p.windowless, []);
  assert.deepEqual(P.progressIssues(p), []);
  assert.equal(P.nextStage(p), '住設');
  const furnished = { ...opened, items: opened.items.concat([
    { id: 900, type: 'fmp-Toilet', x: 0, y: 0, w: 400, d: 700, floor: 1 }, { id: 901, type: 'fmp-Bath', x: 0, y: 0, w: 1600, d: 800, floor: 1 },
    { id: 902, type: 'fmp-Sofa', x: 0, y: 0, w: 1800, d: 900, floor: 1 }] ) };
  const f = P.stageProgress(furnished, { kindOf });
  assert.deepEqual(f.fixtures, { toilet: 1, bath: 1, kitchen: 0, vanity: 0 });
  assert.equal(f.furniture, 1);
});

// 既定の2階建てプランは、凍結した写し(tools/tests/fixtures/house-2f.json)で見る(fixture-only.test.cjs の決まり)。
test('既定の2階建てプラン: 壁で囲まれていない部屋 0、屋根あり、外に出る扉あり。LDK とリビングは壁なしでつながる1つの空間として見る', () => {
  for (const file of ['./fixtures/house-2f.json']) {
    const plan = require(file);
    const p = P.stageProgress(plan);
    assert.deepEqual(p.unwalled, [], file);
    assert.equal(p.roofOverTop, true, file);
    assert.ok(p.exteriorDoors >= 1, file);
    const issues = P.progressIssues(p);
    // 凍結間取りの2階の書斎は本当に窓が無い(tools/lint_plan.py も「居室の窓の数」で同じ部屋を指す)。それ以外の指摘は出ない
    assert.deepEqual(issues, ['居室「書斎」(id=r1088、2階)に、外に面した窓がありません'], file);
  }
});

test('点検(inspect_plan)に段階の不足が指摘として入る(壁で囲まれていない部屋・外に出る扉・屋根・窓の無い居室)', () => {
  const Inspect = require('../../assets/js/plan-core/inspect.js');
  const f = Inspect.inspectPlan(floor);
  assert.equal(f.warnings.filter((w) => /壁で囲まれていません/.test(w)).length, 3);
  const w = Inspect.inspectPlan(walled);
  for (const re of [/2階の上に屋根がありません/, /外へ出る扉/, /居室「LDK」/]) assert.ok(w.warnings.some((t) => re.test(t)), String(re));
  const o = Inspect.inspectPlan(opened);
  assert.ok(!o.warnings.some((t) => /屋根がありません|外へ出る扉|外に面した窓|壁で囲まれていません/.test(t)), JSON.stringify(o.warnings));
});

test('Worker の要約(MCP の get_plan・チャットと同じ形)に進み具合の行が入り、点検にも指摘が入る', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const W = await import(pathToFileURL(path.join(__dirname, '../../worker/plan-ctx.mjs')).href);
  const text = W.workerSummarize(walled);
  assert.match(text, /進み具合（プランから数えた値）:/);
  assert.match(text, /- 次の段階の目安: 屋根/);
  assert.match(text, /住設 トイレ 0/, 'Worker は分類の表があるので住設を数える');
  assert.ok(W.workerInspect(walled).warnings.includes('2階の上に屋根がありません'));
});

test('次に勧める段階は、出来ているいちばん先の段階の次。それより前に抜けた段階は「まだ無い段階」として別に書く', () => {
  // 敷地・基礎が無いまま部屋と壁を作ったプラン: 次は屋根(敷地に戻らない)。敷地と基礎は抜けとして書く
  const noSite = apply(empty, [
    { op: 'addRoom', args: { name: 'LDK', floor: 1, x: 2500, y: 2000, w: 5000, d: 4000 } },
  ]);
  const w = apply(noSite, [{ op: 'addRoomWalls', args: { ids: [noSite.rooms[0].id] } }]);
  const p = P.stageProgress(w);
  assert.equal(P.nextStage(p), '屋根');
  assert.deepEqual(P.missingStages(p), ['敷地', '基礎', '屋根', 'ドア・窓']);
  const lines = P.progressLines(p);
  assert.ok(lines.includes('- 次の段階の目安: 屋根'), lines.join('\n'));
  assert.ok(lines.includes('- まだ無い段階: 敷地・基礎・屋根・ドア・窓'), lines.join('\n'));
  // 床だけ(敷地なし): 次は壁
  assert.equal(P.nextStage(P.stageProgress(noSite)), '壁');
  // 空: 敷地。全部あれば null
  assert.equal(P.nextStage(P.stageProgress(empty)), '敷地');
});

test('要約の行: 数と足りない最初の段階を書き、開発の都合の言葉を書かない', () => {
  const lines = P.progressLines(P.stageProgress(walled));
  assert.equal(lines[0], '進み具合（プランから数えた値）:');
  assert.ok(lines.some((l) => l.includes('屋根 0（2階の上に屋根なし）')));
  assert.ok(lines.some((l) => l === '- 次の段階の目安: 屋根'));
  assert.ok(!lines.join('\n').match(/トークン|費用|点数|\$/));
});
