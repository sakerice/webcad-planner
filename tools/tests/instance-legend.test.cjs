// Task 11-2: 部材ガイドの legend に「種別の付いていない物体」を残さない。
//
// 実データ (pv/renders/T94-exterior/instance-legend.json) には、種別を持たない
// エントリが 35 件あった: source が 'outside-ground' の 1 件と 'render-object' の
// 34 件（type は three.js のクラス名 "Mesh" のまま）。
// 34 件の正体は 3D 構築コードを追って特定した:
//   * 部屋の天井面 17 枚 (buildRoomCeilingMesh) -- 13 枚が PlaneGeometry、
//     階段の吹き抜けを持つ 4 枚が ShapeGeometry
//   * 自動照明器具 17 個 (makeAutoLightFixtureMesh) -- 部屋にユーザーの照明が
//     1つも無いときレンダが足す CylinderGeometry
// どちらも外観カットにしか出ない。内観3Dでは天井を作らず (matCeiling が null)、
// 自動器具も出さない (showAutoLightFixtures = !isIndoorView) ためである。
//
// このファイルは grep ではなく、名前解決と生成そのものを node:vm で走らせる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const LockTiers = require('../../assets/js/lock-tiers.js');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
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
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}

// three.js のうち、天井面と照明器具の生成が触る分だけの替え玉。
// 形（頂点の座標）は 11-3 のテストが測るので、ここでは種別の名乗りだけを見る。
function threeStub() {
  function Vec() { this.x = 0; this.y = 0; this.z = 0; }
  Vec.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  function attr(n) {
    const a = new Float32Array(n * 3);
    return { count: n, array: a,
      getX: (i) => a[i * 3], getY: (i) => a[i * 3 + 1], getZ: (i) => a[i * 3 + 2],
      setY: function (i, v) { a[i * 3 + 1] = v; }, needsUpdate: false };
  }
  function Geo(type, n) {
    this.type = type;
    this.attributes = { position: attr(n) };
    this.rotateX = function () { return this; };
    this.translate = function () { return this; };
    this.computeVertexNormals = function () { return this; };
  }
  return {
    PlaneGeometry: function () { Geo.call(this, 'PlaneGeometry', 4); },
    CylinderGeometry: function () { Geo.call(this, 'CylinderGeometry', 76); },
    ShapeGeometry: function () { Geo.call(this, 'ShapeGeometry', 6); },
    Shape: function () {
      this.holes = [];
      this.moveTo = function () {}; this.lineTo = function () {}; this.closePath = function () {};
    },
    Path: function () {
      this.moveTo = function () {}; this.lineTo = function () {}; this.closePath = function () {};
    },
    Mesh: function (geometry, material) {
      this.isMesh = true;
      this.geometry = geometry; this.material = material;
      this.position = new Vec(); this.rotation = new Vec();
      this.userData = {};
    }
  };
}

function ceilingCtx(extra) {
  const ctx = vm.createContext(Object.assign({
    console: console, THREE: threeStub(), U: 0.001,
    PV_INTERIOR_DAYLIGHT: false, isInt: false
  }, extra || {}));
  vm.runInContext([
    topLevelFunction('makeAutoLightFixtureMesh'),
    topLevelFunction('buildRoomCeilingMesh')
  ].join('\n'), ctx);
  return ctx;
}

test('aiInstanceKindFor: 名乗ったものはその名前、名乗らなかったものだけが未分類', () => {
  const ctx = vm.createContext({ console: console });
  vm.runInContext(topLevelFunction('aiInstanceKindFor'), ctx);
  const f = ctx.aiInstanceKindFor;
  const ground = { userData: {} };
  assert.equal(f({ userData: { aiInstanceType: 'ceiling' } }, ground), 'ceiling');
  assert.equal(f({ userData: { aiInstanceType: 'auto-light-fixture' } }, ground),
    'auto-light-fixture');
  // 選択の種別しか持たないものは従来どおり
  assert.equal(f({ userData: { selectKind: 'item' } }, ground), 'item');
  // aiInstanceType が selectKind より優先される
  assert.equal(f({ userData: { aiInstanceType: 'ceiling', selectKind: 'item' } }, ground),
    'ceiling');
  assert.equal(f(ground, ground), 'outside-ground');
  assert.equal(f({ userData: {} }, ground), 'render-object');
  assert.equal(f({}, ground), 'render-object');
});

