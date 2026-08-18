// Task 22: 天井の色とテクスチャ。
//
// この計画では grep のアサーションが未修正のコードに対して何度も通っている。
// なのでここでの検査は grep ではない。index.html から材質の関数・UIの関数を
// 波括弧の対応で切り出し、node:vm で**実際に走らせ**、
//
//   - 仕上げを持たない部屋では、天井の材質が今日と同じ**同一インスタンス**であること
//     （保存済みプランは全部これに当たる）
//   - 色を設定した部屋だけ材質が変わり、他の部屋は既定のままであること
//   - テクスチャが本当に map として乗り、繰り返しが部屋の寸法から出ること
//   - 反転(ceilingTextureFlipX/Y)が repeat/offset に効くこと
//   - 勾配天井の部屋にも同じ仕上げが乗ること
//   - PV採光の「描かないが影は落とす」分岐が仕上げより優先されること
//   - 欄を描いただけではプランに何も書かず、解除で受け口ごと消えること
//
// を測る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
// 間取りは凍結フィクスチャを読む。出荷する assets/default_plan.json を
// 直接読むと、既定間取りを良くするたびにここが落ちる(役割は tools/tests/fixtures/README.md)。
const PLAN = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));

// ── index.html からの切り出し（ceiling-ui.test.cjs と同じやり方）──────────
function scanBalanced(from) {
  let i = from, depth = 0, mode = null, started = false;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; started = true; continue; }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (started && depth === 0) return i;
      continue;
    }
    if (c === ';' && depth === 0 && started) return i;
  }
  throw new Error('閉じていない');
}
function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  const brace = html.indexOf('{', html.indexOf(')', start));
  return html.slice(start, scanBalanced(brace) + 1);
}
function topLevelVar(name) {
  const at = html.indexOf('\nvar ' + name + '=');
  const at2 = at === -1 ? html.indexOf('\nvar ' + name + ' =') : at;
  assert.notEqual(at2, -1, 'var ' + name + ' が index.html に無い');
  const eq = html.indexOf('=', at2);
  let i = eq + 1;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] === '{' || html[i] === '[' || html[i] === '(') {
    return html.slice(at2 + 1, scanBalanced(i) + 1) + ';';
  }
  const end = html.indexOf(';', i);
  return html.slice(at2 + 1, end + 1);
}

// ── 材質を読むためだけの最小 THREE ────────────────────────────────────────
// repeat / offset は本物と同じく「あとから set される値」なので、
// 実際に何が入ったかを読めるようにしておく。
function Vec2(x, y) {
  this.x = x; this.y = y;
  const self = this;
  this.set = function (a, b) { self.x = a; self.y = b; return self; };
}
function makeThree() {
  return {
    RepeatWrapping: 1000,
    DoubleSide: 2,
    MeshStandardMaterial: function (p) { return Object.assign({ kind: 'standard' }, p || {}); },
    MeshBasicMaterial: function (p) { return Object.assign({ kind: 'basic' }, p || {}); }
  };
}
// getTexture3D が返す「読み込み済みテクスチャ」の代わり。画像は 2:1。
function fakeTexture(key) {
  return { key: key, image: { width: 400, height: 200 }, repeat: new Vec2(1, 1), offset: new Vec2(0, 0), needsUpdate: false };
}

const MAT_FNS = [
  'textureImageAspect', 'setTextureRepeatNoDistort', 'applyTextureFlip',
  'appearanceWithTextureOrientation',
  'makeCeilingMaterial', 'resolveRoomCeilingAppearance', 'makeRoomCeilingMaterial'
];

