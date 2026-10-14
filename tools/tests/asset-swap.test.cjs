// 置いてある家具の一括差し替えで、「どれを何に替えるか」の決め方。
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../assets/js/asset-swap.js');

const cat = [
  { id: 'set-chair-a', kind: 'chair', name: '椅子A', w: 500, d: 520, h: 950 },
  { id: 'set-chair-b', kind: 'chair', name: '肘掛け椅子', w: 850, d: 850, h: 1100 },
  { id: 'set-curtain', kind: 'curtain', name: 'カーテン', w: 1300, d: 150, h: 2000 },
  { id: 'set-frame-s', kind: 'wall-decor', name: '小さな額', w: 660, d: 75, h: 900 },
  { id: 'set-frame-l', kind: 'wall-decor', name: '大きな額', w: 1400, d: 70, h: 900 },
  { id: 'set-table', kind: 'dining-table', name: '食卓', w: 1600, d: 900, h: 750 },
  { id: 'set-sink', kind: 'kitchen-sink', name: '流し台', w: 900, d: 650, h: 1160 },
  { id: 'set-range', kind: 'cooktop', name: 'レンジ', w: 750, d: 650, h: 860 },
  { id: 'set-base-600', kind: 'kitchen-storage', name: '戸棚600', w: 600, d: 600, h: 900 },
  { id: 'set-corner', kind: 'kitchen-storage', name: 'コーナー戸棚', w: 900, d: 900, h: 900 },
  { id: 'set-box', kind: 'laundry', name: 'ランドリーボックス', w: 600, d: 500, h: 850 },
  { id: 'set-radiator', kind: 'hvac', name: 'ラジエーター', w: 1160, d: 280, h: 705 },
  { id: 'set-old', kind: 'chair', name: '旧版', w: 500, d: 520, h: 950, retired: true },
];
const swap = {
  typeKinds: { washer: 'laundry' },
  prefer: { washer: ['set-missing', 'set-box'] },
  standIns: { tv: { ids: ['set-frame-s', 'set-frame-l'], liftMm: 120 } },
  stretchKinds: ['curtain'],
  looseKinds: ['wall-decor'],
  expand: { 'table-set': { chair: 'set-chair-a' }, 'kitchen-unit': { minWidth: 1200 } },
};
const mounts = { 'std-aircon': 'wall', 'std-chair': 'floor' };
const kinds = { 'std-aircon': 'hvac', 'std-chair': 'chair', 'std-curtain': 'curtain', 'std-tv': 'tv', 'std-tableset': 'table-set', 'std-kitchen': 'kitchen-unit', 'std-fridge': 'refrigerator' };
const ctx = { setId: 'set', catalogue: cat, swap, kindOf: (t) => kinds[t] || null, mountOf: (t) => mounts[t] || null };
const item = (id, type, w, d, rot = 0, extra = {}) => ({ id, type, x: 1000, y: 2000, w, d, rot, floor: 1, ...extra });
const one = (it) => S.plan([it], ctx)[0];

test('同じ分類で大きさの近い物に替える（カタログから外した旧版は使わない）', () => {
  const r = one(item(1, 'std-chair', 480, 500));
  assert.equal(r.action, 'swap');
  assert.equal(r.parts[0].type, 'set-chair-a');
  const big = one(item(2, 'std-chair', 900, 880));
  assert.equal(big.parts[0].type, 'set-chair-b');
});

test('位置は元の中心のまま、大きさも元のまま（替えた物を元の幅・奥行に合わせる）', () => {
  const r = one(item(1, 'std-chair', 480, 500));
  assert.equal(r.parts[0].cx, 1000 + 240);
  assert.equal(r.parts[0].cy, 2000 + 250);
  assert.equal(r.parts[0].w, 480);
  assert.equal(r.parts[0].d, 500);
  assert.equal(r.parts[0].h, 950, '高さは替え先の実物の高さ（台の上の物の高さ合わせに使う）');
});

test('大きさが合う物が無ければ替えない（小型家電が戸棚になるのを防ぐ）', () => {
  const r = one(item(1, 'std-chair', 150, 150));
  assert.equal(r.action, 'keep');
  assert.match(r.reason, /大きさ/);
});

