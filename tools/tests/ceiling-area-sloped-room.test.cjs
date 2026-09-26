// 勾配天井の部屋の天井範囲(下げ天井・折り上げ天井)。
// 以前は勾配天井を宣言した部屋には一切置けなかった(「平天井の部屋内に配置して
// ください」)。LDK の西が陸屋根の下で平ら・東が片流れの勾配、という家で、
// 平らな所にも置けなかった(利用者の報告)。天井が平らな範囲には置けるようにし、
// 段差はその場の実際の天井面から測る(利用者の選択)。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', '..', 'assets', 'js', 'ceiling-designer.js'), 'utf8');
// LDK: x 0..9100。x<5430 は天井 3.85m で平ら、x>=5430 は勾配(北ほど高い)。
const ldk = { id: 'ldk', type: 'room', floor: 1, x: 0, y: 4550, w: 9100, d: 3640, n: 'LDK', ceiling: { type: 'sloped' } };
const flatRoom = { id: 'bath', type: 'room', floor: 1, x: 0, y: 0, w: 1820, d: 1820, n: '浴室' };
const ceilAt = (x, y) => (x < 5430 ? 3.85 : 5.27 - (y - 4550) / 3640 * 1.0);

function load() {
  const noop = function () {};
  const ctx = {
    window: {}, console, Math, Number, Infinity, Object, Array,
    DATA: { rooms: [ldk, flatRoom], items: [] }, ST: { floor: 1 }, U: 0.001,
    THREE: {},
    roomCeilingProfile: (r) => (r === ldk ? { source: 'roof' } : null),
    roomCeilingWorldYAtMm: (r, p, x, y) => ceilAt(x, y),
    roomHasCoverAbove: () => true, isObjectLocked: () => false,
    floorBaseY: () => 0.45, roomCeilingHeightM: (r) => (r === ldk ? 4.82 : 2.6),
    roomFloorTopY: () => 0.78, ceilingFinishThicknessM: () => 0,
    roomsOverlapInPlan: () => false, roofCoversPlanPoint: () => true,
    roofUndersideWorldYAt: () => 4.13, stairwellHolesForRoom: () => [], stairwellQuadsForFloor: () => [],
    isLightItemType: () => false,
    ILABELS: {}, document: { getElementById: () => ({ hidden: false, textContent: '', value: '' }) },
    // ceiling-designer.js が読み込み時に包み直す関数
    applyHandleDrag: noop, updateSelectedProp: noop, removeObjectRef: noop, delSel: noop,
    apply3DGizmoDrag: noop, stashCurrentCamera: noop, setView: noop, onFloorChange: noop,
    resetView: noop, setTool: noop, pasteCopiedObject: noop,
  };
  ctx.DATA.items.push({ type: 'roof', floor: 2 });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}
const area = (x, y, w, d, offset) => ({ id: 1, type: 'ceiling-area', floor: 1, x, y, w, d, rot: 0, offset });

test('勾配天井の部屋でも、天井が平らな範囲には下げ・折り上げを置ける', () => {
  const CD = load().window.CeilingDesigner;
  assert.equal(CD.validItem(area(1000, 5500, 2000, 1500, -150)), '');
  assert.equal(CD.validItem(area(1000, 5500, 2000, 1500, 150)), '');
});

test('勾配の上や、平らな所と勾配にまたがる範囲には置けない(理由が分かる文言で)', () => {
  const CD = load().window.CeilingDesigner;
  assert.match(CD.validItem(area(6500, 5500, 1500, 1500, -150)), /勾配の範囲には置けません/);
  assert.match(CD.validItem(area(4800, 5500, 1500, 1500, -150)), /勾配の範囲には置けません/);
});

test('平天井の部屋は従来どおり置ける', () => {
  const CD = load().window.CeilingDesigner;
  assert.equal(CD.validItem(area(200, 200, 800, 800, -150)), '');
});

test('勾配天井の部屋の天井範囲の器具は、その場の天井面から段差ぶん下(上)に付く', () => {
  const g = load();
  g.DATA.items.push(area(600, 5200, 1800, 1600, -200));
  const CD = g.window.CeilingDesigner;
  // 天井面 3.85 − 仕上げ床 0.78 = 3070、下げ 200 → 2870(部屋の天井高 4.82 からではない)
  assert.equal(CD.areaFinishElevationMm(ldk, 1500, 6000), 2870);
  assert.equal(CD.areaFinishElevationMm(ldk, 8000, 6000), null, '範囲の外は従来の式');
});

test('折り上げの上限は、その場の天井面から屋根の下面まで', () => {
  const CD = load().window.CeilingDesigner;
  // 屋根の下面 4.13 − 0.02(仕上げの残り) − 天井面 3.85 = 260mm(部屋の天井高 4.82 から測ると 0 になる)
  assert.equal(CD.raisingLimit(ldk, area(1000, 5500, 2000, 1500, 100)).mm, 260);
});
