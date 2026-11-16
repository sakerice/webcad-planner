// plan-core/inspect.js の単体テスト。既にある検査3つ(PlanSchema.validatePlan、
// PlanCheck.knowledgeWarnings、PlanStructure.floorsOverlap)を束ねた inspectPlan を見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../../assets/js/plan-core/inspect.js');

function housePlan() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
}

test('凍結間取り house-2f.json は ok', () => {
  const r = I.inspectPlan(housePlan());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
  assert.ok(Array.isArray(r.warnings));
});

test('壁の x1 を数として読めない文字にすると errors が1件以上', () => {
  const plan = housePlan();
  plan.walls[0].x1 = 'abc';
  const r = I.inspectPlan(plan);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
  assert.ok(r.errors.every((e) => typeof e === 'string'));
});

// PlanSchema は数として読める文字("100")を受ける作り(AI の出力に普通に混ざるため)。
// applyOperations の引数は文字の数を受けないので、両者の扱いは違う。今の動きを書き留めておく。
test('数として読める文字("100")は、今の PlanSchema では errors にならない', () => {
  const plan = housePlan();
  plan.walls[0].x1 = String(plan.walls[0].x1);
  assert.deepEqual(I.inspectPlan(plan).errors, []);
});

test('2階の壁を1階から離れた所へ全部動かすと、階の重なりの件が errors に入る', () => {
  const plan = housePlan();
  plan.walls.filter((w) => w.floor === 2).forEach((w) => { w.x1 += 100000; w.x2 += 100000; });
  const r = I.inspectPlan(plan);
  assert.equal(r.ok, false);
  const hit = r.errors.filter((e) => e.includes('2階') && e.includes('重な'));
  assert.equal(hit.length, 1, JSON.stringify(r.errors));
});

test('呼ぶ前後でプランは変わらない', () => {
  const plan = housePlan();
  plan.walls[0].x1 = 'abc';
  const before = JSON.stringify(plan);
  I.inspectPlan(plan);
  assert.equal(JSON.stringify(plan), before);
  const ok = housePlan();
  const before2 = JSON.stringify(ok);
  I.inspectPlan(ok);
  assert.equal(JSON.stringify(ok), before2);
});

test('deps に偽物を渡すとそれが使われる', () => {
  const calls = [];
  const deps = {
    schema: { validatePlan: (p, opts) => { calls.push(['schema', opts]); return { ok: false, errors: ['形の誤り'], warnings: ['形の注意'] }; } },
    check: { knowledgeWarnings: (p) => { calls.push(['check']); return ['知識の注意']; } },
    structure: { floorsOverlap: (walls) => { calls.push(['structure', walls]); return { ok: false, floors: [1, 3], detached: [3] }; } },
    knownItemTypes: new Set(['sofa']),
  };
  const plan = { walls: [{ id: 1 }], rooms: [], items: [] };
  const r = I.inspectPlan(plan, deps);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0], '形の誤り');
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors[1].includes('3階'));
  assert.deepEqual(r.warnings, ['形の注意', '知識の注意']);
  assert.deepEqual(calls.map((c) => c[0]), ['schema', 'check', 'structure']);
  assert.equal(calls[0][1].knownItemTypes, deps.knownItemTypes);
  assert.equal(calls[2][1], plan.walls, 'floorsOverlap には plan でなく walls を渡す');
});

test('errors が空なら ok は true(warnings があっても)', () => {
  const deps = {
    schema: { validatePlan: () => ({ ok: true, errors: [], warnings: ['壁が1本も無い'] }) },
    check: { knowledgeWarnings: () => [] },
    structure: { floorsOverlap: () => ({ ok: true, floors: [1] }) },
  };
  const r = I.inspectPlan({ walls: [], rooms: [], items: [] }, deps);
  assert.deepEqual(r, { ok: true, errors: [], warnings: ['壁が1本も無い'] });
});

test('壊れたプラン(walls が配列でない)でも投げずに errors を返す', () => {
  const r = I.inspectPlan({ walls: 'x', rooms: [], items: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
  const r2 = I.inspectPlan(null);
  assert.equal(r2.ok, false);
});

// ブラウザでは plan-core の <script> が検査3つより前に読まれる。読み込みの後に root へ
// 入った PlanSchema などを、呼んだ時点で引けること。
test('ブラウザの読み込み順(inspect.js が先)でも、呼んだ時点の root から引く', () => {
  const vm = require('node:vm');
  const root = {};
  root.self = root;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'assets/js/plan-core/inspect.js'), 'utf8'), root);
  assert.equal(typeof root.PlanCoreInspect.inspectPlan, 'function');
  root.PlanSchema = { validatePlan: () => ({ ok: true, errors: [], warnings: ['後から入った形の検査'] }) };
  root.PlanCheck = { knowledgeWarnings: () => ['後から入った知識の検査'] };
  root.PlanStructure = { floorsOverlap: () => ({ ok: true, floors: [1] }) };
  const r = root.PlanCoreInspect.inspectPlan({ walls: [], rooms: [], items: [] });
  assert.deepEqual(Array.from(r.warnings), ['後から入った形の検査', '後から入った知識の検査']);
});
