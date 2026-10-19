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
      walls: truth.walls.filter(on).map(({ x1, y1, x2, y2, wallStyle }) => ({ x1, y1, x2, y2, style: wallStyle || "solid" })),
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

test('既定のモデルはカタログに実在し、分類表でもその種類になっている', () => {
  const tags = (require(join(ROOT, 'assets', 'models', 'tags.json')).items);
  for (const [kind, id] of Object.entries(PlanFreeApply.DEFAULT_MODEL)) {
    assert.ok(tags[id], `${id} が分類表に無い`);
    assert.equal(tags[id].kind, kind, `${id} は ${kind} ではない`);
  }
});

test('家具・設備はカタログのモデルで置き、正面の決まり（rot+180・modelFacingVersion 1）を付ける', () => {
  const p = PlanFreeApply.toImportPlan({ floors: [{ floor: 1, walls: [{ x1: 0, y1: 0, x2: 3000, y2: 0 }],
    objects: [{ kind: 'toilet', x: 500, y: 400, w: 380, d: 680, face: 'W' }, { kind: 'ramp', x: 2000, y: 400, w: 1000, d: 2000, face: 'S' }] }] }, {});
  const [toilet, ramp] = p.items;
  assert.equal(toilet.type, 'fmp-Toilet01', '組み込みの toilet は使わない（読み込みで置き換えられ向きが逆になる）');
  assert.equal(toilet.rot, 90, '正面が西 → rot 270 + 180');
  assert.equal(toilet.extra.modelFacingVersion, 1);
  assert.equal(ramp.type, 'ramp', 'スロープは組み込みのまま');
  assert.equal(ramp.rot, 180);
});

test('手すり壁（style: balcony-fence）はアプリのバルコニーフェンスの壁として建てる', () => {
  const p = PlanFreeApply.toImportPlan({ floors: [{ floor: 2, walls: [
    { x1: 0, y1: 0, x2: 3000, y2: 0, style: 'solid' }, { x1: 0, y1: 1000, x2: 3000, y2: 1000, style: 'balcony-fence' },
  ] }] }, {});
  assert.deepEqual(p.walls.map((w) => w.wallStyle || 'solid'), ['solid', 'balcony-fence']);
});

test('屋根: 載る階の上に置き（アプリの floor は +1）、形と向きを翻訳する', () => {
  const p = PlanFreeApply.toImportPlan({ floors: [{ floor: 2, walls: [{ x1: 0, y1: 0, x2: 4000, y2: 0 }], roofs: [
    { floor: 2, x0: 0, y0: 0, x1: 4000, y1: 2000, shape: 'gable', ridge: 'NS', low: null, pitch: 30 },
    { floor: 2, x0: 0, y0: 2000, x1: 4000, y1: 3000, shape: 'mono', ridge: null, low: 'E', pitch: null },
  ] }] }, {});
  const [gable, mono] = p.items;
  assert.equal(gable.type, 'roof');
  assert.equal(gable.floor, 3, '2階の上に載る屋根はアプリでは floor=3');
  assert.equal(gable.extra.roofType, 'gable-y', '棟が南北の切妻');
  assert.equal(mono.extra.roofType, 'mono');
  assert.equal(mono.rot, 90, '東が低い片流れ');
  assert.deepEqual([mono.w, mono.d], [1000, 4000], '回したぶん幅と奥行きを入れ替えて同じ範囲を覆う');
});

test('壁の上に無い窓・扉: 見直しの前は残して事実にし、あとは置かずに説明を書く', () => {
  const answer = { floors: [{ floor: 1, walls: [{ x1: 0, y1: 0, x2: 3000, y2: 0 }],
    openings: [{ type: 'door-opening', x: 1500, y: 900, width: 800 }] }] };
  const draft = PlanFreeApply.toImportPlan(answer, {}, { keepOffWall: true });
  assert.equal(draft.items.length, 1);
  assert.ok(PlanFreeApply.factsOf(draft, answer).some((f) => /壁の上にありません/.test(f)));
  const final = PlanFreeApply.toImportPlan(answer, {});
  assert.equal(final.items.length, 0);
  assert.match(final.userNotes.join(''), /位置を確かめられなかった窓・扉が 1 か所あります（1階）/);
  assert.ok(!/\d{3,}/.test(final.userNotes.join('')), '利用者に見せる文に座標を出さない');
});

// ── 設定パネルの項目と外構（assets/js/plan-settable.js の表） ─────────────
const box = [{ x1: 0, y1: 0, x2: 9100, y2: 0, style: 'solid' }, { x1: 9100, y1: 0, x2: 9100, y2: 7280, style: 'solid' },
  { x1: 9100, y1: 7280, x2: 0, y2: 7280, style: 'solid' }, { x1: 0, y1: 7280, x2: 0, y2: 0, style: 'solid', set: 'thick=150; wallHeight=2400' }];

