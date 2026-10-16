// 三人称のウォークスルー（third-person.js）を実物のページで通す。
//
// 見るもの: ?tps=1 が無ければ切り替えは出ず、一人称のカメラは今までどおり目の位置／
// ?tps=1 で三人称にすると、人物が足元に立ち、カメラは人物の後ろのいつも同じ距離（向きは一人称と同じ）／
// 切り替えは十字キーの上の横長のボタン／下キーはカメラの向きのまま、人物がカメラの方を向いて手前へ歩いてくる／一人称に戻すと人物は消える。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
// 画面の無いブラウザでも Mac の GPU(Metal)を使う（使わないと 3D の組み立てが遅く、マシンが混んでいると待ち切れない）。
// 画面のあるブラウザは利用者の操作を奪うので使わない
const launch = () => chromium.launch({ args: ['--use-angle=metal'] });
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
  // 三人称の間は、十字キーの真ん中の「立ち視点／座り視点」を出さない（目の高さの切り替えは三人称では意味が無い）
  assert.equal(await p2.evaluate(() => getComputedStyle(document.getElementById('walk-height-toggle')).visibility), 'hidden', '三人称なのに立ち／座り視点の切り替えが出ている');
  // 隠れた部分を描くシルエット（人物と同じ骨組みで動く単色の写し、手前に物がある所にだけ描く）が付いている
  const sil = await p2.evaluate(() => { let n = 0, ok = true; sc3.traverse((o) => { if (o.name === '_silhouette') { n++; ok = ok && o.visible && o.material.depthFunc === THREE.GreaterDepth && o.renderOrder < 11; } }); return {n, ok}; });
  assert.ok(sil.n > 0 && sil.ok, '隠れた部分のシルエットが無い: ' + JSON.stringify(sil));
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
  // 間の壁はパッと消さず、薄くしてから消す（0.25秒）。置いた直後は薄くなり始めた所で、まだ消えきっていない
  const hiddenWall = await p2.evaluate(async () => {
    WALK.x = 7.28; WALK.z = 3.4; WALK.yaw = Math.PI / 2; walkApplyCamera();
    await new Promise((res) => setTimeout(res, 60)); walkApplyCamera();
    let fading = 0, gone = 0;
    sc3.traverse((o) => { if (o.isMesh && o.userData._tpsFadeOrig) { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m.opacity > 0.05 && m.opacity < 0.95) fading++; } if (o.userData._tpsLayers !== undefined) gone++; });
    for (let i = 0; i < 8; i++) { await new Promise((res) => setTimeout(res, 60)); walkApplyCamera(); }
    const walls = new Set();
    sc3.traverse((o) => { if (o.userData._tpsLayers !== undefined && o.userData.selectKind === 'wall' && DATA.walls.includes(o.userData.selectRef)) walls.add(o.userData.selectRef); });
    const w = [...walls][0];
    if (!w) return {count: 0};
    // 開口（ドア）の位置を避けて、壁の上の点を探す
    for (let t = 0.1; t <= 0.9; t += 0.05) {
      const x = w.x1 + (w.x2 - w.x1) * t, y = w.y1 + (w.y2 - w.y1) * t;
      if (walkBlockedAt(x, y, WALK.floor)) return {count: walls.size, blocked: true, fading, gone};
    }
    return {count: walls.size, blocked: false, fading, gone};
  });
  assert.ok(hiddenWall.fading > 0 && hiddenWall.gone === 0, '間の壁がパッと消えた（薄くなる途中が無い）: ' + JSON.stringify(hiddenWall));
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
    const fwd = Math.max(sofa.d * 0.1, sofa.d / 2 - 140) / 1000, sx = cx + fx * fwd, sz = cz + fy * fwd;   // 浅めに腰掛ける（前の縁から 140mm）
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
  // 座った足が床にめり込まない。座面の高さは家具ごとに違い、低い座面では足が床の下へ入っていた（利用者の指摘）。
  // プランの座れる家具すべてに座らせ、足先がその階の床より上にあるかを見る
  const feet = await p2.evaluate(async () => {
    const out = [];
    for (const it of DATA.items.filter((i) => { const f = getFmpItem(i.type); return f && (f.kind === 'sofa' || f.kind === 'chair'); })) {
      ST.floor = it.floor; WALK.floor = it.floor; _walkCollFloor = null;
      const r = (it.rot || 0) * Math.PI / 180, cx = (it.x + it.w / 2) / 1000, cz = (it.y + it.d / 2) / 1000;
      WALK.x = cx - Math.sin(r) * 0.9; WALK.z = cz + Math.cos(r) * 0.9; walkUpdateGround(true);
      let t = performance.now(); for (let i = 0; i < 3; i++) { t += 50; updateWalkMode(t); walkApplyCamera(); }
      const btn = document.getElementById('walk-sit-toggle');
      if (btn.style.display === 'none') continue;
      btn.click();
      for (let i = 0; i < 12; i++) { await new Promise((res) => setTimeout(res, 60)); walkApplyCamera(); }
      let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; });
      f.updateMatrixWorld(true);
      let low = Infinity; const v = new THREE.Vector3();
      f.traverse((o) => { if (o.isBone && /(Foot|ToeBase|Toe_End)$/.test(o.name)) low = Math.min(low, o.getWorldPosition(v).y); });
      out.push({ type: it.type, floor: it.floor, above: +(low - floorTopY(it.floor)).toFixed(3) });
      ThirdPerson.standUp(); for (let i = 0; i < 8; i++) { await new Promise((res) => setTimeout(res, 60)); walkApplyCamera(); }
    }
    return out;
  });
  assert.ok(feet.length >= 2, '座れる家具に座れない: ' + JSON.stringify(feet));
  assert.deepEqual(feet.filter((x) => x.above < -0.005), [], '座った足が床にめり込んでいる');
  // 人物は女性だけ（男性はリリースの範囲から外した）。もう1回押すと一人称に戻る（人物は消え、カメラは目の位置に戻る）
  assert.equal(await p2.evaluate(() => [ThirdPerson.isOn(), ThirdPerson.character()].join()), 'true,walker-female-02a');
  await pressToggle(p2);
  const back = await p2.evaluate(() => { let f = null; sc3.traverse((o) => { if (o.name === '_thirdPersonFigure') f = o; }); return { figure: !!f, d: Math.hypot(camExt.position.x - WALK.x, camExt.position.z - WALK.z) }; });
  assert.deepEqual(back, { figure: false, d: 0 });
  assert.equal(await p2.evaluate(() => getComputedStyle(document.getElementById('walk-height-toggle')).visibility), 'visible', '一人称に戻しても立ち／座り視点の切り替えが出ない');

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('三人称のウォークスルー: 隠しスイッチ・人物の位置・決まった距離のカメラ（間の壁は薄くしてから見た目だけ消し、隠れた部分はシルエット）・ボタンの位置・下キーでカメラの方へ歩く・ソファに座る（座ったままカメラを回す・どの席でも足が床の上）・一人称へ戻す、が通った');
} finally {
  await browser.close();
}
