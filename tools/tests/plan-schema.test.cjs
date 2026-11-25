// プランJSONの検査。
//
// これは「読み込めるか」だけを見る門番であって、設計の良し悪し(玄関の向き、
// 廊下の幅)は tools/lint_plan.py の仕事。ここで設計を判断し始めると、
// 手で描いた変わった間取りが読めなくなる。
//
// 出荷している既定間取りと、テスト用に凍結した間取りが、どちらも1件の
// error も出さずに通ることを最後に確かめている。門番が厳しすぎて実物を
// 弾いたら、それは門番の不良である。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));
const { validatePlan, normalizePlan, summarize, LIMITS } = PlanSchema;

// 最小限の、通るプラン。ここを足場に1か所ずつ壊して試す。
function okPlan(over) {
  const plan = {
    walls: [
      { id: 'w1', floor: 1, x1: 0, y1: 0, x2: 4000, y2: 0, thick: 120 },
      { id: 'w2', floor: 1, x1: 4000, y1: 0, x2: 4000, y2: 3000, thick: 120 }
    ],
    rooms: [{ id: 'r1', floor: 1, x: 0, y: 0, w: 4000, d: 3000, n: 'LDK' }],
    items: [{ id: 'i1', floor: 1, type: 'kitchen', x: 500, y: 500, w: 2400, d: 650, rot: 0 }]
  };
  return Object.assign(plan, over || {});
}

test('素直なプランは通る', () => {
  const r = validatePlan(okPlan());
  assert.equal(r.ok, true, r.errors.join(' / '));
  assert.deepEqual(r.errors, []);
});

test('walls/rooms/items が配列でなければ、そこで止める', () => {
  for (const name of ['walls', 'rooms', 'items']) {
    const plan = okPlan(); plan[name] = {};
    const r = validatePlan(plan);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(), new RegExp(name + ' が配列ではない'));
  }
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan([]).ok, false);
});

test('座標が文字列の数値でも読む（AIの出力でも手書きでも普通に混ざる）', () => {
  const plan = okPlan();
  plan.walls[0].x2 = '4000';
  plan.rooms[0].w = '4000';
  assert.equal(validatePlan(plan).ok, true);
  const n = normalizePlan(plan);
  assert.equal(n.walls[0].x2, 4000);
  assert.equal(n.rooms[0].w, 4000);
});

test('座標が数値でなければ弾く', () => {
  const plan = okPlan();
  plan.walls[0].x1 = 'ひだり';
  const r = validatePlan(plan);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /^walls\[0\]/, '何番目の壁かが分かること');
});

test('単位を取り違えた座標(メートルのつもりで1000倍)は弾く', () => {
  const plan = okPlan();
  plan.walls[0].x2 = LIMITS.COORD_MM * 2;
  assert.equal(validatePlan(plan).ok, false);
});

test('長さゼロの壁は弾く（面が張れない）', () => {
  const plan = okPlan();
  plan.walls[0].x2 = 0; plan.walls[0].y2 = 0;
  const r = validatePlan(plan);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /始点と終点が同じ/);
});

test('壁の厚みは範囲で見る。無いときは既定値で読む（警告どまり）', () => {
  const thin = okPlan(); thin.walls[0].thick = 1;
  assert.equal(validatePlan(thin).ok, false);
  const fat = okPlan(); fat.walls[0].thick = 5000;
  assert.equal(validatePlan(fat).ok, false);
  const none = okPlan(); delete none.walls[0].thick;
  const r = validatePlan(none);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /厚みが無いので既定値/);
});

test('階は1〜5の整数。0始まりや小数は弾く', () => {
  for (const bad of [0, 6, 1.5, '2階']) {
    const plan = okPlan(); plan.rooms[0].floor = bad;
    assert.equal(validatePlan(plan).ok, false, bad + ' が通ってしまった');
  }
  const omitted = okPlan(); delete omitted.items[0].floor;
  assert.equal(validatePlan(omitted).ok, true, '省略は1階とみなすので通る');
  assert.equal(normalizePlan(omitted).items[0].floor, 1);
});