test('設定パネルの項目（set）を、範囲と選択肢を確かめて入れる', () => {
  const plan = PlanFreeApply.toImportPlan({ floors: [{ floor: 1, walls: box,
    rooms: [{ name: 'LDK', parts: [{ x0: 0, y0: 0, x1: 5000, y1: 4000 }], set: 'ceilingHeight=2500; floorMaterial=wood_oak' },
      { name: '吹抜け', parts: [{ x0: 5000, y0: 0, x1: 9100, y1: 4000 }], set: 'void=yes' }],
    openings: [{ type: 'window', x: 2000, y: 0, width: 1690, hinge: 'none', opens: 'none', set: 'windowKind=fix; windowSill=1200; windowHeight=500; doorHeight=2000' },
      { type: 'door-swing', x: 9100, y: 3000, width: 780, hinge: 'N', opens: 'W', set: 'doorHeight=2200' }],
    stairs: [{ type: 'stair', x: 1000, y: 6000, width: 910, length: 2730, up: 'N', enter: 'none', exit: 'none', set: 'stairRail=right' }],
    roofs: [], objects: [] }] }, {});
  const wall = plan.walls[3];
  assert.equal(wall.thick, 150);
  assert.deepEqual(wall.extra, { wallHeight: 2400 });
  assert.deepEqual(plan.rooms[0].extra, { ceiling: { type: 'flat', heightMm: 2500 }, floorMaterial: 'wood_oak' });
  assert.deepEqual(plan.rooms[1].extra, { ceiling: { type: 'void', toFloor: 2 } });
  const win = plan.items.find((i) => i.type === 'window');
  assert.deepEqual([win.extra.windowKind, win.extra.windowSill, win.extra.windowHeight, win.extra.doorHeight], ['fix', 1200, 500, undefined], '窓に扉の高さは入れない');
  assert.equal(plan.items.find((i) => i.type === 'door-swing').extra.doorHeight, 2200);
  assert.equal(plan.items.find((i) => i.type === 'stair').extra.stairRail, 'right');
});

test('外構: 車・フェンス・敷地と駐車スペースを置く（フェンスを黙って捨てない）', () => {
  const plan = PlanFreeApply.toImportPlan({ floors: [{ floor: 1, walls: box, rooms: [], openings: [], stairs: [], roofs: [], objects: [
    { kind: 'car', x: 11000, y: 3000, w: 1800, d: 4700, face: 'S', set: '' },
    { kind: 'fence', x: 4550, y: -1500, w: 9100, d: 100, face: 'N', set: 'fenceHeight=1200; fencePattern=horizontal' },
    { kind: 'site', x: 6000, y: 3000, w: 16000, d: 12000, face: 'S', set: 'surface=gravel' },
    { kind: 'site-zone', x: 11000, y: 3000, w: 2700, d: 5000, face: 'none', set: 'name=駐車スペース; surface=concrete_brush' },
  ] }] }, {});
  const car = plan.items.find((i) => i.type === 'car');
  assert.ok(car, '車が置かれる');
  assert.equal(car.rot, 0, '車は rot=0 で前が南（2Dの絵と3Dのモデルで確かめた向き）');
  assert.equal(car.extra.modelFacingVersion, undefined, '組み込みの種類にカタログの向きの印を付けない');
  const fence = plan.items.find((i) => i.type === 'wood-fence');
  assert.ok(fence, 'フェンスは組み込みのフェンスで置く');
  assert.deepEqual([fence.extra.fenceHeight, fence.extra.fencePattern], [1200, 'horizontal']);
  assert.deepEqual(plan.dropped, []);
  assert.deepEqual(plan.site, { x: -2000, y: -3000, w: 16000, d: 12000, surface: 'gravel',
    zones: [{ name: '駐車スペース', x: 11650, y: 3500, w: 2700, d: 5000, surface: 'concrete_brush' }] });
  assert.ok(!plan.items.some((i) => i.type === 'site-rect'), '敷地は items ではなく site で返す（取り込みが1つにまとめる）');
});

test('置けない種類は捨てたことを数え、見直しで AI に伝える', () => {
  const answer = { floors: [{ floor: 1, walls: box, rooms: [], openings: [], stairs: [], roofs: [], objects: [
    { kind: 'spaceship', x: 1000, y: 1000, w: 600, d: 600, face: 'N', set: '' }] }] };
  const plan = PlanFreeApply.toImportPlan(answer, {});
  assert.deepEqual(plan.dropped, ['spaceship']);
  assert.ok(PlanFreeApply.factsOf(plan, answer).some((f) => /spaceship/.test(f)));
});
