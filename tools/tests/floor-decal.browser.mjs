// 床に置く薄い物（血痕・割れたガラス）が、床の仕上げ面の下に埋まらない。
//
// 床の仕上げ面は床の高さより 4mm 上に貼ってある（ROOM_FLOOR_FINISH_LIFT_M）。以前は家具を床の高さに
// 立てていたので、厚さ1mmの血痕・4mmのガラス片は仕上げ面の下に隠れて見えなかった。
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
  await page.evaluate(() => {
    const room = DATA.rooms.find((r) => r.n === 'ダイニング' && r.floor === 1);
    [['rpg-mansion-clue-stain-01', 300], ['rpg-mansion-glass-shards-01', 1000]].forEach(([type, dx]) => {
      const f = getFmpItem(type);
      DATA.items.push(mkItem(type, room.x + dx, room.y + 300, 0, 1, f.w, f.d));
    });
    setView('3d-int');
  });
  // モデルが読めるまで待つ（読めなければ測れないので失敗にする）
  await page.waitForFunction(() => ensureGltfModel(getFmpItem('rpg-mansion-clue-stain-01').model)
    && ensureGltfModel(getFmpItem('rpg-mansion-glass-shards-01').model), null, { timeout: 90000 });
  await page.evaluate(() => rebuild3D());
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const room = DATA.rooms.find((x) => x.n === 'ダイニング' && x.floor === 1);
    const surface = roomFloorTopY(room) + ROOM_FLOOR_FINISH_LIFT_M;
    const out = [];
    const m = new THREE.Matrix4();
    const push = (type, box) => out.push({ type, bottomMm: +((box.min.y - surface) * 1000).toFixed(2), topMm: +((box.max.y - surface) * 1000).toFixed(2) });
    sc3.traverse((o) => {
      if (o.isInstancedMesh) {
        (o.userData.instanceRefs || []).forEach((it, k) => {
          if (!it || !/clue-stain|glass-shards/.test(it.type)) return;
          o.geometry.computeBoundingBox(); o.getMatrixAt(k, m);
          push(it.type, o.geometry.boundingBox.clone().applyMatrix4(m).applyMatrix4(o.matrixWorld));
        });
      } else if (o.userData && o.userData.selectRef && /clue-stain|glass-shards/.test(o.userData.selectRef.type || '') && o.type === 'Group') {
        push(o.userData.selectRef.type, new THREE.Box3().setFromObject(o));
      }
    });
    return out;
  });
  assert.equal(r.length, 2, '血痕・ガラス片が3Dに描かれていない: ' + JSON.stringify(r));
  for (const x of r) {
    assert.ok(x.bottomMm >= 0, `${x.type} が床の仕上げ面より下にある (${x.bottomMm}mm)`);
    assert.ok(x.topMm > 0.5, `${x.type} が床の仕上げ面より上に出ていない (${x.topMm}mm)`);
  }
  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('床に置く薄い物: ' + r.map((x) => `${x.type} ${x.bottomMm}〜${x.topMm}mm`).join('、'));
} finally {
  await browser.close();
}