test('幅は幅、奥行は奥行で比べる（縦長のソファが横長の長椅子になって形が崩れない）', () => {
  const cat2 = [{ id: 'set-bench', kind: 'sofa', name: '長椅子', w: 1800, d: 800, h: 750 }];
  const ctx2 = { setId: 'set', catalogue: cat2, swap: {}, kindOf: () => 'sofa' };
  // 715 幅 × 1287 奥行の縦長ソファ。長辺どうしなら 1800/1287 で通るが、幅は 2.5 倍になる
  assert.equal(S.plan([item(1, 'std-sofa', 715, 1287)], ctx2)[0].action, 'keep');
  assert.equal(S.plan([item(2, 'std-sofa', 1200, 983)], ctx2)[0].action, 'swap');
});

test('決め打ちの物（人力車・たらい）は実物の形を保ち、元より大きい軸だけ縮める', () => {
  const r = one(item(1, 'washer', 500, 640));
  assert.equal(r.parts[0].w, 500, '幅は元の 500 に縮める');
  assert.equal(r.parts[0].d, 500, '奥行は実物の 500 のまま（元の 640 より小さい）');
});

test('飾る物（照明・額など）も3倍を超える大きさの物には替えない（小鉢が盆栽に、花瓶が衝立にならない）', () => {
  const cat2 = [{ id: 'set-screen', kind: 'decor', name: '衝立', w: 1200, d: 350, h: 1200 }];
  const ctx2 = { setId: 'set', catalogue: cat2, swap: { looseKinds: ['decor'] }, kindOf: () => 'decor' };
  assert.equal(S.plan([item(1, 'std-vase', 270, 209)], ctx2)[0].action, 'keep');
  assert.equal(S.plan([item(2, 'std-bowl', 500, 300)], ctx2)[0].action, 'swap');
});

// 台の上の物（卓上のランプ・洗面台の上の洗面ボウル・カウンターの IH）
const surfaceCat = [
  { id: 'set-zataku', kind: 'low-table', name: '座卓', w: 1500, d: 900, h: 330 },
  { id: 'set-andon', kind: 'light', name: '行灯', w: 300, d: 300, h: 800 },
  { id: 'set-pendant', kind: 'light', name: 'ペンダント', w: 500, d: 500, h: 400, defaultElevation: 2000 },
  { id: 'set-washstand', kind: 'vanity', name: '洗面台', w: 700, d: 450, h: 850 },
  { id: 'set-kamado', kind: 'cooktop', name: '竈', w: 750, d: 650, h: 800 },
  { id: 'set-counter', kind: 'kitchen-storage', name: '調理台', w: 600, d: 600, h: 800 },
];
const surfaceKinds = { 'std-table': 'low-table', 'std-lamp': 'light', 'std-vanity': 'vanity', 'std-basin': 'vanity', 'std-ih': 'cooktop', 'std-cabinet': 'kitchen-storage', 'std-microwave': 'cooking-appliance' };
const surfaceMounts = { 'std-lamp': 'tabletop', 'std-basin': 'builtin', 'std-ih': 'builtin', 'std-microwave': 'builtin' };
const surfaceH = { 'std-table': 626, 'std-lamp': 415, 'std-vanity': 695, 'std-basin': 264, 'std-ih': 52, 'std-cabinet': 850, 'std-microwave': 292 };
const surfaceCtx = { setId: 'set', catalogue: surfaceCat, swap: { looseKinds: ['light'] }, kindOf: (t) => surfaceKinds[t] || null, mountOf: (t) => surfaceMounts[t] || 'floor', heightOf: (t) => surfaceH[t] || 0 };
// 台 (x 1000..2200, y 2000..2600) の上の物
const table = (id = 1) => ({ id, type: 'std-table', x: 1000, y: 2000, w: 1200, d: 600, rot: 0, floor: 1 });
const onTable = (id, type, w, d, elev) => ({ id, type, x: 1500, y: 2200, w, d, rot: 0, floor: 1, elev });

test('台の上のランプは、台が低い座卓に替わると一緒に下りる（宙に浮かない）。天井吊りのペンダントは選ばない', () => {
  const rows = S.plan([table(), onTable(2, 'std-lamp', 245, 239, 626)], surfaceCtx);
  const lamp = rows.find((r) => r.id === 2);
  assert.equal(lamp.action, 'swap');
  assert.equal(lamp.parts[0].type, 'set-andon');
  assert.equal(lamp.parts[0].elev, 330, '座卓の天端 330 に載る');
});

