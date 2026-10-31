// 「地面に置く印」（groundLevel）の付いたカタログのモデルを、部屋の中に手で置いたとき。
//
// なぜ在るのか
// ------------
// 洗濯機・洗濯パン・物干し・壁掛けエアコン・卓上の小物にも、門柱や庭木と同じ「地面に置く」印が
// 付いていた。手で置くと1階の地面（床より基礎と床の厚みぶん下）に置かれて床に埋まり、2階以上には
// 置けなかった（2026-10-23 利用者の指摘「洗濯機の高さが潰れる」、読み取りは PR #111 で直した）。
// 印は保存プランの見た目を変えないよう書き換えず、部屋の中に置いた物にだけ indoor を持たせる。
//   - 部屋の中に置くと、その部屋の床に立つ。2階の部屋にも置ける
//   - 部屋の外（庭）に置いた物は、これまでどおり地面
//   - 載せる床を「自動」に選び直しても、地面へ落ちない
//   - indoor を持たない保存済みの物は、これまでと同じ高さ（保存プランの見た目を変えない）
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.DATA && window.getFmpItem && getFmpItem('original-washer-drum'), null, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const m = document.getElementById('preset-choice-modal'); if (m) m.classList.remove('show');
    DATA.walls = []; DATA.items = [];
    DATA.rooms = [1, 2].map((fl) => ({ id: 'rm_t' + fl, type: 'room', x: 0, y: 0, w: 3000, d: 3000, floor: fl, n: '洗面脱衣室', floorRaiseMm: newRoomFloorRaiseMm(fl) }));
    const mm = (y) => Math.round(y / U);
    const place = (type, floor, x, y) => {
      ST.floor = floor; placeItem(type, x, y);
      const it = ST.selected && ST.selected.type === type ? ST.selected : null;
      return it && { floor: it.floor, indoor: it.indoor, elev: it.elev || 0, baseMm: mm(item3DBaseY(it)) };
    };
    const room1 = mm(roomFloorTopY(DATA.rooms[0])), room2 = mm(roomFloorTopY(DATA.rooms[1]));
    const washer1 = place('original-washer-drum', 1, 1500, 1500);
    const washer2 = place('original-washer-drum', 2, 1500, 1500);
    const mailboxOut = place('original-mailbox', 1, 6000, 1500);
    const ground = mm(groundYForItem(DATA.items[DATA.items.length - 1]));
    // 載せる床を「自動」に選び直しても、室内のまま。
    const w = DATA.items.find((i) => i.type === 'original-washer-drum' && i.floor === 1);
    ST.selected = w; updateSelectedBaseFloor('auto');
    const afterAuto = { indoor: w.indoor, baseMm: mm(item3DBaseY(w)) };
    // 保存済みの物（indoor なし）は、これまでどおり地面の高さ。
    const saved = mkItem('original-washer-drum', 1200, 1200, 0, 1);
    const savedMm = mm(item3DBaseY(saved));
    // 卓上の小物は、既定の高さ（天板 720mm）を床から測る。
    const books = place('original-books-stack', 1, 800, 800);
    return { room1, room2, ground, washer1, washer2, mailboxOut, afterAuto, savedMm, books, booksDefault: getFmpItem('original-books-stack').defaultElevation };
  });
  assert.ok(r.room1 - r.ground > 300, '地面と床の差がある間取りで確かめている: ' + JSON.stringify(r));
  assert.deepEqual(r.washer1 && [r.washer1.floor, r.washer1.indoor, r.washer1.baseMm], [1, true, r.room1], '1階の部屋に置いた洗濯機は床に立つ: ' + JSON.stringify(r.washer1));
  assert.deepEqual(r.washer2 && [r.washer2.floor, r.washer2.indoor, r.washer2.baseMm], [2, true, r.room2], '2階の部屋にも置ける: ' + JSON.stringify(r.washer2));
  assert.deepEqual(r.mailboxOut && [r.mailboxOut.floor, r.mailboxOut.indoor, r.mailboxOut.baseMm], [1, undefined, r.ground], '部屋の外の門柱は地面のまま: ' + JSON.stringify(r.mailboxOut));
  assert.deepEqual(r.afterAuto, { indoor: true, baseMm: r.room1 }, '「自動」に選び直しても床に立つ');
  assert.equal(r.savedMm, r.ground, '保存済みの物（indoor なし）の高さは変えない');
  assert.equal(r.books.baseMm, r.room1, '卓上の小物も床を基準にする');
  assert.ok(r.books.elev <= r.booksDefault, '卓上の小物の高さが床から測った値: ' + JSON.stringify(r.books));
  assert.deepEqual(errors, []);
  console.log('ground-model-indoor: ok');
} finally {
  await browser.close();
}
