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

test('位置は元の中心のまま、大きさは差し替え先の実物の大きさ', () => {
  const r = one(item(1, 'std-chair', 480, 500));
  assert.equal(r.parts[0].cx, 1000 + 240);
  assert.equal(r.parts[0].cy, 2000 + 250);
  assert.equal(r.parts[0].w, 500);
});

test('大きさが合う物が無ければ替えない（小型家電が戸棚になるのを防ぐ）', () => {
  const r = one(item(1, 'std-chair', 150, 150));
  assert.equal(r.action, 'keep');
  assert.match(r.reason, /大きさ/);
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
