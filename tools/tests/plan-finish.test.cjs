// 読み取ったあとの「仕上げ」。
//
// 見ているのは:
//   1. 言葉で決まる部屋は、**モデルに聞かずに**決まっていること
//   2. 聞くのは「洋室(1)」のような、決まらないものだけ
//   3. 足りないものは計算で出ること（ここに Jev を挟まない）
//   4. 提示していないモデルに差し替えないこと
//   5. 置く場所を決めていないこと
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const RoomProgram = require(join(ROOT, 'assets', 'js', 'room-program.js'));

test('言葉で決まる部屋は、表で決める', () => {
  const cases = [
    ['浴室', 'bath'], ['ユニットバス', 'bath'], ['トイレ', 'toilet'], ['WC', 'toilet'],
    ['玄関', 'entry'], ['洗面脱衣室', 'washroom'], ['ランドリー', 'washroom'],
    ['主寝室', 'bedroom'], ['子供部屋', 'kids'], ['和室', 'washitsu'],
    ['LDK', 'ldk'], ['ＬＤＫ', 'ldk'], ['キッチン', 'kitchen'], ['階段', 'stairs'],
    ['ホール', 'hall'], ['WIC', 'wic'], ['バルコニー', 'balcony'], ['書斎', 'study'],
  ];
  for (const [name, want] of cases) {
    assert.equal(RoomProgram.typeFromName(name), want, `${name} が ${want} にならない`);
  }
  // 決まらないものは null。**ここで当てずっぽうに決めない。**
  for (const name of ['洋室', '洋室(1)', '洋室（2）', '居室', '', 'Room 3']) {
    assert.equal(RoomProgram.typeFromName(name), null, `${name} を決め打ちしている`);
  }
});

test('足りないものは計算で出る', () => {
  // 家具ゼロの子供部屋
  const missing = RoomProgram.missingFor('kids', []).map((m) => m.kind);
  assert.ok(missing.includes('bed'), 'ベッドの不足を挙げていない');
  assert.ok(missing.includes('desk'), '机の不足を挙げていない');
  // ベッドと机を置いたら、その2つは消える
  const after = RoomProgram.missingFor('kids', ['bed', 'desk']).map((m) => m.kind);
  assert.ok(!after.includes('bed'));
  assert.ok(!after.includes('desk'));
  // 通路には何も要らない
  assert.deepEqual(RoomProgram.missingFor('hall', []), []);
  // 理由が付いていること（画面にそのまま出る）
  for (const m of RoomProgram.missingFor('ldk', [])) {
    assert.ok(m.why && m.why.length >= 2, `${m.kind} に理由が無い`);
  }
});

test('種別が言葉で決まるとき、Jev を呼ばない', async () => {
  const { nameRooms } = await mod('worker/plan-finish.mjs');
  let calls = 0;
  const aiRun = async () => { calls++; return { answers: { room_type: { choice: 'kids' } } }; };
  const out = await nameRooms([
    { id: 'r0', name: '浴室', floor: 1, area_m2: 3.3 },
    { id: 'r1', name: 'トイレ', floor: 1, area_m2: 1.6 },
  ], {}, { aiRun });
  assert.equal(calls, 0, '言葉で決まる部屋でモデルを呼んでいる');
  assert.deepEqual(out.map((r) => r.type), ['bath', 'toilet']);
  assert.deepEqual(out.map((r) => r.from), ['name', 'name']);
});

test('決まらない部屋だけ聞く。答えが語彙の外なら other に倒す', async () => {
  const { nameRooms } = await mod('worker/plan-finish.mjs');
  let asked = null;
  const out = await nameRooms([
    { id: 'r0', name: '洋室(1)', floor: 2, area_m2: 8.2, tatami: 5.0 },
    { id: 'r1', name: '主寝室', floor: 2, area_m2: 11.9 },
  ], {}, {
    aiRun: async (model, input) => { asked = input; return { answers: { room_type: { choice: 'kids', confidence: 0.6 } } }; },
  });
  assert.equal(out[0].type, 'kids');
  assert.equal(out[0].from, 'jev');
  assert.equal(out[1].from, 'name', '名前で決まる部屋まで聞いている');
  // 同じ階の他の部屋を材料に渡していること
  assert.ok(asked.state.other_rooms_on_this_floor.includes('主寝室'), '階の文脈を渡していない');

  const bad = await nameRooms([{ id: 'r0', name: '洋室', floor: 2 }], {},
    { aiRun: async () => ({ answers: { room_type: { choice: 'ありえない種別' } } }) });
  assert.equal(bad[0].type, 'other', '語彙の外の答えを通している');
});