test('物は type が要る。幅・奥行きは省略できる（種類ごとの既定値があるので）', () => {
  const noType = okPlan(); delete noType.items[0].type;
  assert.equal(validatePlan(noType).ok, false);
  const noSize = okPlan(); delete noSize.items[0].w; delete noSize.items[0].d;
  assert.equal(validatePlan(noSize).ok, true);
});

test('id の重複は弾く（片方を動かすともう片方も動く）', () => {
  const plan = okPlan();
  plan.walls[1].id = 'w1';
  const r = validatePlan(plan);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /重複/);
});

test('見慣れない種類は「読み込めるが箱で描かれる」として警告にとどめる', () => {
  const plan = okPlan();
  plan.items.push({ id: 'i2', floor: 1, type: 'mystery-thing', x: 0, y: 0 });
  const bare = validatePlan(plan);
  assert.equal(bare.ok, true);
  assert.equal(bare.warnings.filter(w => /見慣れない/.test(w)).length, 0, '一覧を渡さなければ種類は見ない');
  const checked = validatePlan(plan, { knownItemTypes: new Set(['kitchen']) });
  assert.equal(checked.ok, true, '種類が分からないだけで読み込みを止めてはいけない');
  assert.match(checked.warnings.join(), /mystery-thing/);
});

test('壁が1本も無いプランは、読めるが警告する', () => {
  const plan = okPlan({ walls: [] });
  const r = validatePlan(plan);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /壁が1本も無い/);
});

test('均しても、アプリ側が既定値を入れる欄には触らない', () => {
  const plan = okPlan();
  plan.exteriorWallSettings = { 1: { color: '#fff' } };
  plan.walls[0].color = '#abc';
  const n = normalizePlan(plan);
  assert.deepEqual(n.exteriorWallSettings, { 1: { color: '#fff' } }, 'プラン全体の設定はそのまま運ぶ');
  assert.equal(n.walls[0].color, '#abc', '色やテクスチャは触らない');
  assert.equal(n.walls[0].thick, 120);
});

test('id が無いものには連番を振る（既にあるものは変えない）', () => {
  const plan = okPlan();
  delete plan.rooms[0].id;
  plan.items.push({ floor: 1, type: 'sofa', x: 100, y: 100 });
  const n = normalizePlan(plan);
  assert.ok(n.rooms[0].id, 'id が入る');
  assert.ok(n.items[1].id);
  assert.notEqual(n.rooms[0].id, n.items[1].id, '振った id どうしがぶつからない');
  assert.equal(n.walls[0].id, 'w1', '元から在る id は変えない');
});

test('要約は取り込み結果を一行で見せられる', () => {
  const s = summarize(okPlan());
  assert.deepEqual(s, { walls: 2, rooms: 1, items: 1, floors: [1] });
});

// ── 門番が厳しすぎないことの確認 ────────────────────────────────────
//
// 出荷している assets/default_plan.json はここでは読まない(fixture-only の
// 決まり)。あちらは build.sh から tools/check_plan_schema.cjs で見ている。
test('テスト用に凍結した間取りは1件も error を出さずに通る', () => {
  const plan = JSON.parse(readFileSync(join(ROOT, 'tools', 'tests', 'fixtures', 'house-2f.json'), 'utf8'));
  const r = validatePlan(plan);
  assert.deepEqual(r.errors, [], '実物が弾かれるなら、それは検査側の不良');
  assert.equal(r.ok, true);
  // 壁41本・部屋27室・物219件の、実際に建つ間取り。ここが通るなら
  // 門番が現実離れして厳しいということはない。
  const s = summarize(plan);
  assert.ok(s.walls > 20 && s.rooms > 10 && s.items > 100, '足場として十分な大きさの間取りであること');
});

