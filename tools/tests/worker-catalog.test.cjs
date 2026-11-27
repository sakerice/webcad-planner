// Worker 用の種類の表(assets/data/worker-catalog.json)が、画面のコードと食い違っていないか。
//
// 表は tools/build_worker_catalog.cjs が、画面の関数を node:vm で実際に呼んで作る。
// 画面の寸法の表・判定の関数・カタログのマニフェストを変えたのに表を作り直していないと、
// Worker で当てた操作の結果が画面と違ってくる。ここで落とす。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'assets', 'data', 'worker-catalog.json');
const { buildCatalog, serialize } = require(join(ROOT, 'tools', 'build_worker_catalog.cjs'));

const REBUILD = '表を作り直してください: node tools/build_worker_catalog.cjs';

const built = buildCatalog();
const committed = JSON.parse(readFileSync(OUT, 'utf8'));
const has = (t, f) => (committed.types[t].f || []).includes(f);

test('コミットされている表が、今の画面のコードから作った表と一致する', () => {
  assert.equal(readFileSync(OUT, 'utf8'), serialize(built), '画面のコードと表が食い違っています。' + REBUILD);
});

test('種類の数が 800 以上、表の大きさが 100KB 以内', () => {
  assert.ok(Object.keys(committed.types).length >= 800, '種類が ' + Object.keys(committed.types).length + ' しかない');
  assert.ok(statSync(OUT).size <= 100 * 1024, '表が ' + statSync(OUT).size + ' バイトある');
  assert.match(committed.version, /^[0-9a-f]{12}$/);
});

test('代表の種類の寸法・色・判定', () => {
  const T = committed.types;
  // 古い種類名は今の種類名へ引く(sofa → カタログのソファ)
  assert.equal(committed.legacy.sofa, 'fmp-Sofa01');
  assert.equal(committed.legacy['bed-d'], 'fmp-Bed01');
  const sofa = T['fmp-Sofa01'];
  assert.equal(sofa.m, 1);
  assert.ok(sofa.w > 0 && sofa.d > 0 && sofa.h > 0);
  assert.equal(sofa.w, built.types['fmp-Sofa01'].w);
  assert.ok(has('fmp-Sofa01', 'elev'));
  assert.ok(!has('fmp-Sofa01', 'light'));
  // 寸法の表(ISIZES)の種類はそのままの値
  assert.deepEqual([T.window.w, T.window.d], [1650, 150]);
  assert.ok(has('window', 'windowLike') && has('window', 'opening') && !has('window', 'elev'));
  assert.deepEqual([T['door-swing'].w, T['door-swing'].d], [780, 780]);
  assert.ok(has('door-swing', 'doorLikeOpening') && has('door-swing', 'doorPanel'));
  assert.ok(has('door-opening', 'doorLikeOpening') && !has('door-opening', 'doorPanel'));
  assert.deepEqual([T.stair.w, T.stair.d], [910, 2730]);
  assert.ok(has('stair', 'stairPart') && has('stair', 'elev'));
  // 照明: 判定、既定の欄、天井に付く器具
  const down = T['light-down'];
  assert.ok(has('light-down', 'light') && has('light-down', 'ceilingFixture') && has('light-down', 'elev'));
  assert.equal(down.lt.lightKind, 'down');
  assert.equal(down.lt.lightIntensity, 0.72);
  assert.equal(down.lt.lightRange, 4400);
  assert.equal(down.lt.lightAngle, 64);
  assert.equal(down.lt.lightCastShadow, true);
  // 地面に置く種類・周辺の建物
  assert.ok(has('foundation', 'groundOnly') && has('foundation', 'surface') && !has('foundation', 'elev'));
  assert.ok(has('neighbor-house', 'contextExterior') && has('neighbor-house', 'groundOnly'));
  assert.equal(T['neighbor-house'].cx.f, 2);
  assert.equal(T['neighbor-building'].cx.f, 4);
  assert.equal(T['utility-pole'].cx.h, 6500);
  // 台になる物
  assert.ok(has('fmp-Table01', 'surface'));
  // 名前(要約に使う)
  assert.equal(T.window.n, '窓');
  assert.equal(T.memo.n, 'メモ');
  assert.ok(has('memo', 'annotation') && !has('memo', 'elev'));
  // 定規は寸法の表に無いので置けない種類。名前と判定だけ others に持つ
  assert.equal(T.ruler, undefined);
  assert.equal(committed.others.ruler.n, '定規');
  assert.equal(committed.others['ceiling-area'].n, '天井範囲');
  assert.ok((committed.others.ruler.f || []).includes('annotation'));
  // factories が使う定数
  assert.deepEqual(
    [committed.constants.rulerThickness, committed.constants.walkRouteThickness, committed.constants.walkDefaultSpeed],
    [120, 140, 1.2]);
});

test('置ける種類は、寸法の表(ISIZES)とカタログ(標準のセット)の和で、追加のセットは入れない', () => {
  const T = committed.types;
  assert.ok(Object.keys(T).every((t) => !/^(rpg-mansion|kominka)/.test(t)));
  // 寸法の表の種類はモデルを持たない(重なりが無い)
  assert.ok(T.bath && !T.bath.m);
});

// 一括差し替え(swapAssetSet)と家具の部位(setProps の finishColors など)に使う、もう1つの表。
test('家具の表(worker-furniture.json)も、今の画面のコードとセットの manifest から作った表と一致する', () => {
  const { buildFurniture, serializeFurniture, FURNITURE_OUT } = require(join(ROOT, 'tools', 'build_worker_catalog.cjs'));
  const fresh = buildFurniture();
  assert.equal(readFileSync(FURNITURE_OUT, 'utf8'), serializeFurniture(fresh), '画面のコード・セットの manifest と表が食い違っています。' + REBUILD);
  // 差し替えの設定を持つセット(洋館・古民家)と、その物が入っている
  assert.deepEqual(fresh.sets.map((s) => s.id), ['rpg-mansion', 'kominka']);
  assert.ok(Object.keys(fresh.types).some((t) => /^rpg-mansion-/.test(t)) && Object.keys(fresh.types).some((t) => /^kominka-/.test(t)));
  // セットの物は標準の種類と重ならない(重なると Worker は標準を使い、画面と食い違う)
  Object.keys(fresh.types).forEach((t) => assert.ok(!committed.types[t], t + ' が標準とセットの両方にある'));
  // 部位: 張地(fabric)を持つ家具がある
  assert.ok(Object.values(fresh.fc).some((list) => list.includes('fabric')));
});