function matCtx(opts) {
  const o = opts || {};
  const loaded = {};
  const ctx = vm.createContext({
    console: console, Math: Math, Number: Number, Object: Object,
    isFinite: isFinite, isNaN: isNaN,
    THREE: makeThree(),
    isInt: !!o.isInt,
    PV_INTERIOR_DAYLIGHT: o.daylight === undefined ? null : o.daylight,
    __loaded: loaded,
    // 読めない画像を模す: opts.missing に挙げた鍵だけ null を返す。
    getTexture3D: function (key) {
      if (!key || (o.missing || []).indexOf(key) !== -1) return null;
      loaded[key] = (loaded[key] || 0) + 1;
      return fakeTexture(key);
    },
    cloneRepeatReadyTexture: function (t) {
      if (!t) return null;
      return { key: t.key, image: t.image, repeat: new Vec2(1, 1), offset: new Vec2(0, 0), needsUpdate: false };
    }
  });
  vm.runInContext([topLevelVar('U'), topLevelVar('CEILING_TEXTURE_TILE_M'), topLevelVar('CEILING_DEFAULT_COLOR')]
    .concat(MAT_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

// 3.6m × 2.7m の部屋（畳6帖くらい）。
function room(extra) {
  return Object.assign({ id: 'rm1', type: 'room', floor: 1, x: 0, y: 0, w: 3600, d: 2700 }, extra || {});
}

// ── 1. 仕上げを持たない部屋は、今日と寸分違わない ────────────────────────
test('仕上げを持たない部屋には、既定の天井材質がそのまま同じインスタンスで渡る', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const got = ctx.makeRoomCeilingMaterial(room(), base);
  assert.equal(got, base, '指定の無い部屋に新しい材質が作られた（＝全戸の天井が変わる）');
  assert.equal(ctx.resolveRoomCeilingAppearance(room()), null);
});

test('既定プランの全部屋が「仕上げ無し」の枝を通る（既存の家の通り道）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  assert.ok(PLAN.rooms.length > 0, '既定プランに部屋が無い');
  PLAN.rooms.forEach(function (r) {
    assert.equal(ctx.resolveRoomCeilingAppearance(r), null, r.id + ' が仕上げの枝に入った');
    assert.equal(ctx.makeRoomCeilingMaterial(r, base), base, r.id);
  });
});

test('既定の天井材質そのものは、色も粗さも両面描画も今までどおり', () => {
  const ctx = matCtx();
  const m = ctx.makeCeilingMaterial();
  assert.equal(m.kind, 'standard');
  assert.equal(m.color, 0xf4f1ea);
  assert.equal(m.roughness, 0.96);
  assert.equal(m.metalness, 0);
  assert.equal(m.side, 2);
  assert.equal(m.map, undefined);
});

test('UIが名乗る既定色は、makeCeilingMaterial が実際に使う色と同じ', () => {
  const ctx = matCtx();
  const m = ctx.makeCeilingMaterial();
  assert.equal('#' + m.color.toString(16), ctx.CEILING_DEFAULT_COLOR,
    'UIの既定色 ' + ctx.CEILING_DEFAULT_COLOR + ' とレンダの既定色がズレている');
});

// ── 2. 色 ────────────────────────────────────────────────────────────────
test('天井カラーを設定すると、その色の材質になる（他は既定と同じ質感のまま）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const m = ctx.makeRoomCeilingMaterial(room({ ceilingColor: '#8b3a2f' }), base);
  assert.notEqual(m, base, '色を設定したのに既定の材質が返った');
  assert.equal(m.color, '#8b3a2f');
  assert.equal(m.roughness, 0.96, '色を付けただけで粗さが変わった');
  assert.equal(m.metalness, 0);
  assert.equal(m.side, 2, '両面描画が落ちた（下から見上げると天井が消える）');
  assert.equal(m.map, undefined);
});

test('色を設定した部屋と設定していない部屋を取り違えない', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const painted = ctx.makeRoomCeilingMaterial(room({ id: 'a', ceilingColor: '#123456' }), base);
  const plain = ctx.makeRoomCeilingMaterial(room({ id: 'b' }), base);
  assert.equal(painted.color, '#123456');
  assert.equal(plain, base);
});

// ── 3. テクスチャ ────────────────────────────────────────────────────────
test('テクスチャを設定すると map が乗り、色は白（画像の色をそのまま出す）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const m = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'data:image/png;base64,AAA' }), base);
  assert.notEqual(m, base);
  assert.ok(m.map, 'map が付いていない');
  assert.equal(m.map.key, 'data:image/png;base64,AAA');
  assert.equal(m.color, 0xffffff);
  assert.equal(m.roughness, 0.96);
  assert.equal(m.side, 2);
  assert.equal(m.map.wrapS, 1000, 'RepeatWrapping になっていない（端が伸びる）');
  assert.equal(m.map.wrapT, 1000);
});

