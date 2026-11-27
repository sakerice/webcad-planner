// 壁の面ごと・壁ごとの設定は、読むだけの所で欄を作らない(2026-11-27)。
// 以前は、設定欄を描く・3D を組む、といった読むだけの所が「無ければ欄を作る」関数(get…Setting)を呼んでいて、
// 壁を選んだだけ・3D に切り替えただけでプランに空の欄が増え、共同編集では設定が丸ごと相手へ送られた。
// いまは読む所は peek…Setting を使う。ここでは次の2つを見る。
//   1. peek… は欄が無くてもプランに何も足さず、get… が返すのと同じ値を返す
//   2. get…(欄を作る版)を呼ぶのは、値を変える関数だけ(読む所が get… に戻ったら落ちる)
// 画面での確かめは tools/tests/select-no-side-effects.browser.mjs。
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
    ownHelpersSource(), decl('WALL_COLORS'), decl('INTERIOR_WALL_DEFAULT'),
    fn('normalizeTextureOrientationTarget'), fn('defaultExteriorFloorSetting'), fn('defaultInteriorFloorSetting'),
    fn('ensureExteriorWallSettings'), fn('ensureInteriorWallSettings'), fn('wallSettingKey'),
    fn('interiorFaceKey'), fn('exteriorFaceKey'), fn('defaultWallFaceSetting'), fn('peekWallFaceSetting'),
    fn('peekInteriorFaceSetting'), fn('getInteriorFaceSetting'), fn('peekExteriorFaceSetting'), fn('getExteriorFaceSetting'),
    fn('peekExteriorWallSetting'), fn('getExteriorWallSetting'),
  ].join('\n'), ctx);
  vm.runInContext('ensureExteriorWallSettings(); ensureInteriorWallSettings();', ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const FACE = { sign: 1, a: 0, b: 1.82 };
const walls = () => [
  { id: 'w1', floor: 1, x1: 0, y1: 0, x2: 1820, y2: 0, thick: 120 },
  { id: 'w2', floor: 1, x1: 0, y1: 0, x2: 0, y2: 1820, thick: 120, exteriorColor: '#112233', exteriorTexture: 'siding', exteriorTextureFlipX: true },
  { id: '__proto__', floor: 1, x1: 0, y1: 0, x2: 910, y2: 0, thick: 120 },
  { id: 'constructor', floor: 1, x1: 0, y1: 0, x2: 910, y2: 910, thick: 120 },
];

test('peek…: 欄が無くてもプランに何も足さず、get… と同じ値を返す', () => {
  const data = { walls: walls(), items: [], rooms: [] };
  const ctx = load(data);
  const before = JSON.stringify(data);
  const read = {};
  ctx.face = FACE;
  data.walls.forEach((w, i) => {
    ctx.w = w;
    read[i] = plain(vm.runInContext('[peekInteriorFaceSetting(w,face), peekExteriorFaceSetting(w,face), peekExteriorWallSetting(w)]', ctx));
  });
  assert.equal(JSON.stringify(data), before, '読んだだけでプランが変わった');
  assert.deepEqual(Object.keys(data.exteriorWallSettings.walls), [], '読んだだけで壁ごとの欄が増えた');
  assert.deepEqual(Object.keys(data.exteriorWallSettings.faces).concat(Object.keys(data.interiorWallSettings.faces)), [], '読んだだけで面ごとの欄が増えた');
  // 欄を作る版が返す値と同じ(読む版に替えても、3D の色・設定欄の表示は変わらない)
  data.walls.forEach((w, i) => {
    ctx.w = w;
    const made = plain(vm.runInContext('[getInteriorFaceSetting(w,face), getExteriorFaceSetting(w,face), getExteriorWallSetting(w)]', ctx));
    assert.deepEqual(read[i], made, `壁 ${w.id}: 読む版と作る版で値が違う`);
  });
  // 壁の古い持ち方(w.exteriorColor など)は、読む版でも重ねて返す
  assert.deepEqual(read[1][2], { color: '#112233', texture: 'siding', textureFlipX: true, textureFlipY: false });
});

test('peek…: 欄があればその値を返す。__proto__・constructor の鍵は継承元を読まない', () => {
  const data = { walls: walls(), items: [], rooms: [] };
  const ctx = load(data);
  ctx.face = FACE;
  for (const w of data.walls) {
    ctx.w = w;
    vm.runInContext('getInteriorFaceSetting(w,face).mode="custom"; getInteriorFaceSetting(w,face).color="#abcdef"; getExteriorFaceSetting(w,face).mode="floor"; getExteriorWallSetting(w).color="#445566";', ctx);
  }
  const before = JSON.stringify(data);
  for (const w of data.walls) {
    ctx.w = w;
    const r = plain(vm.runInContext('[peekInteriorFaceSetting(w,face), peekExteriorFaceSetting(w,face), peekExteriorWallSetting(w)]', ctx));
    assert.equal(r[0].mode, 'custom'); assert.equal(r[0].color, '#abcdef');
    assert.equal(r[1].mode, 'floor');
    assert.equal(r[2].color, '#445566');
  }
  assert.equal(JSON.stringify(data), before);
  assert.equal(({}).mode, undefined, 'Object.prototype に書き込まれた');
  // 欄が文字などの壊れた形でも、例外を出さずに既定値を返す
  // (壊れた欄そのものは、ensure… の形の修復が消す。settings-shape-repair.test.cjs)
  data.interiorWallSettings.faces.broken_1_0_1820 = 'x';
  ctx.w = { id: 'broken', floor: 1 };
  assert.equal(vm.runInContext('peekInteriorFaceSetting(w,face).mode', ctx), 'inherit');
});

test('欄を作る get…Setting を呼ぶのは、値を変える関数だけ', () => {
  // 呼び出しごとに、それを含む関数(行頭の function 宣言)を調べる。呼んでよい関数は下の表だけ。
  const ALLOWED = {
    getInteriorFaceSetting: ['updateInteriorFaceSetting'],
    getExteriorFaceSetting: ['updateExteriorFaceSetting'],
    getExteriorWallSetting: ['updateExteriorSetting'],
  };
  const starts = [];
  const re = /\nfunction ([A-Za-z0-9_$]+)\(/g;
  let m;
  while ((m = re.exec(SRC))) starts.push({ name: m[1], at: m.index });
  const owner = (pos) => { let cur = null; for (const s of starts) { if (s.at > pos) break; cur = s.name; } return cur; };
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const call = new RegExp('(^|[^A-Za-z0-9_$.])' + name + '\\(', 'g');
    const callers = new Set();
    let c, seen = 0;
    while ((c = call.exec(SRC))) {
      const lineStart = SRC.lastIndexOf('\n', c.index) + 1;
      const line = SRC.slice(lineStart, SRC.indexOf('\n', c.index + 1));
      if (line.startsWith('function ' + name + '(')) continue;                      // 定義そのもの
      if (/^\s*\/\//.test(line)) continue;                                             // 説明の行
      // AI の操作と画面が共通で使う書き込み口(assets/js/plan-data.js の prop.exteriorColor・exteriorTexture)
      if (/^\s*exterior(Color|Texture):function\(w,v\)\{ getExteriorWallSetting\(w\)\.(color|texture)=v\|\|null; \},?$/.test(line)) continue;
      seen++;
      callers.add(owner(c.index));
    }
    assert.ok(seen >= 1, `${name} の呼び出しが1つも見つからない(検査が空振りしている)`);
    assert.deepEqual([...callers].sort(), allowed.slice().sort(), `${name} を、値を変える関数のほかが呼んでいる(読むだけなら peek… を使う)`);
  }
});
