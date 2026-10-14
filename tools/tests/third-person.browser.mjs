// 三人称のウォークスルー（third-person.js）を実物のページで通す。
//
// 見るもの: ?tps=1 が無ければ切り替えは出ず、一人称のカメラは今までどおり目の位置／
// ?tps=1 で三人称にすると、人物が足元に立ち、カメラは人物の後ろのいつも同じ距離（向きは一人称と同じ）／
// 切り替えは十字キーの上の横長のボタン／下キーはカメラの向きのまま、人物がカメラの方を向いて手前へ歩いてくる／一人称に戻すと人物は消える。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
// HEADED=1 で画面のあるブラウザ(GPU あり)で走らせる。画面の無いブラウザは 3D の組み立てが遅く、マシンが混んでいると待ち切れない
const launch = () => chromium.launch({ headless: !process.env.HEADED });
let browser = await launch();
try {
  const errors = [];
  async function open(q) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
    await page.goto(APP + '?preset=2f' + q);
    await page.waitForFunction(() => window.DATA && DATA.walls.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => setView('3d-walk'));
    // 画面の無いブラウザ(GPU なし)では、3D の組み立てだけで 45 秒ほどかかる
    await page.waitForFunction(() => window.ren && WALK.active, null, { timeout: 180000 });
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
  await browser.close(); browser = await launch();

  // 隠しスイッチあり: 三人称にすると、人物の後ろから見る
  const p2 = await open('&tps=1');
  await pressToggle(p2);
  const t = await p2.evaluate(() => {
    let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; });
    const back = (camExt.position.x - WALK.x) * Math.sin(WALK.yaw) + (camExt.position.z - WALK.z) * Math.cos(WALK.yaw);
    return { on: ThirdPerson.isOn(), figure: !!f, at: f && Math.hypot(f.position.x - WALK.x, f.position.z - WALK.z), back, pitch: WALK.pitch || 0, yaw: camExt.rotation.y - WALK.yaw, visible: f && f.visible };
  });
  assert.equal(t.on, true);
  assert.ok(t.figure, '人物が場面に無い');
  assert.ok(t.at < 1e-6, '人物が歩いている位置に立っていない');
  assert.ok(t.visible, '人物が見えていない');
  assert.ok(Math.abs(t.back - 2.4 * Math.cos(t.pitch)) < 1e-3, 'カメラが人物の後ろの決まった距離にない: ' + t.back);
  // 切り替えボタンは十字キーの中ではなく、上に置く
  const pos = await p2.evaluate(() => { const b = document.getElementById('walk-tps-toggle').getBoundingClientRect(); const f = document.querySelector('#walk-dpad .wk-fwd').getBoundingClientRect(); return {bottom: b.bottom, fwdTop: f.top, w: b.width, h: b.height}; });
  assert.ok(pos.bottom <= pos.fwdTop && pos.w > pos.h * 2, '切り替えが十字キーの上の横長のボタンになっていない: ' + JSON.stringify(pos));
  // 下キー: カメラの向きは変えず、人物がカメラの方を向いて手前へ歩いてくる（カメラは同じ距離で下がる）
  await p2.evaluate(() => { window._t0 = {yaw: WALK.yaw, x: WALK.x, z: WALK.z}; WALK.keys.back = true; });
  await p2.waitForTimeout(1500);
  const turn = await p2.evaluate(() => {
    WALK.keys.back = false;
    let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; });
    const moved = Math.hypot(WALK.x - _t0.x, WALK.z - _t0.z);
    const along = ((WALK.x - _t0.x) * -Math.sin(WALK.yaw) + (WALK.z - _t0.z) * -Math.cos(WALK.yaw)) / (moved || 1);
    const face = Math.atan2(Math.sin(f.rotation.y - WALK.yaw), Math.cos(f.rotation.y - WALK.yaw));
    return {dyaw: WALK.yaw - _t0.yaw, moved, along, face, d: Math.hypot(camExt.position.x - WALK.x, camExt.position.z - WALK.z)};
  });
  assert.ok(Math.abs(turn.dyaw) < 1e-9, '下キーでカメラの向きが変わった: ' + turn.dyaw);
  assert.ok(turn.moved < 1e-9 || turn.along < -0.99, 'カメラの方へ歩いていない: ' + JSON.stringify(turn));
  assert.ok(turn.moved < 1e-9 || Math.abs(Math.abs(turn.face) - Math.PI) < 1e-6, '人物がカメラの方を向いていない: ' + JSON.stringify(turn));
  assert.ok(Math.abs(t.yaw) < 1e-6, 'カメラの向きが一人称と違う');
  // カメラと人物の間の壁は見えなくするだけで、当たり判定は残す（消した壁を通り抜けて外へ出られない）
  const hiddenWall = await p2.evaluate(() => {
    WALK.x = 7.28; WALK.z = 3.4; WALK.yaw = Math.PI / 2; walkApplyCamera();
    const walls = new Set();
    sc3.traverse((o) => { if (o.userData._tpsLayers !== undefined && o.userData.selectKind === 'wall' && DATA.walls.includes(o.userData.selectRef)) walls.add(o.userData.selectRef); });
    const w = [...walls][0];
    if (!w) return {count: 0};
    // 開口（ドア）の位置を避けて、壁の上の点を探す
    for (let t = 0.1; t <= 0.9; t += 0.05) {
      const x = w.x1 + (w.x2 - w.x1) * t, y = w.y1 + (w.y2 - w.y1) * t;
      if (walkBlockedAt(x, y, WALK.floor)) return {count: walls.size, blocked: true};
    }
    return {count: walls.size, blocked: false};
  });
  assert.ok(hiddenWall.count > 0, 'カメラと人物の間の壁が消えていない');
  assert.equal(hiddenWall.blocked, true, '見えなくした壁の当たり判定が無くなっている');
  // 座る: ソファの前に来ると「ソファに座る」が出て、押すと座面の上に座る。歩く操作をすると立ち上がる
  const sit = await p2.evaluate(async () => {
    const sofa = DATA.items.find((i) => { const f = getFmpItem(i.type); return f && f.kind === 'sofa' && i.floor === WALK.floor; });
    const r = (sofa.rot || 0) * Math.PI / 180, fx = -Math.sin(r), fy = Math.cos(r);
    const cx = (sofa.x + sofa.w / 2) / 1000, cz = (sofa.y + sofa.d / 2) / 1000;
    WALK.x = cx + fx * 1.0; WALK.z = cz + fy * 1.0; walkApplyCamera();
    const btn = document.getElementById('walk-sit-toggle');
    const label = btn.style.display !== 'none' ? btn.textContent : '';
    btn.click();
    // 座る動きは時間で進む。描画の回り(requestAnimationFrame)は窓が裏にあると止まるので、ここで時間を置いて進める
    for (let i = 0; i < 8; i++) { await new Promise((res) => setTimeout(res, 100)); walkApplyCamera(); }
    let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; });
    const seated = ThirdPerson.seated() === sofa, label2 = btn.textContent;
    // 腰が座面の中心（ソファの中心より少し前）の上にあるか
    let hips = null; f.traverse((o) => { if (o.isBone && /Hips$/.test(o.name)) hips = o; });
    const hp = hips ? hips.getWorldPosition(new THREE.Vector3()) : f.position;
    const sx = cx + fx * sofa.d * 0.1 / 1000, sz = cz + fy * sofa.d * 0.1 / 1000;
    const off = Math.hypot(hp.x - sx, hp.z - sz);
    // 座ったまま左右キー: 立ち上がらず、カメラだけが回る（人物は座った向きのまま）
    const yaw0 = WALK.yaw;
    WALK.keys.left = true; let t = performance.now();
    for (let i = 0; i < 5; i++) { t += 50; updateWalkMode(t); }
    WALK.keys.left = false;
    walkApplyCamera();
    const turned = {stillSeated: ThirdPerson.seated() === sofa, dyaw: WALK.yaw - yaw0,
      facing: Math.atan2(Math.sin(f.rotation.y - yaw0), Math.cos(f.rotation.y - yaw0))};
    WALK.keys.fwd = true; updateWalkMode(performance.now()); WALK.keys.fwd = false;
    return {label, label2, seated, off, hipsFound: !!hips, after: !!ThirdPerson.seated(), turned};
  });
  assert.equal(sit.label, 'ソファに座る', 'ソファの前で「ソファに座る」が出ない');
  assert.ok(sit.seated && sit.label2 === '立ち上がる', '押しても座らない: ' + JSON.stringify(sit));
  assert.ok(!sit.hipsFound || sit.off < 0.08, '腰が座面の上にない: ' + sit.off);
  assert.ok(sit.turned.stillSeated && sit.turned.dyaw > 0.1, '座ったまま左右キーでカメラが回らない: ' + JSON.stringify(sit.turned));
  assert.ok(Math.abs(sit.turned.facing) < 1e-6, 'カメラを回したら、座っている人物まで回った: ' + JSON.stringify(sit.turned));
  assert.equal(sit.after, false, '前へ歩く操作で立ち上がらない');
  // もう1回で女性に替わり、さらにもう1回で一人称に戻る（人物は消え、カメラは目の位置に戻る）
  await pressToggle(p2);
  assert.equal(await p2.evaluate(() => [ThirdPerson.isOn(), ThirdPerson.character()].join()), 'true,walker-female-02a');
  await pressToggle(p2);
  const back = await p2.evaluate(() => { let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; }); return { figure: !!f, d: Math.hypot(camExt.position.x - WALK.x, camExt.position.z - WALK.z) }; });
  assert.deepEqual(back, { figure: false, d: 0 });

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('三人称のウォークスルー: 隠しスイッチ・人物の位置・決まった距離のカメラ（間の壁は見た目だけ消す）・ボタンの位置・下キーでカメラの方へ歩く・ソファに座る（座ったままカメラを回す）・一人称へ戻す、が通った');
} finally {
  await browser.close();
}
