// バルコニーフェンス(手すり壁)の足元の納まり。
//
// 直した不具合: 手すり壁をバルコニーの**床天端**から立てていたため、床スラブの
// 小口(180mm)が外から帯になって見えていた。手すり壁は外壁の一部なので、他の
// 壁種と同じく壁の基準(floorBaseY=スラブ下端)まで下ろして床を覆う必要がある。
//
// grep では押さえない。addBalconyFencePiece を波括弧の対応で切り出し、THREE を
// 差し替えた sandbox で**実際に走らせて**、置かれた箱の位置と寸法を測る。
// 「スラブ天端から立てる」書き方に戻されても、値を測っていれば必ず落ちる。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

// 入れ子の関数も切り出せる版(addBalconyFencePiece は buildWall3D の中にある)
function grabFunction(name) {
  const at = html.search(new RegExp('(^|\\n)\\s*function ' + name + '\\s*\\('));
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = html.indexOf('function ' + name, at);
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
function grabVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}

// index.html から持ってくる高さの計算。ここで値を作り直すと、本体の定数を
// 変えたときにテストだけが古い前提のまま緑になる
const FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallHeightMm', 'balconyFenceRailHeightM', 'balconySlabHeightMm'
];

// フェンス1枚を実際に組み立てて、置かれた箱を返す。
// wall.thick と壁の長さ以外は既定プランと同じ条件。
function buildFence(wall) {
  const placed = [];
  function Vec3() { this.x = 0; this.y = 0; this.z = 0; }
  Vec3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; };
  function BoxGeometry(w, h, d) { this.w = w; this.h = h; this.d = d; }
  function Mesh(geo, mat) {
    this.geometry = geo; this.material = mat;
    this.position = new Vec3(); this.rotation = { y: 0 };
    this.castShadow = false; this.receiveShadow = false;
  }
  const THREE = {
    BoxGeometry: BoxGeometry,
    Mesh: Mesh,
    MeshStandardMaterial: function (p) { Object.assign(this, p || {}); }
  };
  const fl = wall.floor || 2;
  const ctx = vm.createContext({
    console: console, HeightModel: HeightModel, THREE: THREE,
    DATA: { floors: {}, rooms: [], items: [], walls: [wall] },
    w: wall, fl: fl,
    // 壁1本の幾何。芯線 (0,y) → (len,y) を東向きに置いた状態
    len: 2.73, x1: 0, z1: 8.645, dirX: 1, dirZ: 0, rotY: 0,
    endExtA: 0.006, endExtB: 0.006,
    wallGroup: { add: function (m) { placed.push(m); } },
    // 見た目の枝は測らないので、素通しの差し替えにする
    makeExteriorWallMaterial: function () { return {}; },
    setTextureRepeatNoDistort: function () {},
    applyTextureFlip: function () {},
    resolveExteriorWallAppearance: function () { return {}; },
    wallTextureTileHeight: function () { return 0.91; }
  });
  vm.runInContext(
    [grabVar('WALL_H'), grabVar('FLOOR_H'), grabVar('FLOOR_SLAB_H'), grabVar('U')]
      .concat(FNS.map(grabFunction))
      .concat(['var fy=floorBaseY(fl);', grabFunction('addBalconyFencePiece'),
               'addBalconyFencePiece(0,len);'])
      .join('\n'),
    ctx);
  assert.equal(placed.length, 2, '手すり壁と笠木の2つが置かれるはず');
  return {
    ctx: ctx,
    panel: placed[0],
    kasa: placed[1],
    // バルコニー床の天端 / スラブの下端(3D の build3DBalcony と同じ式)
    floorTop: ctx.floorTopY(fl) + 0.006,
    slabBottom: ctx.floorTopY(fl) + 0.006 - ctx.balconySlabHeightMm() * ctx.U
  };
}

const FENCE = { id: 1, floor: 2, thick: 120, wallStyle: 'balcony-fence', wallHeight: 1100 };

test('手すり壁はバルコニー床スラブの小口を覆う（外から床材が見えない）', () => {
  const r = buildFence(FENCE);
  const bottom = r.panel.position.y - r.panel.geometry.h / 2;
  assert.ok(bottom <= r.slabBottom + 1e-9,
    '手すり壁の下端 ' + bottom + 'm がスラブ下端 ' + r.slabBottom +
    'm より上にある。この差ぶん、外観に床材が帯として出る');
});

test('手すり壁の下端は壁の基準（floorBaseY）＝他の壁種と同じ足元に来る', () => {
  const r = buildFence(FENCE);
  const bottom = r.panel.position.y - r.panel.geometry.h / 2;
  assert.equal(Math.round(bottom * 1000), Math.round(r.ctx.floorBaseY(2) * 1000));
});

test('手すりの高さはバルコニー床天端から1100mm以上（建築基準法の下限）', () => {
  const r = buildFence(FENCE);
  const top = r.panel.position.y + r.panel.geometry.h / 2;
  const rail = Math.round((top - r.floorTop) * 1000);
  assert.equal(rail, 1100, '床天端からの手すり高が ' + rail + 'mm');
});

test('笠木は手すり壁の天端に載る（隙間も食い込みも無い）', () => {
  const r = buildFence(FENCE);
  const top = r.panel.position.y + r.panel.geometry.h / 2;
  const kasaBottom = r.kasa.position.y - r.kasa.geometry.h / 2;
  assert.ok(Math.abs(kasaBottom - top) < 1e-9,
    '笠木の下端 ' + kasaBottom + 'm と手すり壁の天端 ' + top + 'm がずれている');
});

test('壁高さ未指定でも手すりは1100mm。階高(WALL_H)には落ちない', () => {
  const r = buildFence({ id: 2, floor: 2, thick: 120, wallStyle: 'balcony-fence' });
  const top = r.panel.position.y + r.panel.geometry.h / 2;
  assert.equal(Math.round((top - r.floorTop) * 1000), 1100);
});

test('壁高さを指定したらその値が手すり高さになる（立面図と3Dが食い違わない）', () => {
  const r = buildFence({ id: 3, floor: 2, thick: 120, wallStyle: 'balcony-fence', wallHeight: 1400 });
  const top = r.panel.position.y + r.panel.geometry.h / 2;
  assert.equal(Math.round((top - r.floorTop) * 1000), 1400);
  const bottom = r.panel.position.y - r.panel.geometry.h / 2;
  assert.ok(bottom <= r.slabBottom + 1e-9, '高さを変えても足元は覆ったまま');
});

test('1階に置いた手すり壁は床スラブが無いので高さが変わらない', () => {
  const r = buildFence({ id: 4, floor: 1, thick: 120, wallStyle: 'balcony-fence', wallHeight: 1100 });
  const top = r.panel.position.y + r.panel.geometry.h / 2;
  assert.equal(Math.round((top - r.floorTop) * 1000), 1100);
  assert.equal(Math.round(r.ctx.floorSlabHeightMForFloor(1) * 1000), 0);
});

test('テクスチャの縦リピートは手すり壁の実寸で決める（柄が潰れない）', () => {
  const body = grabFunction('addBalconyFencePiece');
  assert.match(body, /setTextureRepeatNoDistort\(fenceMat\.map,segLen,panelH,/,
    '固定値や手すり高だけを渡すと、スラブを覆したぶん柄が縦に伸びる');
});