test('台が替わらなくても、台の上の物が替わるなら元の高さのまま', () => {
  const ctx2 = { ...surfaceCtx, catalogue: surfaceCat.filter((c) => c.kind !== 'low-table') };
  const rows = S.plan([table(), onTable(2, 'std-lamp', 245, 239, 626)], ctx2);
  assert.equal(rows.find((r) => r.id === 1).action, 'keep');
  assert.equal(rows.find((r) => r.id === 2).parts[0].elev, 626);
});

test('台の上の物が替わらなくても、台が替わるなら高さだけ台に合わせる', () => {
  const rows = S.plan([{ ...table(), type: 'std-cabinet', w: 900, d: 600 }, onTable(2, 'std-microwave', 466, 391, 850)], surfaceCtx);
  const mw = rows.find((r) => r.id === 2);
  assert.equal(mw.action, 'adjust');
  assert.equal(mw.parts[0].elev, 800, '調理台の天端 800 に下ろす');
});

test('台の上の物には、台に載る大きさの物しか選ばない（カウンターの IH が竈になって宙に浮かない）', () => {
  const rows = S.plan([{ ...table(), type: 'std-cabinet', w: 900, d: 600 }, onTable(2, 'std-ih', 572, 507, 850)], surfaceCtx);
  const ih = rows.find((r) => r.id === 2);
  assert.equal(ih.action, 'adjust', '竈には替えず、調理台の天端に合わせるだけ');
  assert.equal(ih.parts[0].elev, 800);
});

test('台と同じ分類の物（洗面台の上の洗面ボウル）は、替え先の台に含まれるとみなして外す', () => {
  const rows = S.plan([{ ...table(), type: 'std-vanity' }, onTable(2, 'std-basin', 644, 435, 695)], surfaceCtx);
  assert.equal(rows.find((r) => r.id === 1).parts[0].type, 'set-washstand');
  const basin = rows.find((r) => r.id === 2);
  assert.equal(basin.action, 'remove');
  assert.equal(S.summary(rows).remove, 1);
});

test('卓上の物の既定の高さ（机の高さ 740）は吊り物ではない: 台の上のランプは卓上ランプに替わる', () => {
  const cat2 = [
    { id: 'set-table-lamp', kind: 'light', name: '卓上ランプ', w: 234, d: 222, h: 477, defaultElevation: 740 },
    { id: 'set-pendant', kind: 'light', name: 'ペンダント', w: 250, d: 250, h: 400, defaultElevation: 1960 },
  ];
  const rows = S.plan([table(), onTable(2, 'std-lamp', 245, 239, 626)], { ...surfaceCtx, catalogue: cat2 });
  assert.equal(rows.find((r) => r.id === 2).parts[0].type, 'set-table-lamp');
});

test('壁の物を床置きの物に替えるとき、下ろす先に別の家具があれば替えない（壁付け戸棚の下の机）', () => {
  const cat2 = [{ id: 'set-chest', kind: 'cabinet', name: '箪笥', w: 900, d: 450, h: 900 }];
  const kinds2 = { 'std-wallcab': 'cabinet', 'std-desk': 'desk' };
  const ctx2 = { setId: 'set', catalogue: cat2, swap: {}, kindOf: (t) => kinds2[t] || null, mountOf: () => 'floor', heightOf: (t) => (t === 'std-desk' ? 720 : 800) };
  const wallcab = { id: 1, type: 'std-wallcab', x: 1000, y: 2000, w: 750, d: 300, rot: 0, floor: 1, elev: 1600 };
  const desk = { id: 2, type: 'std-desk', x: 900, y: 2000, w: 1200, d: 600, rot: 0, floor: 1 };
  const blocked = S.plan([wallcab, desk], ctx2).find((r) => r.id === 1);
  assert.equal(blocked.action, 'keep');
  assert.match(blocked.reason, /重なる/);
  const free = S.plan([wallcab, { ...desk, x: 3000 }], ctx2).find((r) => r.id === 1);
  assert.equal(free.action, 'swap');
  assert.equal(free.parts[0].elev, 0, '下に何も無ければ床へ下ろす');
});