test('繰り返し回数は部屋の寸法と画像の縦横比から出る（引き伸ばさない）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const m = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'tex' }), base);
  // 部屋 3.6m × 2.7m、タイル高さ 0.9m、画像は 2:1。
  // 縦は 2.7/0.9=3 枚、横は 3.6/(0.9*2)=2 枚。
  assert.equal(ctx.CEILING_TEXTURE_TILE_M, 0.9, '床(0.9m)と違うタイル高さになっている');
  assert.ok(Math.abs(m.map.repeat.y - 3) < 1e-9, 'repeat.y=' + m.map.repeat.y);
  assert.ok(Math.abs(m.map.repeat.x - 2) < 1e-9, 'repeat.x=' + m.map.repeat.x);
  // 正方形の部屋なら縦横の枚数比が画像の比のとおりになる（=歪まない）。
  const sq = ctx.makeRoomCeilingMaterial(room({ w: 2700, d: 2700, ceilingTexture: 'tex' }), base);
  assert.ok(Math.abs(sq.map.repeat.y / sq.map.repeat.x - 2) < 1e-9, '正方形の部屋で画像が歪む');
});

test('左右・上下の反転が repeat と offset に効く（床と同じ扱い）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const plain = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'tex' }), base);
  assert.ok(plain.map.repeat.x > 0 && plain.map.repeat.y > 0);
  assert.equal(plain.map.offset.x, 0);
  assert.equal(plain.map.offset.y, 0);

  // 反転後の位置 u は、素の状態の 1-u と同じテクスチャ座標を指す（=鏡像）。
  // この部屋は横2枚・縦3枚のタイリングなので offset は 2 と 3 になる。
  // 以前ここは 1 を直に書いていたが、それは repeat が1枚のときにだけ成り立つ値だった
  // （繰り返しは整数枚なので、この部屋での見え方は以前と同じ）。
  const mirrors = (m, axis) => {
    const r = m.map.repeat[axis], o = m.map.offset[axis];
    const pr = plain.map.repeat[axis], po = plain.map.offset[axis];
    [0, 0.5, 1].forEach((u) => {
      assert.ok(Math.abs((o + r * u) - (po + pr * (1 - u))) < 1e-9,
        axis + ' の反転が鏡像になっていない: u=' + u);
    });
  };

  const flipX = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'tex', ceilingTextureFlipX: true }), base);
  assert.ok(flipX.map.repeat.x < 0, '左右反転が repeat.x に効いていない');
  mirrors(flipX, 'x');
  assert.ok(flipX.map.repeat.y > 0, '左右反転で上下まで反転している');
  assert.equal(flipX.map.offset.y, 0, '左右反転で上下の位置がずれている');

  const flipY = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'tex', ceilingTextureFlipY: true }), base);
  assert.ok(flipY.map.repeat.y < 0, '上下反転が repeat.y に効いていない');
  mirrors(flipY, 'y');
  assert.ok(flipY.map.repeat.x > 0);
  assert.equal(flipY.map.offset.x, 0);
});

test('反転のフィールド名は天井のもの（床の textureFlipX を巻き込まない）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  // 床のテクスチャを左右反転しているだけの部屋。天井は反転してはいけない。
  const m = ctx.makeRoomCeilingMaterial(
    room({ texture: 'floor', textureFlipX: true, ceilingTexture: 'tex' }), base);
  assert.ok(m.map.repeat.x > 0, '床の反転が天井に伝染している');
});

test('テクスチャと色を両方持つ部屋では、テクスチャが勝つ（床・壁と同じ規則）', () => {
  const ctx = matCtx();
  const base = ctx.makeCeilingMaterial();
  const m = ctx.makeRoomCeilingMaterial(room({ ceilingColor: '#8b3a2f', ceilingTexture: 'tex' }), base);
  assert.ok(m.map);
  assert.equal(m.color, 0xffffff);
});

