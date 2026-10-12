// 比較モード（2つの間取りを左右に並べて、どちらも編集する）を、実物のページで通す。
//
// 見るもの: 3つの選び方で右が開く／右を本当にクリック・キー操作して編集しても左は変わらない／Undo は側ごと／
// 右の「保存」はブラウザの保存枠（左の物）を上書きせず JSON に書き出す／名前がファイル名になる／
// 書き出していない右をやめるときにたずねる／3D では編集中の側だけ／比較をやめると元の1画面。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP + '?preset=2f');
  await page.waitForSelector('#compare-btn', { timeout: 60000 });
  await page.waitForTimeout(800);
  const count = () => page.evaluate(() => ({ items: DATA.items.length, walls: DATA.walls.length, hist: HISTORY.length }));
  const left0 = await count();

  // 選ぶ画面に3つの選び方が出る。「今のプランを複製」で始める
  await page.click('#compare-btn');
  const choices = await page.locator('.compare-choice strong').allTextContents();
  assert.deepEqual(choices, ['今のプランを複製', 'JSON ファイルを開く', 'ブラウザに保存したプラン']);
  await page.click('.compare-choice >> nth=0');
  await page.waitForSelector('#c2d-peer');
  assert.equal(await page.evaluate(() => CompareMode.activeSide()), 0);

  // 右の図面をクリックすると右が編集中になる（本物の図面と描くだけの図面が入れ替わる）
  const peer = await page.locator('#c2d-peer').boundingBox();
  await page.mouse.click(peer.x + peer.width / 2, peer.y + peer.height * 0.4);
  assert.equal(await page.evaluate(() => CompareMode.activeSide()), 1);
  const c2d = await page.locator('#c2d').boundingBox();
  assert.ok(Math.abs(c2d.x - peer.x) < 2, '右を押しても本物の図面が右へ移っていない');

  // 右で家具を1つ選んで Delete（画面の座標で選ぶ）
  const target = await page.evaluate(() => {
    const it = DATA.items.find((i) => i.floor === ST.floor && i.type === 'car') || DATA.items.find((i) => i.floor === ST.floor && i.w > 800 && i.d > 800 && !/site|foundation|road|neighbor/.test(i.type));
    const r = canvas.getBoundingClientRect(), p = w2c(it.x + it.w / 2, it.y + it.d / 2);
    return { id: it.id, x: r.left + p.cx, y: r.top + p.cy };
  });
  await page.mouse.click(target.x, target.y);
  const picked = await page.evaluate(() => ST.selected && ST.selected.id);
  assert.equal(picked, target.id, '右の図面で家具を選べない');
  await page.keyboard.press('Delete');
  const right1 = await count();
  assert.equal(right1.items, left0.items - 1);
  assert.equal(await page.evaluate(() => CompareMode.isDirty(1)), true);

  // 左は変わっていない。Undo は側ごと
  await page.evaluate(() => CompareMode.activate(0));
  assert.deepEqual(await count(), left0, '右の編集が左に混ざった');
  await page.evaluate(() => CompareMode.activate(1));
  await page.evaluate(() => undoAction());
  assert.equal((await count()).items, left0.items, '右の Undo が効かない');
  await page.evaluate(() => { saveState(); DATA.items.pop(); draw2d(); });

  // 名前を付ける（Undo できる操作として入る）。右の「保存」は JSON に書き出し、ブラウザの保存枠は触らない
  await page.fill('.compare-frame >> nth=1 >> .compare-name', 'LDK拡張案');
  await page.press('.compare-frame >> nth=1 >> .compare-name', 'Enter');
  assert.equal(await page.evaluate(() => DATA.planName), 'LDK拡張案');
  const stored0 = await page.evaluate(async () => JSON.stringify(await StorageAdapter.load()));
  const dl = page.waitForEvent('download');
  await page.click('#save-btn');
  const file = await dl;
  assert.match(file.suggestedFilename(), /^LDK拡張案_\d{8}\.json$/);
  assert.equal(await page.evaluate(async () => JSON.stringify(await StorageAdapter.load())), stored0, '右の保存がブラウザの保存枠を上書きした');
  assert.equal(await page.evaluate(() => CompareMode.isDirty(1)), false, '書き出したのに未書き出しのまま');

  // 3D では編集中の側だけ。2D に戻ると左右に戻る
  await page.evaluate(() => setView('3d-ext'));
  assert.equal(await page.locator('#c2d-peer').isHidden(), true);
  await page.evaluate(() => setView('2d'));
  assert.equal(await page.locator('#c2d-peer').isVisible(), true);

  // 書き出していない右をやめるときはたずねる。「続ける」で残り、「書き出さずにやめる」で1画面へ
  await page.evaluate(() => { saveState(); DATA.items.pop(); draw2d(); });
  await page.click('.compare-stop');
  await page.waitForSelector('#compare-modal');
  await page.click('#compare-modal button:has-text("比較を続ける")');
  assert.equal(await page.evaluate(() => CompareMode.isOn()), true);
  await page.click('.compare-stop');
  await page.click('#compare-modal button:has-text("書き出さずにやめる")');
  const after = await page.evaluate(() => ({ on: CompareMode.isOn(), peer: !!document.getElementById('c2d-peer'),
    width: canvas.width, area: document.getElementById('canvas-area').clientWidth, items: DATA.items.length }));
  assert.deepEqual(after, { on: false, peer: false, width: after.area, area: after.area, items: left0.items });

  // ブラウザに保存したプラン・JSON ファイルからも右に開ける
  await page.evaluate(() => savePlanToStorage());
  await page.waitForTimeout(500);
  await page.click('#compare-btn');
  await page.click('.compare-choice >> nth=2');
  await page.waitForSelector('#c2d-peer');
  await page.evaluate(() => CompareMode.stop());
  await page.click('#compare-btn');
  const chooser = page.waitForEvent('filechooser');
  await page.click('.compare-choice >> nth=1');
  await (await chooser).setFiles(await file.path());
  await page.waitForSelector('#c2d-peer');
  await page.evaluate(() => CompareMode.activate(1));
  assert.equal(await page.evaluate(() => DATA.planName), 'LDK拡張案');
  await page.evaluate(() => CompareMode.stop());

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('比較モード: 3つの開き方・左右の独立した編集と Undo・右の書き出し・やめるときの確認・3D の扱いが通った');
} finally {
  await browser.close();
}
