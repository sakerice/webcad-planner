// 読み取りの採点（tools/plan-eval/score.cjs）。
//
// 採点が狂うと、良くなった変更を捨て、悪くなった変更を取り込むことになる。
// 「同じなら満点」「原点がずれても満点」「欠けた分だけ下がる」「名前の書き方の
// 違いでは下がらない」を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const { scorePlan, normalizeName, nameScore } = require(join(ROOT, 'tools', 'plan-eval', 'score.cjs'));
const truth = require(join(ROOT, 'tools', 'plan-eval', 'truth', 'madori-3f.json'));

const clone = (o) => JSON.parse(JSON.stringify(o));
function shift(plan, dx, dy) {
  const p = clone(plan);
  for (const w of p.walls) { w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; }
  for (const r of p.rooms) { r.x += dx; r.y += dy; }
  for (const it of p.items) { it.x += dx; it.y += dy; }
  return p;
}

test('正解どうしは満点', () => {
  const r = scorePlan(truth, truth);
  assert.equal(r.total, 100);
  assert.deepEqual(r.floors.map((f) => f.floor), [1, 2, 3]);
});

test('原点がずれていても満点（取り込み先で右隣に建てた場合など）', () => {
  const r = scorePlan(truth, shift(truth, 12345, -678));
  assert.equal(r.total, 100);
  assert.deepEqual(r.offset, { dx: -12345, dy: 678 });
});

test('空の読み取りは0点', () => {
  const r = scorePlan(truth, { walls: [], rooms: [], items: [] });
  assert.equal(r.total, 0);
});

test('壁を1本抜くと壁の点だけが下がる', () => {
  const p = clone(truth);
  const i = p.walls.findIndex((w) => w.floor === 1 && w.x1 === 3640 && w.x2 === 3640);
  p.walls.splice(i, 1);
  const r = scorePlan(truth, p);
  const f1 = r.floors[0];
  assert.ok(f1.walls.recall < 1 && f1.walls.precision === 1, '取りこぼしとして数える');
  assert.equal(f1.rooms.score, 1);
  assert.equal(f1.openings.score, 1);
  assert.ok(r.total < 100 && r.total > 95);
});

test('壁が厚みほどずれても当たり、それ以上ずれると外れ', () => {
  const near = clone(truth), far = clone(truth);
  for (const p of [near, far]) {
    const w = p.walls.find((x) => x.floor === 2 && x.x1 === 910);
    const d = p === near ? 100 : 400;
    w.x1 += d; w.x2 += d;
  }
  assert.equal(scorePlan(truth, near).floors[1].walls.score, 1);
  assert.ok(scorePlan(truth, far).floors[1].walls.score < 1);
});

test('部屋の名前は畳数・番号の書き方の違いでは下がらない', () => {
  assert.equal(normalizeName('洋室（4.2帖）'), normalizeName('洋室'));
  assert.equal(normalizeName('趣味部屋①'), normalizeName('趣味部屋1'));
  assert.equal(nameScore('LDK', 'Living Dining Kitchen'), 0.5, '同じ用途なら半分');
  assert.equal(nameScore('トイレ', '浴室'), 0);
});

test('L字の部屋は長方形2つで描いても1室として数える', () => {
  const r = scorePlan(truth, truth);
  const f1 = r.floors[0].rooms;
  assert.equal(f1.truthCount, 8, '1階は8室（洋室と廊下はL字）');
});

test('部屋の名前を取り違えると名前の点だけが下がる', () => {
  const p = clone(truth);
  p.rooms.find((x) => x.n === '浴室').n = '物置';
  const f1 = scorePlan(truth, p).floors[0].rooms;
  assert.equal(f1.count, 1);
  assert.equal(f1.area, 1);
  assert.ok(f1.name < 1);
});

test('部屋を1つ取りこぼすと数・名前・面積が下がる', () => {
  const p = clone(truth);
  p.rooms = p.rooms.filter((x) => !(x.floor === 3 && x.n === 'トイレ'));
  const f3 = scorePlan(truth, p).floors[2].rooms;
  assert.equal(f3.matched, f3.truthCount - 1);
  assert.ok(f3.count < 1 && f3.name < 1 && f3.area < 1);
});

test('建具: 窓を扉と読んだら外れ、少しずれたら位置の点だけ下がる', () => {
  const swapped = clone(truth), moved = clone(truth);
  swapped.items.find((x) => x.floor === 3 && x.type === 'window').type = 'door-swing';
  const r1 = scorePlan(truth, swapped).floors[2].openings;
  assert.ok(r1.count < 1, '窓を扉と読んだのは当たりにしない');

  const it = moved.items.find((x) => x.floor === 3 && x.type === 'window');
  it.x += 300;
  const r2 = scorePlan(truth, moved).floors[2].openings;
  assert.equal(r2.count, 1);
  assert.ok(r2.position < 1 && r2.position > 0.8);
});

test('種類違いの扉（引き戸を開き戸と読んだ）は当たりだが種類一致の率に出る', () => {
  const p = clone(truth);
  p.items.find((x) => x.floor === 3 && x.type === 'door-slide-s').type = 'door-swing';
  const o = scorePlan(truth, p).floors[2].openings;
  assert.equal(o.count, 1);
  assert.ok(o.typeMatch < 1);
});

test('正解に無い階を読んだら知らせる', () => {
  const p = clone(truth);
  p.walls.push({ x1: 0, y1: 0, x2: 1000, y2: 0, floor: 4 });
  assert.deepEqual(scorePlan(truth, p).extraFloors, [4]);
});