test('画像が読めないときは色へ、色も無ければ既定へ落ちる（真っ黒にしない）', () => {
  const ctx = matCtx({ missing: ['broken'] });
  const base = ctx.makeCeilingMaterial();
  const withColor = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'broken', ceilingColor: '#445566' }), base);
  assert.equal(withColor.map, undefined);
  assert.equal(withColor.color, '#445566');
  const noColor = ctx.makeRoomCeilingMaterial(room({ ceilingTexture: 'broken' }), base);
  assert.equal(noColor, base, '画像が読めない部屋の天井が既定へ戻っていない');
});

// ── 4. PV採光のオクルーダーは仕上げより優先 ──────────────────────────────
test('PV採光の内観では、仕上げがあっても「描かないが影は落とす」材質のまま', () => {
  const ctx = matCtx({ isInt: true, daylight: { sunScale: 1 } });
  const base = ctx.makeCeilingMaterial();
  assert.equal(base.kind, 'basic');
  assert.equal(base.colorWrite, false);
  assert.equal(base.opacity, 0);
  [{ ceilingColor: '#ff0000' }, { ceilingTexture: 'tex' }, { ceilingColor: '#ff0000', ceilingTexture: 'tex' }]
    .forEach(function (extra) {
      const m = ctx.makeRoomCeilingMaterial(room(extra), base);
      assert.equal(m, base, '内観採光の天井に仕上げが乗ってしまった: ' + JSON.stringify(extra));
      assert.equal(m.colorWrite, false);
    });
});

test('外観では PV採光のスイッチが立っていても、仕上げは普通に乗る', () => {
  // isInt=false のときのオクルーダー分岐は元から働かない。
  const ctx = matCtx({ isInt: false, daylight: { sunScale: 1 } });
  const base = ctx.makeCeilingMaterial();
  assert.equal(base.kind, 'standard');
  const m = ctx.makeRoomCeilingMaterial(room({ ceilingColor: '#00ff00' }), base);
  assert.equal(m.color, '#00ff00');
});

// ── 5. buildRooms3D の配線（平らな天井にも勾配天井にも同じ仕上げ）─────────
// 天井メッシュが受け取る材質を、実際に buildRooms3D を走らせて読む。
const WIRE_FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomVoidTargetFloor', 'roomIsVoidCeiling', 'roomVoidCeilingMm', 'roomVoidFloorsAreOpen',
  'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'textureImageAspect', 'setTextureRepeatNoDistort', 'applyTextureFlip',
  'appearanceWithTextureOrientation', 'makeCeilingMaterial',
  'resolveRoomCeilingAppearance', 'makeRoomCeilingMaterial', 'buildRooms3D'
];
const WIRE_VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM',
  'CEILING_TEXTURE_TILE_M', 'CEILING_DEFAULT_COLOR'];

function builtCeilings(data, floor) {
  const got = [];
  const noop = function () { return { position: { set: function () {} }, userData: {} }; };
  const ctx = vm.createContext({
    console: console, HeightModel: HeightModel, DATA: data,
    Math: Math, Number: Number, Object: Object, Array: Array, JSON: JSON,
    isFinite: isFinite, isNaN: isNaN,
    ST: { view: '3d-ext', floor: floor },
    isInt: false, PV_INTERIOR_DAYLIGHT: null,
    LIGHT_SETTINGS: { room: 1, env: 0 },
    THREE: Object.assign(makeThree(), { Mesh: noop, PointLight: noop, CylinderGeometry: noop, Color: function () { return {}; } }),
    isWalkView: function () { return false; },
    isLightItemType: function () { return false; },
    makeRoomFloorMaterial: function () { return {}; },
    buildRoomFloorMeshes: function () { return { slab: {}, slabBody: null }; },
    buildRoomCeilingMesh: function (r, ceilY, mat, holes, profile) {
      got.push({ id: r.id, mat: mat, profile: profile || null });
      return {};
    },
    roomHasCoverAbove: function () { return true; },
    stairwellQuadsForFloor: function () { return []; },
    stairwellHolesForRoom: function () { return []; },
    mark3DSelectable: function () {},
    makeAutoLightFixtureMesh: noop,
    sc3: { add: function () {} },
    getTexture3D: function (k) { return k ? fakeTexture(k) : null; },
    cloneRepeatReadyTexture: function (t) {
      return t ? { key: t.key, image: t.image, repeat: new Vec2(1, 1), offset: new Vec2(0, 0) } : null;
    }
  });
  vm.runInContext(WIRE_VARS.map(topLevelVar).concat(WIRE_FNS.map(topLevelFunction)).join('\n'), ctx);
  ctx.buildRooms3D(floor);
  return got;
}

