// 床に置く薄い物（血痕・割れたガラス）が、床の仕上げ面の下に埋まらない。
//
// 床の仕上げ面は床の高さより 4mm 上に貼ってある（ROOM_FLOOR_FINISH_LIFT_M）。以前は家具を床の高さに
// 立てていたので、厚さ1mmの血痕・4mmのガラス片は仕上げ面の下に隠れて見えなかった。
//
// モデル(GLB)の読み込みは待たない。ヘッドレスでは読み込みが詰まることがあり、検査が時間切れになった。
// 家具を3Dに置く処理(buildItem3D)が決めた位置を、まとめ描画へ渡すところで受け取って測る。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP + '?preset=2f');
  await page.waitForFunction(() => window.DATA && DATA.walls.length > 4 && window.FMP_ITEMS && getFmpItem('rpg-mansion-clue-stain-01'), null, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const room = DATA.rooms.find((x) => x.n === 'ダイニング' && x.floor === 1);
    const surface = roomFloorTopY(room) + ROOM_FLOOR_FINISH_LIFT_M;
    const items = [['rpg-mansion-clue-stain-01', 300], ['rpg-mansion-glass-shards-01', 1000]].map(([type, dx]) => {
      const f = getFmpItem(type);
      return mkItem(type, room.x + dx, room.y + 300, 0, 1, f.w, f.d);
    });
    const got = [];
    const ensure = window.ensureGltfModel, queue = window.queueFmpInstance;
    window.ensureGltfModel = () => true;
    window.queueFmpInstance = (url, it, grp) => { got.push({ it, y: grp.position.y }); return true; };
    try { items.forEach((it) => buildItem3D(it)); } finally { window.ensureGltfModel = ensure; window.queueFmpInstance = queue; }
    return got.map((g) => {
      const h = getFmpItem(g.it.type).h;
      return { type: g.it.type, bottomMm: +((g.y - surface) * 1000).toFixed(2), topMm: +((g.y - surface) * 1000 + h).toFixed(2) };
    });
  });
  assert.equal(r.length, 2, '血痕・ガラス片が3Dに置かれていない: ' + JSON.stringify(r));
  for (const x of r) {
    assert.ok(x.bottomMm >= 0, `${x.type} が床の仕上げ面より下にある (${x.bottomMm}mm)`);
    assert.ok(x.topMm > 0.5, `${x.type} が床の仕上げ面より上に出ていない (${x.topMm}mm)`);
  }
  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('床に置く薄い物: ' + r.map((x) => `${x.type} ${x.bottomMm}〜${x.topMm}mm`).join('、'));
} finally {
  await browser.close();
}