test('提示していないモデルには差し替えない', async () => {
  const { pickModels } = await mod('worker/plan-finish.mjs');
  const slot = {
    id: 'i3', roomJa: '浴室', roomW: 1820, roomD: 1820, current: 'bath', w: 1600, d: 1600,
    candidates: [
      { id: 'fmp-BathTub01', name: 'BathTub01', w: 1150, d: 526, h: 412 },
      { id: 'fmp-BathTub05', name: 'BathTub05', w: 1600, d: 750, h: 500 },
    ],
  };
  const ok = await pickModels([slot], {}, { aiRun: async () => ({ answers: { pick: { choice: 'fmp-BathTub05', confidence: 0.7 } } }) });
  assert.deepEqual(ok.map((p) => p.model), ['fmp-BathTub05']);

  for (const answer of [{ choice: 'fmp-Nope', confidence: 0.9 }, { choice: 'none', confidence: 0.9 }, { choice: 'fmp-BathTub05', confidence: 0.1 }]) {
    const out = await pickModels([slot], {}, { aiRun: async () => ({ answers: { pick: answer } }) });
    assert.deepEqual(out, [], `${JSON.stringify(answer)} で差し替えている`);
  }
  // 候補が1つしかないときは聞かない（選びようがない）
  let calls = 0;
  await pickModels([{ ...slot, candidates: slot.candidates.slice(0, 1) }], {},
    { aiRun: async () => { calls++; return { answers: { pick: { choice: 'x' } } }; } });
  assert.equal(calls, 0, '候補1つでモデルを呼んでいる');
});

test('窓口は、1回に投げられる判断の数を抑える', async () => {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const call = (body, env) => {
    const url = new URL('https://example.test/api/ai/finish-plan');
    return handleAi(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env || {}, url, {});
  };
  assert.equal((await call({})).status, 400, '空の要求を通している');
  const many = { rooms: Array.from({ length: 41 }, (_, i) => ({ id: 'r' + i, name: '洋室' })) };
  assert.equal((await call(many)).status, 400, '上限を超えた要求を通している');

  // Jev が無い環境でも落ちない（種別は表で決まるぶんだけ返る）
  const res = await call({ rooms: [{ id: 'r0', name: 'LDK', floor: 1, kinds: [] }] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rooms[0].type, 'ldk');
  assert.ok(body.missing[0].missing.some((m) => m.kind === 'sofa'), '足りないものを返していない');
});

test('画面側は、置く場所を決めていない', () => {
  const src = readFileSync(join(ROOT, 'assets', 'js', 'plan-finish.js'), 'utf8');
  // 足りないものは「道具にする」だけ。座標を作って置く処理を持たない。
  assert.match(src, /setTool\(model\)/, '道具として渡していない');
  assert.ok(!/mkItem\(/.test(src), '足りないものを自分で置いている（納まりを決められない）');
  assert.ok(!/DATA\.items\.push/.test(src), '間取りに直接足している');
  // 差し替えは寸法だけ。中心を動かさない。
  assert.ok(!/it\.x\s*=/.test(src) && !/it\.y\s*=/.test(src), '差し替えで位置を動かしている');
});

test('差し替えは、寸法だけを入れ替える', () => {
  global.window = global;
  global.FMP_ITEMS = { 'fmp-BathTub05': { id: 'fmp-BathTub05', name: 'BathTub05', w: 1600, d: 750, h: 500, kind: 'bathtub' } };
  delete require.cache[require.resolve(join(ROOT, 'assets', 'js', 'plan-finish.js'))];
  require(join(ROOT, 'assets', 'js', 'plan-finish.js'));
  const plan = { rooms: [], items: [{ type: 'bath', x: 1000, y: 2000, w: 1600, d: 1600, floor: 1 }] };
  const changed = global.PlanFinish.applyPicks(plan, [{ slot: 'i0', model: 'fmp-BathTub05' }]);
  assert.equal(changed.length, 1);
  assert.equal(plan.items[0].type, 'fmp-BathTub05');
  assert.equal(plan.items[0].w, 1600);
  assert.equal(plan.items[0].d, 750);
  assert.equal(plan.items[0].x, 1000, '位置が動いた');
  assert.equal(plan.items[0].y, 2000, '位置が動いた');
  // 知らないモデルは無視する
  assert.deepEqual(global.PlanFinish.applyPicks(plan, [{ slot: 'i0', model: 'fmp-Nope' }]), []);
});