test('段差や台座の上の低い高さ（300mm 未満）は床の物として扱い、高さを変えない', () => {
  const cat2 = [{ id: 'set-sink', kind: 'kitchen-sink', name: '流し', w: 900, d: 600, h: 800 }];
  const ctx2 = { setId: 'set', catalogue: cat2, swap: {}, kindOf: () => 'kitchen-sink', mountOf: () => 'builtin', heightOf: () => 837 };
  assert.equal(S.plan([item(1, 'std-sink', 630, 442, 0, { elev: 150 })], ctx2)[0].parts[0].elev, undefined);
});

test('壁掛け → 壁掛けは中心の高さを保ち、天井に食い込む分は下げる（額 → 丈の長い掛け軸）', () => {
  const cat2 = [{ id: 'set-kakejiku', kind: 'wall-decor', name: '掛け軸', w: 550, d: 30, h: 1700, defaultElevation: 400 }];
  const ctx2 = { setId: 'set', catalogue: cat2, swap: { looseKinds: ['wall-decor'] }, kindOf: () => 'wall-decor', mountOf: () => 'wall', heightOf: () => 700, ceilingAt: () => 2400 };
  const r = S.plan([item(1, 'std-painting', 498, 29, 0, { elev: 1100 })], ctx2)[0];
  assert.equal(r.parts[0].elev, 600, '中心 1450 を保つ: 1450 - 850');
  const high = S.plan([item(2, 'std-painting', 498, 29, 0, { elev: 1700 })], ctx2)[0];
  assert.equal(high.parts[0].elev, 2400 - 50 - 1700, '上端が天井の 50mm 下に収まる位置まで下げる');
});

test('札が builtin でも高い位置にある物（レンジフード）は壁掛け扱い: 天井に食い込ませない', () => {
  const cat2 = [{ id: 'set-hood', kind: 'range-hood', name: '煙出し', w: 900, d: 600, h: 700, defaultElevation: 1500 }];
  const ctx2 = { setId: 'set', catalogue: cat2, swap: {}, kindOf: () => 'range-hood', mountOf: () => 'builtin', heightOf: () => 430, ceilingAt: () => 2400 };
  const r = S.plan([item(1, 'std-hood', 610, 590, 0, { elev: 1970 })], ctx2)[0];
  assert.equal(r.parts[0].elev, 2400 - 50 - 700);
});

test('天井吊り → 天井吊りは天井から吊り直す（物干し）', () => {
  const cat2 = [{ id: 'set-pole', kind: 'laundry', name: '竹竿', w: 1100, d: 80, h: 300, defaultElevation: 1700 }];
  const ctx2 = { setId: 'set', catalogue: cat2, swap: {}, kindOf: () => 'laundry', mountOf: () => 'ceiling', heightOf: () => 500, ceilingAt: () => 2400 };
  assert.equal(S.plan([item(1, 'std-hoist', 1100, 80, 0, { elev: 2038 })], ctx2)[0].parts[0].elev, 2100);
});

test('同じ分類が無い物は残す', () => {
  const r = one(item(1, 'std-fridge', 600, 650));
  assert.equal(r.action, 'keep');
  assert.match(r.reason, /置き換えられる物が無い/);
});

test('カーテンは窓に合わせて、元の幅のまま伸ばす', () => {
  const r = one(item(1, 'std-curtain', 2600, 120));
  assert.equal(r.parts[0].type, 'set-curtain');
  assert.equal(r.parts[0].w, 2600);
});

test('洗濯機は決め打ちの候補から、在る物を使う', () => {
  const r = one(item(1, 'washer', 640, 640));
  assert.equal(r.action, 'swap');
  assert.equal(r.parts[0].type, 'set-box');
});

test('テレビは額絵に。幅の近い額を選び、少し高く掛ける', () => {
  const r = one(item(1, 'std-tv', 1230, 211, 0, { elev: 760 }));
  assert.equal(r.action, 'standin');
  assert.equal(r.parts[0].type, 'set-frame-l');
  assert.equal(r.parts[0].elevAdd, 120);
});

