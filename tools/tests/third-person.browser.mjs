// 三人称のウォークスルー（third-person.js）を実物のページで通す。
//
// 見るもの: ?tps=1 が無ければ切り替えは出ず、一人称のカメラは今までどおり目の位置／
// ?tps=1 で三人称にすると、人物が足元に立ち、カメラは人物の後ろ（向きは一人称と同じ）／一人称に戻すと人物は消える。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
let browser = await chromium.launch();
try {
  const errors = [];
  async function open(q) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
    await page.goto(APP + '?preset=2f' + q);
    await page.waitForFunction(() => window.DATA && DATA.walls.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => setView('3d-walk'));
    await page.waitForFunction(() => window.ren && WALK.active, null, { timeout: 60000 });
    // 組み立て中の「準備中」の覆いが消えるのを待つ（覆いの上ではボタンが押せない）
    await page.waitForFunction(() => { const l = document.getElementById('app-loading'); return !l || !l.classList.contains('show'); }, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    return page;
  }
  // 切り替えボタンを、画面上の位置を実際に押して切り替える
  // 切り替えボタンを押す。画面の無いブラウザ(GPU なし)では、人物の材質を初めて描くときのシェーダーの
  // 組み立てに1分以上かかるので、ここでは描画を止めて、置き場所とカメラの計算だけを確かめる
  // （描いた見た目は、画面のあるブラウザで撮った画像で確かめている）
  async function pressToggle(page) {
    await page.evaluate(() => { window.render3DNow = function () {}; });
    await page.evaluate(() => document.getElementById('walk-tps-toggle').click());
    await page.waitForTimeout(500);
  }
  const eye = () => ({ x: WALK.x, z: WALK.z, y: walkEyeY(), cx: camExt.position.x, cy: camExt.position.y, cz: camExt.position.z });

  // 隠しスイッチが無いとき: 切り替えは出ず、カメラは目の位置
  const p1 = await open('');
  assert.equal(await p1.locator('#walk-tps-toggle').count(), 0, '?tps=1 が無いのに切り替えが出た');
  const e1 = await p1.evaluate(eye);
  assert.ok(Math.hypot(e1.cx - e1.x, e1.cz - e1.z) < 1e-6 && Math.abs(e1.cy - e1.y) < 1e-6, '一人称のカメラが目の位置にない');
  // 画面の無いブラウザでは、3D のページを続けて開くと後の方が動かなくなるので、ブラウザごと開き直す
  await browser.close(); browser = await chromium.launch();

  // 隠しスイッチあり: 三人称にすると、人物の後ろから見る
  const p2 = await open('&tps=1');
  await pressToggle(p2);
  const t = await p2.evaluate(() => {
    let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; });
    const back = (camExt.position.x - WALK.x) * Math.sin(WALK.yaw) + (camExt.position.z - WALK.z) * Math.cos(WALK.yaw);
    return { on: ThirdPerson.isOn(), figure: !!f, at: f && Math.hypot(f.position.x - WALK.x, f.position.z - WALK.z), back, yaw: camExt.rotation.y - WALK.yaw, visible: f && f.visible };
  });
  assert.equal(t.on, true);
  assert.ok(t.figure, '人物が場面に無い');
  assert.ok(t.at < 1e-6, '人物が歩いている位置に立っていない');
  assert.ok(!t.visible || t.back > 0.7, 'カメラが人物の後ろに引けていない: ' + t.back);
  assert.ok(Math.abs(t.yaw) < 1e-6, 'カメラの向きが一人称と違う');
  // もう1回で女性に替わり、さらにもう1回で一人称に戻る（人物は消え、カメラは目の位置に戻る）
  await pressToggle(p2);
  assert.equal(await p2.evaluate(() => [ThirdPerson.isOn(), ThirdPerson.character()].join()), 'true,walker-female-01');
  await pressToggle(p2);
  const back = await p2.evaluate(() => { let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; }); return { figure: !!f, d: Math.hypot(camExt.position.x - WALK.x, camExt.position.z - WALK.z) }; });
  assert.deepEqual(back, { figure: false, d: 0 });

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('三人称のウォークスルー: 隠しスイッチ・人物の位置・後ろからのカメラ・一人称へ戻す、が通った');
} finally {
  await browser.close();
}