function twoRoomHouse(extraA, extraB) {
  return {
    floors: {},
    rooms: [
      Object.assign({ id: 'a', type: 'room', floor: 1, x: 0, y: 0, w: 3600, d: 2700 }, extraA || {}),
      Object.assign({ id: 'b', type: 'room', floor: 1, x: 4000, y: 0, w: 3600, d: 2700 }, extraB || {})
    ],
    walls: [], items: []
  };
}

test('仕上げを設定していない家では、天井の材質は全部屋で同じ1つ（今日と同じ）', () => {
  const got = builtCeilings(twoRoomHouse(), 1);
  assert.equal(got.length, 2, '天井が2枚作られていない');
  assert.equal(got[0].mat, got[1].mat, '指定が無いのに部屋ごとに材質が作られた');
  assert.equal(got[0].mat.color, 0xf4f1ea);
});

test('1部屋だけ色を変えると、その部屋の天井だけが変わる', () => {
  const got = builtCeilings(twoRoomHouse({ ceilingColor: '#2f5d8b' }), 1);
  assert.equal(got[0].id, 'a');
  assert.equal(got[0].mat.color, '#2f5d8b');
  assert.equal(got[1].id, 'b');
  assert.equal(got[1].mat.color, 0xf4f1ea, '触っていない部屋の天井まで変わった');
});

test('勾配天井の部屋にも同じ仕上げが乗る（平らだけの対応にしない）', () => {
  const sloped = { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 };
  const got = builtCeilings(twoRoomHouse(
    { ceiling: sloped, ceilingTexture: 'tex' },
    { ceiling: sloped, ceilingColor: '#8b3a2f' }), 1);
  // 勾配の枝を通っていること（profile が渡っている）を同時に確かめる
  assert.notEqual(got[0].profile, null, '勾配の枝を通っていない＝検査が意味を失っている');
  assert.notEqual(got[1].profile, null);
  assert.ok(got[0].mat.map, '勾配天井にテクスチャが乗っていない');
  assert.equal(got[1].mat.color, '#8b3a2f', '勾配天井に色が乗っていない');
});

// ── 6. UI ────────────────────────────────────────────────────────────────
const UI_FNS = [
  'normalizeTextureOrientationTarget', 'textureFlipControlsHtml',
  'selectedRoomCeilingFinishHtml', 'updateSelectedProp'
];