test('テーブルセットは食卓と、長い辺の両側の椅子に分ける。椅子は食卓を向く', () => {
  const r = one(item(1, 'std-tableset', 1800, 1700, 90));
  assert.equal(r.action, 'expand');
  const [table, ...chairs] = r.parts;
  assert.equal(table.type, 'set-table');
  assert.equal(chairs.length % 2, 0);
  assert.ok(chairs.length >= 2);
  // 正面は (-sin rot, cos rot)。椅子の正面が食卓の中心の方を向いていること
  for (const c of chairs) {
    const rad = (c.rot * Math.PI) / 180;
    const fx = -Math.sin(rad), fy = Math.cos(rad);
    const tx = table.cx - c.cx, ty = table.cy - c.cy;
    assert.ok(fx * tx + fy * ty > 0, `椅子が食卓を向いていない (rot ${c.rot})`);
  }
});

test('キッチンは流し台・レンジ・戸棚を、元の幅の中に背を揃えて直線に並べる（L字のコーナー物は使わない）', () => {
  const r = one(item(1, 'std-kitchen', 2550, 650));
  assert.equal(r.action, 'expand');
  const types = r.parts.map((p) => p.type);
  assert.ok(types.includes('set-sink') && types.includes('set-range'));
  assert.ok(!types.includes('set-corner'));
  const total = r.parts.reduce((s, p) => s + p.w, 0);
  assert.ok(total <= 2550, `元の幅を超えている (${total})`);
});

test('幅の狭いキッチン（天板の上の小型家電など）は分けない', () => {
  assert.equal(one(item(1, 'std-kitchen', 340, 350)).action, 'keep');
});

test('もうこのセットの物と、カタログの家具でない物（壁・窓・照明など）は一覧に出さない', () => {
  const rows = S.plan([item(1, 'set-chair-a', 500, 520), item(2, 'window', 1690, 150), item(3, 'std-chair', 480, 500)], ctx);
  assert.deepEqual(rows.map((r) => r.id), [3]);
});

test('壁に付いていた物を床置きの物に替えるときは、床へ下ろす（エアコン → ラジエーター）', () => {
  const r = one(item(1, 'std-aircon', 800, 300, 0, { elev: 2000 }));
  assert.equal(r.parts[0].type, 'set-radiator');
  assert.equal(r.parts[0].elev, 0);
});

test('床に置いていた物は、元の高さを書き換えない', () => {
  const r = one(item(1, 'std-chair', 480, 500));
  assert.equal(r.parts[0].elev, undefined);
});

test('カーテン・ロールスクリーンは上端の高さを保つ（丈の違う物に替えても天井を突き抜けない）', () => {
  const cat2 = [{ id: 'set-roller', kind: 'roller-screen', name: '巻き上げ', w: 700, d: 50, h: 1258 }];
  const sw = { stretchKinds: ['roller-screen'], topAlignKinds: ['roller-screen'] };
  const r = S.plan([item(1, 'std-roller', 1690, 50, 0, { elev: 1790 })], {
    setId: 'set', catalogue: cat2, swap: sw, kindOf: () => 'roller-screen', heightOf: () => 250,
  })[0];
  assert.equal(r.parts[0].elev, 1790 + 250 - 1258);
  const low = S.plan([item(1, 'std-roller', 1690, 50, 0, { elev: 300 })], {
    setId: 'set', catalogue: cat2, swap: sw, kindOf: () => 'roller-screen', heightOf: () => 250,
  })[0];
  assert.equal(low.parts[0].elev, 0, '床より下には下げない');
});

test('腰窓の短いカーテンを床までの丈に替えない（窓台に掛かる）', () => {
  const cat2 = [{ id: 'set-long', kind: 'curtain', name: '長いカーテン', w: 1220, d: 150, h: 2065 }];
  const sw = { stretchKinds: ['curtain'], topAlignKinds: ['curtain'], topAlignMaxDropMm: { curtain: 300 } };
  const ctx2 = { setId: 'set', catalogue: cat2, swap: sw, kindOf: () => 'curtain', heightOf: (t) => (t === 'std-short' ? 1350 : 2040) };
  const short = S.plan([item(1, 'std-short', 900, 150, 0, { elev: 690 })], ctx2)[0];
  assert.equal(short.action, 'keep');
  assert.match(short.reason, /丈/);
  const long = S.plan([item(2, 'std-long', 1300, 150, 0, { elev: 0 })], ctx2)[0];
  assert.equal(long.action, 'swap');
  assert.equal(long.parts[0].elev, 0);
});
