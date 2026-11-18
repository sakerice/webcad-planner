// 画面の外観・内観・屋根の設定表が、文字などの壊れた形で届いても例外を出さずに作り直されること(2026-11-19)。
// 共同編集の相手や古い Worker から `exteriorWallSettings.walls: "x"` のような欄が届くと、以前は ensure… が
// 「無い」ときだけ作るので文字が残り、ownSlot(Object.defineProperty)が例外になって 3D と外観の設定欄が壊れた。
// index.html と assets/js の関数を名前で切り出し、node:vm で動かす。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { appSource, ownHelpersSource } = require('./app-source.cjs');

const SRC = appSource();
function fn(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' が無い');
  return SRC.slice(at + 1, SRC.indexOf('\n}\n', at) + 2);
}
function decl(name) {
  const m = SRC.match(new RegExp('\\n(?:var|const|let) ' + name + '\\s*=[^\\n]*'));
  if (!m) throw new Error(name + ' が無い');
  return m[0];
}

function load(data) {
  const ctx = vm.createContext({ DATA: data, console });
  vm.runInContext([
    ownHelpersSource(),
    decl('WALL_COLORS'), decl('INTERIOR_WALL_DEFAULT'),
    fn('normalizeTextureOrientationTarget'), fn('defaultExteriorFloorSetting'), fn('defaultInteriorFloorSetting'),
    fn('ensureExteriorWallSettings'), fn('ensureInteriorWallSettings'), fn('ensureRoofAppearance'),
    fn('wallSettingKey'), fn('getExteriorWallSetting'),
  ].join('\n'), ctx);
  return ctx;
}

const BROKEN = [
  { exteriorWallSettings: { walls: 'x' } },
  { exteriorWallSettings: { faces: 5, floors: 'x', whole: 'x' } },
  { exteriorWallSettings: { walls: { 1: 'x' }, floors: { 1: 3 } } },
  { exteriorWallSettings: 'x' },
  { interiorWallSettings: { faces: 'x', floors: [] } },
  { interiorWallSettings: 7 },
  { roofAppearance: { whole: 'x', floors: 'x' } },
  { roofAppearance: { whole: null, floors: { 1: 'x' } } },
];

test('壊れた形の設定表でも、ensure… と壁ごとの設定の読み出しが例外を出さず、作り直す', () => {
  for (const broken of BROKEN) {
    const data = { walls: [{ id: 1, floor: 1, x1: 0, y1: 0, x2: 1000, y2: 0 }], items: [], rooms: [], ...broken };
    const ctx = load(data);
    const where = JSON.stringify(broken);
    vm.runInContext('ensureExteriorWallSettings(); ensureInteriorWallSettings(); ensureRoofAppearance(); getExteriorWallSetting(DATA.walls[0]).color = "#123456";', ctx);
    const s = ctx.DATA.exteriorWallSettings;
    for (const part of ['whole', 'floors', 'walls', 'faces']) assert.equal(typeof s[part], 'object', where + ' ' + part);
    assert.equal(s.walls[1].color, '#123456', where);
    for (let f = 1; f <= 4; f++) {
      assert.equal(typeof s.floors[f], 'object', where + ' 外観の階 ' + f);
      assert.equal(typeof ctx.DATA.interiorWallSettings.floors[f], 'object', where + ' 内観の階 ' + f);
      assert.equal(typeof ctx.DATA.roofAppearance.floors[f], 'object', where + ' 屋根の階 ' + f);
    }
  }
});

test('ふつうの設定表は変えない', () => {
  const settings = {
    whole: { linked: false, color: '#e8e0cc', texture: null, textureFlipX: false, textureFlipY: false },
    floors: { 1: { linked: true, color: '#5c3820', texture: null, textureFlipX: false, textureFlipY: false } },
    walls: { 1: { color: '#abcdef', texture: null, textureFlipX: false, textureFlipY: false } },
    faces: { '1_1_0_1000': { color: '#fff' } },
  };
  const data = { walls: [{ id: 1, floor: 1 }], items: [], rooms: [], exteriorWallSettings: JSON.parse(JSON.stringify(settings)) };
  const ctx = load(data);
  vm.runInContext('ensureExteriorWallSettings();', ctx);
  const s = ctx.DATA.exteriorWallSettings;
  assert.deepEqual(JSON.parse(JSON.stringify(s.walls)), settings.walls);
  assert.deepEqual(JSON.parse(JSON.stringify(s.faces)), settings.faces);
  assert.deepEqual(JSON.parse(JSON.stringify(s.floors[1])), settings.floors[1]);
});

test('ownSlot: 入れ物がオブジェクトでない・今の値が文字でも例外を出さない', () => {
  const ctx = vm.createContext({});
  vm.runInContext(ownHelpersSource(), ctx);
  const r = vm.runInContext('[ownSlot("x", "a", function(){ return {v:1}; }).v, (function(){ var t={a:"s"}; ownSlot(t,"a",function(){ return {v:2}; }); return t.a.v; })(), ownSlot(null, "a", function(){ return {v:3}; }).v]', ctx);
  assert.deepEqual(Array.from(r), [1, 2, 3]);
});