// ── 床材を floorMaterial の1つの欄に寄せる(normalizeFloorMaterials) ───────────────
// 古い形は部屋の texture に床材のキーを書いていた。描画(index.html の roomFloorMaterialKey)は texture の床材のキーを
// floorMaterial より先に読むので、floorMaterial だけを書く経路で床を変えても画面の床が変わらなかった(2026-11-25)。
// 寄せた後も描く床が同じであることは、互換の検査(plan-compat.browser.mjs の floorFinish)が画面で見ている。
test('床材のキーの texture は floorMaterial へ移り、texture は消える', () => {
  const plan = { walls: [], items: [], rooms: [
    { id: 'a', n: '洋室', texture: 'wood_oak', textureFlipX: true, floorColor: '#ff0000' },
    { id: 'b', n: 'LDK', texture: 'tile_floor', floorMaterial: 'wood_floor' },   // 両方: 今の描画で勝つ texture を採る
    { id: 'c', n: '玄関', texture: 'porch_tile', floorMaterial: 'wood_oak' },    // 床の画像は触らない
    { id: 'd', n: '寝室', floorMaterial: 'kominka_tatami' },                      // 新しい形はそのまま
    { id: 'e', n: '浴室', texture: 'data:image/png;base64,AAAA' },                // アップロード画像はそのまま
    { id: 'f', n: '物置', texture: 'toString' },                                  // 継承の名前は床材のキーではない
  ] };
  assert.equal(PlanSchema.normalizeFloorMaterials(plan), 2);
  assert.deepEqual(plan.rooms[0], { id: 'a', n: '洋室', textureFlipX: true, floorColor: '#ff0000', floorMaterial: 'wood_oak' });
  assert.deepEqual(plan.rooms[1], { id: 'b', n: 'LDK', floorMaterial: 'tile_floor' });
  assert.deepEqual(plan.rooms[2], { id: 'c', n: '玄関', texture: 'porch_tile', floorMaterial: 'wood_oak' });
  assert.deepEqual(plan.rooms[3], { id: 'd', n: '寝室', floorMaterial: 'kominka_tatami' });
  assert.equal(plan.rooms[4].texture, 'data:image/png;base64,AAAA');
  assert.equal(plan.rooms[5].texture, 'toString');
});

test('床材の寄せは何度走っても同じ結果で、済みの印を書かない', () => {
  const plan = { walls: [], items: [{ id: 1, type: 'custom-block', texture: 'wood_oak' }], rooms: [{ id: 'a', texture: 'wood_oak' }] };
  PlanSchema.normalizeFloorMaterials(plan);
  const once = JSON.stringify(plan);
  assert.equal(PlanSchema.normalizeFloorMaterials(plan), 0);
  assert.equal(JSON.stringify(plan), once);
  assert.equal(plan.items[0].texture, 'wood_oak', '部屋でない物の texture は触らない');
  assert.deepEqual(Object.keys(plan).sort(), ['items', 'rooms', 'walls'], 'プランに印の欄を足さない');
  // 壊れた形でも例外にしない
  [null, 1, 'x', [], { rooms: 'x' }, { rooms: [null, 1, 'x', []] }].forEach((p) => assert.equal(PlanSchema.normalizeFloorMaterials(p), 0));
});

test('凍結した間取りでは、寄せて変わるのは床材の欄の移動だけ', () => {
  const files = ['compat/saved-2f.json', 'compat/saved-3f.json', 'compat/legacy-quirks.json', 'compat/legacy-no-heights.json',
    'house-2f.json', 'review23-house-2f.json', 'raised-floor-plan.json'];
  let moved = 0;
  for (const f of files) {
    const raw = readFileSync(join(ROOT, 'tools', 'tests', 'fixtures', f), 'utf8');
    const plan = JSON.parse(raw);
    moved += PlanSchema.normalizeFloorMaterials(plan);
    const expect = JSON.parse(raw);
    expect.rooms.forEach((r) => {
      if (PlanSchema.FLOOR_MATERIAL_KEYS.indexOf(r.texture) >= 0) { r.floorMaterial = r.texture; delete r.texture; }
    });
    assert.deepEqual(plan, expect, f);
  }
  assert.ok(moved >= 100, '古い形の部屋が凍結した間取りに十分あること(' + moved + ')');
});
