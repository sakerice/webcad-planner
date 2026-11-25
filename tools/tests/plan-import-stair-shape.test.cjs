// 読み取りが作った階段の保存の形は、設定パネル・AI の set で作った階段と同じ。
//
// 階段の手すり「なし」・形「ひな壇」は既定で、パネルと AI の set(どちらも plan-core/operations.js の
// applyProp を通る)は欄ごと消す。読み取りの取り込み(plan-import.js の toAppObjects)は、答えの set を
// そのまま書いていたので、stairRail:'none'・stairStyle:'open' が保存に残っていた。描画の結果は同じでも、
// 保存の形が経路で違うと、比べる検査・共同編集の差分・AI の inspect の答えが食い違う。
//
// ここでは、読み取りの答え → PlanFreeApply.toImportPlan → applyPlanImport の本物の経路で取り込み、
// パネルで同じ値を選んだ階段(applyProp)と、欄の有無と描画が読む値(stairRailSides・stairStyleOf)を比べる。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { topLevelFunction } = require('./ops-vm.cjs');

const JS = path.join(__dirname, '..', '..', 'assets', 'js');
global.self = global;
global.document = undefined;
global.PlanStructure = require(path.join(JS, 'plan-structure.js'));
global.PlanCoreFactories = require(path.join(JS, 'plan-core', 'factories.js'));
global.PlanCoreSnap = require(path.join(JS, 'plan-core', 'snap.js'));
global.PlanCoreOperations = require(path.join(JS, 'plan-core', 'operations.js'));
const PlanFreeApply = require(path.join(JS, 'plan-free-apply.js'));
require(path.join(JS, 'plan-import.js'));
global.document = {
  getElementById: () => ({ textContent: '', style: {}, disabled: false, classList: { add() {}, remove() {} } }),
};
global.confirm = () => true;
global.nextId = 1000;
global.mkWall = function (x1, y1, x2, y2, floor, thick) {
  return { id: global.nextId++, x1: x1, y1: y1, x2: x2, y2: y2, floor: floor || 1, thick: thick || 120 };
};
global.mkItem = function (type, x, y, rot, floor, w, d) {
  return { id: global.nextId++, type: type, x: x, y: y, rot: rot || 0, floor: floor || 1, w: w || 0, d: d || 0 };
};
global.getItemDefaultSize = function () { return { w: 910, d: 2730 }; };
global.newRoomFloorRaiseMm = function () { return 0; };
global.planCoreCtx = function () {
  return { newId: function () { return global.nextId++; }, plan: { floorRaiseForFloor: function () { return 0; } } };
};
global.isContextExteriorItemType = function () { return false; };

// 描画が読む関数は、画面の本文(app-constants.js)をそのまま動かす。
const draw = vm.createContext({});
vm.runInContext(['stairRailSides', 'stairStyleOf'].map(topLevelFunction).join('\n'), draw);
// vm の中で作った配列は別の Array なので、deepStrictEqual で比べられるようこちらの配列に写す。
const railOf = (it) => Array.from(vm.runInContext('stairRailSides', draw)(it));
const styleOf = (it) => vm.runInContext('stairStyleOf', draw)(it);

const BOX = [
  { x1: 0, y1: 0, x2: 6000, y2: 0 }, { x1: 6000, y1: 0, x2: 6000, y2: 6000 },
  { x1: 6000, y1: 6000, x2: 0, y2: 6000 }, { x1: 0, y1: 6000, x2: 0, y2: 0 },
];

// 読み取りの答え(短い指示の形)で、set を付けた階段を1つ取り込み、取り込まれた階段を返す。
function importStair(type, set) {
  const s = type === 'stair-corner'
    ? { type: 'stair-corner', x: 1000, y: 1000, width: 910, enter: 'S', exit: 'E', set: set }
    : { type: 'stair', x: 1000, y: 2000, width: 910, length: 2730, up: 'N', set: set };
  const read = PlanFreeApply.toImportPlan({ floors: [{ floor: 1, walls: BOX, rooms: [], openings: [], stairs: [s], roofs: [], objects: [] }] }, {});
  global.HISTORY = [];
  global._defaultPlanPending = true;
  global.DATA = { walls: [], rooms: [], items: [] };
  global.PlanImport.state.result = { plan: read };
  global.applyPlanImport('go');
  const got = global.DATA.items.filter((i) => i.type === type);
  assert.equal(got.length, 1, type + ' が1つ取り込まれていない');
  return got[0];
}

// 設定パネルで同じ値を選んだ階段。パネルは「なし」「ひな壇」を undefined で渡し、ほかは値をそのまま渡す
// (app-state.js の updateSelectedProp → applyProp)。
function panelStair(type, rail, style) {
  const it = global.mkItem(type, 0, 0, 0, 1, 910, 2730);
  const plan = { walls: [], rooms: [], items: [it] };
  PlanCoreOperations.applyProp(it, 'stairRail', rail === 'none' ? undefined : rail, plan, {});
  PlanCoreOperations.applyProp(it, 'stairStyle', style === 'open' ? undefined : style, plan, {});
  return it;
}

const SHAPE = (it) => ({ hasRail: Object.prototype.hasOwnProperty.call(it, 'stairRail'),
  hasStyle: Object.prototype.hasOwnProperty.call(it, 'stairStyle'), rail: railOf(it), style: styleOf(it) });

for (const type of ['stair', 'stair-corner']) {
  test(type + ': 読み取りの手すり=なし・形=ひな壇は欄を残さず、パネルで選んだ階段と同じ形', () => {
    const read = importStair(type, 'stairRail=none;stairStyle=open');
    assert.equal(Object.prototype.hasOwnProperty.call(read, 'stairRail'), false, '取り込みが stairRail=' + read.stairRail + ' を保存に残した');
    assert.equal(Object.prototype.hasOwnProperty.call(read, 'stairStyle'), false, '取り込みが stairStyle=' + read.stairStyle + ' を保存に残した');
    assert.deepEqual(railOf(read), [], '描画の手すりが無しにならない');
    assert.equal(styleOf(read), 'open', '描画の形がひな壇にならない');
    assert.deepEqual(SHAPE(read), SHAPE(panelStair(type, 'none', 'open')));
  });

  for (const [rail, style, sides] of [['left', 'box', ['left']], ['right', 'skeleton', ['right']], ['both', 'box', ['left', 'right']]]) {
    test(type + ': 読み取りの手すり=' + rail + '・形=' + style + 'は欄に残り、パネルで選んだ階段と同じ形', () => {
      const read = importStair(type, 'stairRail=' + rail + ';stairStyle=' + style);
      assert.equal(read.stairRail, rail);
      assert.equal(read.stairStyle, style);
      assert.deepEqual(railOf(read), sides);
      assert.equal(styleOf(read), style);
      assert.deepEqual(SHAPE(read), SHAPE(panelStair(type, rail, style)));
    });
  }
}

test('共通の整え方: 形を選んだら古い欄 stairUnder を消す(applyProp と同じ)', () => {
  const it = { type: 'stair', stairUnder: 'filled', stairStyle: 'open' };
  PlanCoreOperations.tidyStairProp(it, 'stairStyle');
  assert.equal('stairUnder' in it, false);
  assert.equal('stairStyle' in it, false);
  assert.equal(styleOf(it), 'open');
});