function uiCtx(data) {
  const log = { save: 0, draw: 0, rebuild: 0, props: 0 };
  const ctx = vm.createContext({
    console: console, DATA: data,
    Math: Math, Number: Number, Object: Object, Array: Array, JSON: JSON, String: String, RegExp: RegExp,
    isFinite: isFinite, isNaN: isNaN,
    ST: { selected: null },
    ren: true,
    __log: log,
    saveState: function () { log.save++; },
    draw2d: function () { log.draw++; },
    rebuild3D: function () { log.rebuild++; },
    updateProps: function () { log.props++; },
    isObjectLocked: function (o) { return !!(o && o.locked); },
    setObjectLocked: function () {},
    syncLockBatchUi: function () {},
    isAppearanceColorInputActive: function () { return false; },
    markAppearanceColorDirty: function () {},
    scheduleAppearancePreviewUpdate: function () {},
    isLightItemType: function () { return false; },
    isWindowLikeType: function () { return false; },
    normalizeWindowVerticalProps: function () {},
    getExteriorWallSetting: function () { return {}; },
    // 上に部屋も屋根も無い部屋かどうか。既定は「ある」= 注意書きを出さない。
    roomHasCoverAbove: function (r) { return !r.__uncovered; }
  });
  vm.runInContext([topLevelVar('CEILING_DEFAULT_COLOR')].concat(UI_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function select(ctx, r) { ctx.ST.selected = r; return r; }

test('欄を描いただけでは、部屋にフィールドが1つも増えない', () => {
  const data = { rooms: [room()] };
  const ctx = uiCtx(data);
  const before = JSON.stringify(data);
  const r = select(ctx, data.rooms[0]);
  const h = ctx.selectedRoomCeilingFinishHtml(r);
  assert.ok(h.indexOf('天井の仕上げ') !== -1, '天井の仕上げの欄が出ていない');
  assert.equal(JSON.stringify(data), before, '描いただけでプランが変わった');
  assert.equal(ctx.__log.save, 0, '描画だけで undo が積まれた');
});

test('未設定のときは既定色を出し、解除ボタンも反転ボタンも出さない', () => {
  const ctx = uiCtx({ rooms: [] });
  const h = ctx.selectedRoomCeilingFinishHtml(select(ctx, room()));
  assert.ok(h.indexOf('type="color" value="' + ctx.CEILING_DEFAULT_COLOR + '"') !== -1,
    '既定色が色欄に出ていない: ' + h);
  assert.equal(h.indexOf('天井カラー解除'), -1);
  assert.equal(h.indexOf('天井テクスチャ解除'), -1);
  assert.equal(h.indexOf('左右反転'), -1, 'テクスチャが無いのに反転ボタンが出ている');
  assert.ok(h.indexOf('未設定です。') !== -1, '未設定であることを言っていない');
});

test('欄の書き込み先は天井のフィールド（床や汎用カラーへ書かない）', () => {
  const ctx = uiCtx({ rooms: [] });
  const h = ctx.selectedRoomCeilingFinishHtml(
    select(ctx, room({ ceilingTexture: 'tex', ceilingColor: '#111111' })));
  assert.ok(h.indexOf('onchange="updateSelectedProp(\'ceilingColor\',this.value)"') !== -1,
    '色欄が ceilingColor へ書いていない: ' + h);
  assert.ok(h.indexOf('onchange="uploadRoomCeilingTex(this)"') !== -1,
    'テクスチャ欄が天井用の読み込みを呼んでいない: ' + h);
  assert.ok(h.indexOf('updateSelectedProp(\'ceilingTextureFlipX\'') !== -1,
    '左右反転が ceilingTextureFlipX へ書いていない: ' + h);
  assert.ok(h.indexOf('updateSelectedProp(\'ceilingTextureFlipY\'') !== -1,
    '上下反転が ceilingTextureFlipY へ書いていない: ' + h);
  assert.ok(h.indexOf('テクスチャを設定しているあいだ、天井カラーは効きません') !== -1,
    '色が効かなくなることを黙っている: ' + h);
});

test('天井面が外観3Dでしか見えないことを、その場で言う', () => {
  const ctx = uiCtx({ rooms: [] });
  const h = ctx.selectedRoomCeilingFinishHtml(select(ctx, room()));
  assert.ok(h.indexOf('外観3D') !== -1, '外観3Dでしか見えないことを言っていない');
  assert.ok(h.indexOf('内観3Dは天井を作りません') !== -1);
  assert.ok(h.indexOf('勾配天井にも同じ仕上げが乗ります') !== -1);
});

test('上に部屋も屋根も無い部屋では、天井面が作られないことを言う', () => {
  const ctx = uiCtx({ rooms: [] });
  const covered = ctx.selectedRoomCeilingFinishHtml(select(ctx, room()));
  assert.equal(covered.indexOf('天井面そのものが作られない'), -1,
    '天井がある部屋にまで「作られない」と言っている');
  const bare = ctx.selectedRoomCeilingFinishHtml(select(ctx, room({ __uncovered: true })));
  assert.ok(bare.indexOf('天井面そのものが作られない') !== -1,
    '天井が作られない部屋で黙っている: ' + bare);
});

test('色を設定すると ceilingColor だけが入り、解除で受け口ごと消える', () => {
  const data = { rooms: [room()] };
  const ctx = uiCtx(data);
  const before = JSON.stringify(data);
  const r = select(ctx, data.rooms[0]);

  ctx.updateSelectedProp('ceilingColor', '#8b3a2f');
  assert.equal(r.ceilingColor, '#8b3a2f');
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'ceilingTexture'), false);
  assert.equal(ctx.__log.save, 1, 'undo が積まれていない');
  assert.equal(ctx.__log.rebuild, 1, '3Dを描き直していない');

  const h = ctx.selectedRoomCeilingFinishHtml(r);
  assert.ok(h.indexOf('type="color" value="#8b3a2f"') !== -1, '設定した色が欄に出ていない');
  assert.ok(h.indexOf('天井カラー解除') !== -1, '解除ボタンが出ていない');

  ctx.updateSelectedProp('ceilingColor', null);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'ceilingColor'), false,
    '解除したのに ceilingColor キーが残っている');
  assert.equal(JSON.stringify(data), before, 'プランが元に戻っていない');
});

