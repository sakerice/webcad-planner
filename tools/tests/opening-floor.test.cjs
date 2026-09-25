// 壁の開口(窓・建具)の足元の高さ。
//
// なぜ在るのか
// ------------
// **3階建ての既定プランの掃き出し窓が、792mm沈んで基礎の中にいた。**
//
// 開口は中心が壁の中に来る。部屋の矩形は壁の芯で終わるので、中心が芯を
// わずかに越えると「どの部屋にも入っていない」ことになる。さらに基礎の
// 外周も越えるため、「1階で基礎の外にある物は地面に置く」(ポーチやデッキが
// 浮かないための規則)に捕まって、床上げ150mm・スラブ180mm・基礎450mmを
// まとめて失う。**ずれは10mm。10mmで780mm落ちる。**
//
// 画面はエラーを出さない。寸法の検査にも出ない。**3Dを見るまで分からない。**
// 直したあと、ここが落ちたら同じことがまた起きる。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = require('./app-source.cjs').appSource();
const ROOT = join(__dirname, '..', '..');

function fn(name, scope) {
  const a = html.indexOf('function ' + name + '(');
  assert.notEqual(a, -1, 'function ' + name + ' がソースに無い');
  const b = html.indexOf('\nfunction ', a + 1);
  vm.createContext(scope);
  vm.runInContext(html.slice(a, b), scope);
  return scope[name];
}

/** 部屋1つ(0..3000 x 0..8190、床0.78m)だけの世界。壁の芯は y=8190。 */
function world() {
  const room = { floor: 1, x: 0, y: 0, w: 3000, d: 8190 };
  const scope = {
    itemIsUnderPlatform: () => false,
    baseRoomOf: () => null,           // 載せる床の指定なし(自動)
    stairGroupIsLevel: () => false,
    isGroundLevelItemType: () => false,
    isContextExteriorItemType: () => false,
    isFloorAwareGroundItemType: () => false,
    groundYForItem: () => -0.012,          // 地面(=沈んだときの値)
    // 基礎は建物の外周＝部屋と同じ範囲。**開口の中心は壁の中なので、
    // わずかに基礎の外へ出る。** そこが今回の不具合の入口だった。
    itemOnFoundation: (o) => {
      const x = o.x + o.w / 2, y = o.y + o.d / 2;
      return x >= 0 && x <= 3000 && y >= 0 && y <= 8190;
    },
    roomFloorTopY: () => 0.78,             // 基礎450+スラブ180+床上げ150
    roomAtPointOnFloor: (floor, x, y) =>
      (floor === room.floor && x >= room.x && x <= room.x + room.w
        && y >= room.y && y <= room.y + room.d) ? room : null,
    roomFloorAt: () => 0.78,
    isDoorLikeOpeningType: (t) => t === 'door-swing',
  };
  scope.isWallOpeningItem = fn('isWallOpeningItem', scope);
  scope.openingAdjacentFloorTopY = fn('openingAdjacentFloorTopY', scope);
  return { scope, base: fn('item3DBaseY', scope) };
}

test('中心が部屋から10mmはみ出した掃き出し窓が、地面まで落ちない', () => {
  const { base } = world();
  // 中心 y=8200。部屋の南端8190を10mm越えている(実際に起きた値)。
  const door = { type: 'window-door', floor: 1, x: 560, y: 8110, w: 1690, d: 180, rot: 0 };
  assert.equal(base(door), 0.78,
    '開口が床を見失って地面へ落ちている(基礎の中に沈む)');
});

test('中心が部屋の中にある開口は、これまでどおり', () => {
  const { base } = world();
  const door = { type: 'window-door', floor: 1, x: 560, y: 7775, w: 1690, d: 180, rot: 0 };
  assert.equal(base(door), 0.78);
});

test('開口でない物は、基礎の外なら地面のまま(ポーチ・デッキが浮かない)', () => {
  const { base } = world();
  // **この規則を壊すと、ポーチやアプローチが基礎の高さぶん宙に浮く。**
  assert.equal(base({ type: 'custom-block', floor: 1, x: 0, y: 8300, w: 1800, d: 900 }), -0.012);
});

test('どの部屋にも面していない開口は、従来どおり地面に置く', () => {
  // **面している部屋があるときだけ介入する。** 全部を横取りすると、建物の
  // 外に置いた物置のドアが床の高さまで持ち上がり、地面から630mm浮く。
  // ポーチやデッキが浮かないための既存の規則を壊さないこと。
  const { base } = world();
  assert.equal(base({ type: 'door-swing', floor: 1, x: 20000, y: 20000, w: 780, d: 160, rot: 0 }),
    -0.012, '建物の外の建具が宙に浮いている');
});

test('建具も窓も、開口として扱われる', () => {
  const { scope } = world();
  for (const t of ['window', 'window-door', 'door-swing']) {
    assert.equal(scope.isWallOpeningItem({ type: t }), true, t + ' が開口扱いになっていない');
  }
  assert.equal(scope.isWallOpeningItem({ type: 'original-sofa' }), false);
});

// ── 凍結した間取りで、規則が働く相手が必ず居ること ──────────────────
//
// 開口の両側を見て部屋が1つも見つからなければ、この修正は効かない。
// **出荷する既定間取りは読まない**(tools/tests/fixtures/README.md)。
// 出荷物側は tools/lint_plan.py が見る。
test('凍結した間取りの1階の開口は、すべて面している部屋を持っている', () => {
  // 1階だけを見る。「基礎の外なら地面」に捕まるのは1階だけで、2階以上は
  // 吹き抜けに面した窓のように、その階に部屋が無い場所の開口が正しく在る。
  // 住宅として作られた凍結間取りだけ。raised-floor-plan は段差の検査用に
  // 組んだ合成プランで、部屋に面していない窓を意図的に持っている。
  for (const name of ['house-2f.json', 'review23-house-2f.json']) {
    const plan = JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
    const rooms = plan.rooms || [];
    const orphans = [];
    for (const it of plan.items || []) {
      const t = it.type || '';
      const opening = t === 'window' || t === 'window-door' || /^door-/.test(t);
      if (!opening || (it.floor || 1) !== 1) continue;
      const cx = it.x + it.w / 2, cy = it.y + it.d / 2;
      const along = Math.round(Number(it.rot) || 0) % 180;
      const step = Math.max((it.d || 0) / 2 + 200, 260);
      const pts = along === 0 ? [[cx, cy - step], [cx, cy + step]]
                              : [[cx - step, cy], [cx + step, cy]];
      pts.push([cx, cy]);
      const found = pts.some(([x, y]) => rooms.some((r) => r.floor === it.floor
        && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d));
      if (!found) orphans.push(`${t} ${it.id}`);
    }
    assert.deepEqual(orphans, [], `${name}: どの部屋にも面していない開口がある`);
  }
});