test('部屋の天井面は、生成された時点で自分を ceiling と名乗る', () => {
  const ctx = ceilingCtx();
  const room = { id: 'r1', floor: 1, x: 0, y: 0, w: 4000, d: 3000 };
  const flat = ctx.buildRoomCeilingMesh(room, 2.7, {}, null);
  assert.equal(flat.userData.aiInstanceType, 'ceiling',
    '天井面が名乗らないと legend では未分類 (render-object) のままになる');
  // 階段の吹き抜けを持つ天井（ShapeGeometry の枝）も同じであること
  const holed = ctx.buildRoomCeilingMesh(room, 2.7, {}, [[{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]]);
  assert.equal(holed.geometry.type, 'ShapeGeometry', '穴あきの枝を通っていない');
  assert.equal(holed.userData.aiInstanceType, 'ceiling');
  // 既存の鍵を落としていないこと
  assert.equal(flat.userData.roomId, 'r1');
  assert.equal(flat.userData.ceiling, true);
});

test('自動照明器具は、生成された時点で auto-light-fixture と名乗る', () => {
  const ctx = ceilingCtx();
  const fix = ctx.makeAutoLightFixtureMesh({}, 1, 2, 3);
  assert.equal(fix.userData.aiInstanceType, 'auto-light-fixture');
  assert.equal(fix.geometry.type, 'CylinderGeometry');
  assert.deepEqual([fix.position.x, fix.position.y, fix.position.z], [1, 2, 3]);
});

// 名乗りが階層まで届くこと。名前を付けても表に無ければ未知の既定で LOCKED に
// 落ち、何も直っていないのと同じになる。
test('名乗った種別は LockTiers で意図した階層になる（既定に落ちない）', () => {
  const ctx = ceilingCtx();
  const room = { id: 'r1', floor: 1, x: 0, y: 0, w: 4000, d: 3000 };
  const kinds = vm.createContext({ console: console });
  vm.runInContext(topLevelFunction('aiInstanceKindFor'), kinds);
  const ceilingKind = kinds.aiInstanceKindFor(ctx.buildRoomCeilingMesh(room, 2.7, {}, null), null);
  const fixKind = kinds.aiInstanceKindFor(ctx.makeAutoLightFixtureMesh({}, 0, 0, 0), null);
  assert.equal(LockTiers.tierOf(ceilingKind), 'LOCKED');
  assert.ok(LockTiers.isKnownType(ceilingKind), ceilingKind + ' が表に無い');
  assert.equal(LockTiers.tierOf(fixKind), 'FREE');
  assert.ok(LockTiers.isKnownType(fixKind), fixKind + ' が表に無い');
});

// 実データそのものを通す。旧 legend の type は three.js のクラス名 "Mesh" のまま
// なので、type ではなく source（呼び出し側が渡した kind）で見る。
const LEGEND = JSON.parse(readFileSync(
  join(__dirname, '..', '..', 'pv', 'renders', 'T94-exterior', 'instance-legend.json'), 'utf8'));

test('実データの未分類 34 件は「部屋ごとに 2 つ」で、部屋数と一致する', () => {
  const unnamed = LEGEND.instances.filter((e) => e.source === 'render-object');
  const ground = LEGEND.instances.filter((e) => e.source === 'outside-ground');
  assert.equal(unnamed.length, 34, '未分類の件数が変わった');
  assert.equal(ground.length, 1);
  const rooms = LEGEND.instances.filter((e) => e.type === 'room');
  assert.equal(rooms.length, 17);
  assert.equal(unnamed.length, rooms.length * 2, '部屋ごとに 2 つという内訳に合わない');

  // legend の id は sc3 のトラバース順に振られる。buildRooms3D は部屋ごとに
  // 「床(=部屋として名前が付く) -> 天井 -> 自動照明器具」の順に足すので、
  // 部屋の直後に未分類が 2 つ続く。これが「部屋ごとに天井1枚と器具1個」の証拠。
  const byId = new Map(LEGEND.instances.map((e) => [e.id, e]));
  rooms.forEach(function (r) {
    [1, 2].forEach(function (d) {
      const next = byId.get(r.id + d);
      assert.ok(next, '部屋 ' + r.id + ' の直後 ' + d + ' 件目が無い');
      assert.equal(next.source, 'render-object',
        '部屋 ' + r.id + ' の直後 ' + d + ' 件目が未分類でない: ' + next.source);
    });
  });
  // 姿勢は「水平に倒した面」と「回転なし」の2種類しか無い（PlaneGeometry の
  // 天井は mesh 側で -90 度、階段穴を持つ ShapeGeometry の天井と器具は 0 度）。
  const flat = unnamed.filter((e) => e.rotation && Math.abs(e.rotation._x + Math.PI / 2) < 1e-6);
  const upright = unnamed.filter((e) => e.rotation && Math.abs(e.rotation._x) < 1e-6);
  assert.equal(flat.length + upright.length, 34, '想定外の姿勢の物体が混じっている');
  assert.equal(flat.length, 13, '面として倒された天井は 13 枚のはず: ' + flat.length);
  assert.equal(upright.length, 21, '穴あき天井 4 枚 + 器具 17 個: ' + upright.length);
});

test('特定した種別が付けば、既定 LOCKED に落ちるものは残らない', () => {
  // 旧データの 35 件に、いま突き止めた名前を与えたときの階層。
  const named = { ceiling: 17, 'auto-light-fixture': 17, 'outside-ground': 1 };
  Object.keys(named).forEach(function (t) {
    assert.ok(LockTiers.isKnownType(t), t + ' が未知のまま（既定 LOCKED に落ちる）');
  });
  const s = LockTiers.summarize(
    LEGEND.instances.map((e) => ({ id: e.id, color: e.color,
      type: e.source === 'render-object' ? 'ceiling' : e.source === 'outside-ground'
        ? 'outside-ground' : e.type })));
  assert.equal(s.LOCKED.indexOf('render-object'), -1);
  assert.ok(s.FREE.indexOf('outside-ground') >= 0);
});