test('テクスチャを解除すると、反転のフィールドまで消える', () => {
  const data = { rooms: [room()] };
  const ctx = uiCtx(data);
  const before = JSON.stringify(data);
  const r = select(ctx, data.rooms[0]);

  ctx.updateSelectedProp('ceilingTexture', 'data:image/png;base64,AAA');
  ctx.updateSelectedProp('ceilingTextureFlipX', true);
  assert.equal(r.ceilingTextureFlipX, true);

  const h = ctx.selectedRoomCeilingFinishHtml(r);
  assert.ok(h.indexOf('天井テクスチャ解除') !== -1);
  assert.ok(h.indexOf('左右反転') !== -1, 'テクスチャがあるのに反転ボタンが出ていない');
  assert.ok(h.indexOf('class="pbtn sec active"') !== -1, '反転中であることが見えない');

  ctx.updateSelectedProp('ceilingTexture', null);
  ['ceilingTexture', 'ceilingTextureFlipX', 'ceilingTextureFlipY'].forEach(function (k) {
    assert.equal(Object.prototype.hasOwnProperty.call(r, k), false, k + ' が残っている');
  });
  assert.equal(JSON.stringify(data), before, 'プランが元に戻っていない');
});

test('床のテクスチャ欄と天井のテクスチャ欄は、別々の入れ物に書く', () => {
  const data = { rooms: [room()] };
  const ctx = uiCtx(data);
  const r = select(ctx, data.rooms[0]);
  ctx.updateSelectedProp('texture', 'floor-image');
  ctx.updateSelectedProp('ceilingTexture', 'ceiling-image');
  assert.equal(r.texture, 'floor-image', '天井の設定が床を上書きした');
  assert.equal(r.ceilingTexture, 'ceiling-image');
  ctx.updateSelectedProp('ceilingTexture', null);
  assert.equal(r.texture, 'floor-image', '天井を解除したら床のテクスチャまで消えた');
});

test('ロック中の部屋では天井の仕上げを変えられない', () => {
  const data = { rooms: [room({ locked: true })] };
  const ctx = uiCtx(data);
  const r = select(ctx, data.rooms[0]);
  const before = JSON.stringify(r);
  ctx.updateSelectedProp('ceilingColor', '#8b3a2f');
  ctx.updateSelectedProp('ceilingTexture', 'x');
  assert.equal(JSON.stringify(r), before, 'ロック中に天井の仕上げが書き換わった');
});

test('部屋以外を選んでいるときは、天井の仕上げの欄を出さない', () => {
  const ctx = uiCtx({ rooms: [] });
  const wall = { id: 1, type: 'wall', x1: 0, y1: 0, x2: 1000, y2: 0, thick: 120, floor: 1 };
  assert.equal(ctx.selectedRoomCeilingFinishHtml(wall), '');
});

// ── 7. 配線（欄が updateProps の部屋の枝から呼ばれていること）────────────
test('部屋のプロパティ欄から天井の仕上げの欄が呼ばれている', () => {
  assert.ok(html.indexOf('html += selectedRoomCeilingFinishHtml(it);') !== -1,
    'updateProps の部屋の枝に繋がっていない');
});

test('天井メッシュの材質は部屋ごとの関数を通っている（1つの材質を配り回していない）', () => {
  assert.ok(html.indexOf('buildRoomCeilingMesh(r,ceilY,makeRoomCeilingMaterial(r,matCeiling)') !== -1,
    'buildRooms3D が部屋ごとの天井材質を作っていない');
});
