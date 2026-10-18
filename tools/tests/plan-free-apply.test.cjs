// 短い指示の答え → 取り込みの形（assets/js/plan-free-apply.js）。
//
// 方角で書かれた向き（扉の吊り元・開く側、階段の上る向き、家具の正面）を、アプリの rot・flipX・flipY
// に翻訳する。ここが狂うと、読み取りが正しくても扉が逆に開き、家具が壁を向く。
// 正解を答えの形にして戻し、採点が全項目100点になることで確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const PlanFreeApply = require(join(ROOT, 'assets', 'js', 'plan-free-apply.js'));
const { scorePlan, objectClass } = require(join(ROOT, 'tools', 'plan-eval', 'score.cjs'));
const truth = require(join(ROOT, 'tools', 'plan-eval', 'truth', 'madori-3f.json'));

const dirOf = (v) => Math.abs(v[0]) > Math.abs(v[1]) ? (v[0] > 0 ? 'E' : 'W') : (v[1] > 0 ? 'S' : 'N');
const rad = (d) => d * Math.PI / 180;

// 正解を、AI が答える形に書き直す。
function truthAsAnswer() {
  return { floors: [1, 2, 3].map((f) => {
    const on = (o) => o.floor === f;
    const groups = {};
    for (const r of truth.rooms.filter(on)) (groups[r.n] = groups[r.n] || []).push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d });
    const items = truth.items.filter(on);
    return {
      floor: f,
      walls: truth.walls.filter(on).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
      rooms: Object.entries(groups).map(([name, parts]) => ({ name, parts })),
      openings: items.filter((i) => /^(window|door-)/.test(i.type)).map((i) => ({ type: i.type, x: i.x + i.w / 2, y: i.y + i.d / 2, width: i.w, hinge: i.hinge || null, opens: i.opens || null })),
      stairs: items.filter((i) => /^stair/.test(i.type)).map((i) => i.type === 'stair'
        ? { type: 'stair', x: i.x + i.w / 2, y: i.y + i.d / 2, width: i.w, length: i.d, up: dirOf([-Math.sin(rad(i.rot)), Math.cos(rad(i.rot))]) }
        : { type: 'stair-corner', x: i.x + i.w / 2, y: i.y + i.d / 2, width: i.w, enter: dirOf([-Math.sin(rad(i.rot)), Math.cos(rad(i.rot))]), exit: dirOf([Math.cos(rad(i.rot)), Math.sin(rad(i.rot))]) }),
      objects: items.filter((i) => objectClass(i.type)).map((i) => ({ kind: objectClass(i.type).kind, x: i.x + i.w / 2, y: i.y + i.d / 2, w: i.w, d: i.d, face: i.face || 'N' })),
    };
  }) };
}

async function toPlan(answer) {
  const { toPlan: convert } = await import(pathToFileURL(join(ROOT, 'tools', 'plan-eval', 'free-answer.mjs')).href);
  return convert(answer);
}

test('正解を答えの形にして戻すと、全項目100点（向きの翻訳が往復で崩れない）', async () => {
  const r = scorePlan(truth, await toPlan(truthAsAnswer()));
  assert.deepEqual([r.total, r.walls, r.rooms, r.openings, r.stairs, r.fixtures, r.furniture, r.exterior], [100, 100, 100, 100, 100, 100, 100, 100]);
});

test('壁の上に無い窓・扉は捨てる（残すと近くの別の壁に穴が開く）', () => {
  const p = PlanFreeApply.toImportPlan({ floors: [{ floor: 1,
    walls: [{ x1: 0, y1: 0, x2: 3000, y2: 0 }],
    openings: [{ type: 'door-opening', x: 1500, y: 0, width: 800 }, { type: 'door-opening', x: 1500, y: 900, width: 800 }],
  }] }, {});
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].y, 0);
});

test('扉と掃き出し窓は閉じた状態で置く（アプリの既定は開いた状態）', () => {
  const p = PlanFreeApply.toImportPlan({ floors: [{ floor: 1,
    walls: [{ x1: 0, y1: 0, x2: 3000, y2: 0 }],
    openings: [{ type: 'door-front', x: 1000, y: 0, width: 900, hinge: 'W', opens: 'S' }, { type: 'window-door', x: 2200, y: 0, width: 1650 }],
  }] }, {});
  assert.deepEqual(p.items.map((i) => i.extra.doorOpenState), ['closed', 'closed']);
});

test('書き出し途中の答えから、何階の何をいくつ作ったかを数える', () => {
  const partial = '{"floors":[{"floor":1,"walls":[{"x1":0,"y1":0,"x2":10,"y2":0},{"x1":0,"y1":0,"x2":0,"y2":10}],'
    + '"rooms":[{"name":"洋室","parts":[{"x0":0,"y0":0,"x1":10,"y1":10}]}],"openings":[{"type":"window","x":5,"y":0,"width":9,"hinge":null';
  const g = PlanFreeApply.progressOf(partial);
  assert.equal(g.floor, 1);
  assert.equal(g.section, 'openings');
  assert.equal(g.walls, 2, '部屋の長方形を壁と数えない');
  assert.equal(g.rooms, 1);
  assert.equal(g.openings, 1);
});
