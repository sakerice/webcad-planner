// App Store 用スクリーンショット 3枚目「建てる前に、家の中を歩ける」の撮影。
// 三人称（女性 walker-female-02a）のウォークスルーを、iPhone 6.9 インチ相当（440×956・3倍 = 1320×2868）で撮る。
//
// 使い方（作業フォルダで）:
//   SKIP_DEPLOY=1 bash build.sh
//   (cd dist && python3 -m http.server 8942 --bind 127.0.0.1) &
//   PLAYWRIGHT_MODULE=/Users/nariiwa/Projects/echoglass/node_modules/playwright-core/index.mjs \
//     node docs/store/screenshots/shoot/shoot-walk.mjs [番号 ...]      （番号なしで全部。例: node shoot-walk.mjs 3 5）
//   node shoot-walk.mjs probe      … 1階の部屋と家具の座標を表示する（場所を探すとき用）
//
// - 画面は headless Chromium（--use-angle=metal）。AI・共同編集・MCP への通信は 503 で止める。
// - 画角は、製品のウォークスルーにある「2本指のピンチイン（広角）」を、タッチ操作（CDP の
//   Input.dispatchTouchEvent）で実際に行って広げる。製品の上限は縦の画角 100°、既定は 68°。
//   fov 列が 68 の行はピンチしない。
// - カメラと人物の距離は製品で固定（third-person.js の DIST = 2.4m）。画面の操作では変えられないので、ここでも変えない。
// - 人物の向き（body 列）: 'back' は背中、'front' はこちらを向く。どちらも製品の十字キー（上・下）で少し歩かせて向かせる。
//   'sit' は製品の「ソファに座る」ボタンで座らせ、座ったまま視点を回す（人物の向きは家具に固定され、横顔・斜め前が撮れる）。
const pw = await import(process.env.PLAYWRIGHT_MODULE || '/Users/nariiwa/Projects/echoglass/node_modules/playwright-core/index.mjs');
const chromium = pw.chromium || pw.default.chromium;
const OUT = new URL('.', import.meta.url).pathname;
const APP = process.env.APP_URL || 'http://127.0.0.1:8942/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEV = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA };

// 撮る場所の表。at / look は 1階の平面の mm 座標（at に人物が立ち、look の方を向く）。
// pitch は上下の向き（ラジアン、正で見上げ）。fov は縦の画角（度）。body は人物の向き。
// 試して外した場所（記録）: キッチン側・ダイニングの南から北のキッチンへ・リビングの隅から北東へ は、カメラが食卓や
// キッチンの台・ソファの向こうに来て、人物の足が隠れて白い影（製品の「隠れた部分のシルエット」）で描かれた。
// ダイニングの南東の隅は、カメラが外壁の近くに出て壁の断面が写った。ソファに座る（body: 'sit'）は、
// 座面の縁に浅く腰掛けて体が傾き、足先がシルエットになったので外した。
const SHOTS = [
  { no: 1, name: 'walk3rd-01', at: [4300, 3900], look: [1500, 5900], pitch: 0.0, fov: 68, body: 'back', note: '前回の28と同じ位置・既定の画角（比べる用）' },
  { no: 2, name: 'walk3rd-02', at: [4300, 3900], look: [1500, 5900], pitch: 0.05, fov: 90, body: 'back', note: 'ダイニングから吹き抜けのリビングへ（背中）' },
  { no: 3, name: 'walk3rd-03', at: [4300, 3900], look: [1500, 5900], pitch: 0.05, fov: 90, body: 'front', note: '2 で人物がこちらを向く' },
  { no: 4, name: 'walk3rd-04', at: [3900, 3500], look: [300, 6600], pitch: 0.1, fov: 90, body: 'front', note: 'ダイニングの北から南西の窓へ（こちらを向く）' },
  { no: 5, name: 'walk3rd-05', at: [4300, 3900], look: [1500, 5900], pitch: 0.05, fov: 100, body: 'front', note: '3 を製品の上限 100° で' },
  { no: 6, name: 'walk3rd-06', at: [4300, 3900], look: [1500, 5900], pitch: 0.05, fov: 100, body: 'back', note: '2 を製品の上限 100° で' },
  { no: 7, name: 'walk3rd-07', at: [3900, 3500], look: [300, 6600], pitch: 0.0, fov: 80, body: 'front', note: '4 を少し狭く 80° で（右端のドアを減らす）' },
  { no: 8, name: 'walk3rd-08', at: [4300, 3900], look: [600, 5000], pitch: 0.1, fov: 90, body: 'front', note: '西のリビング（ソファ・テレビ・窓）へ（こちらを向く）' },
];

async function open() {
  const browser = await chromium.launch({ args: ['--use-angle=metal'] });
  const ctx = await browser.newContext(DEV);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('dialog', (d) => d.dismiss());
  await ctx.route(/\/api\/(ai|rooms|mcp)/, (r) => r.fulfill({ status: 503, body: '{}' }));
  await page.goto(APP + '?preset=2f');
  await page.waitForFunction(() => window.DATA && DATA.walls.length > 0, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { browser, page };
}
async function settle3d(page, extra = 3000) {
  await page.waitForFunction(() => window.ren && typeof hasPendingGltfModels === 'function' && !hasPendingGltfModels() && !window._gltfRebuildTimer, null, { timeout: 240000 }).catch(() => console.log('settle timeout'));
  await page.waitForFunction(() => { const l = document.getElementById('app-loading'); return !l || !l.classList.contains('show'); }, null, { timeout: 120000 }).catch(() => console.log('loading timeout'));
  await page.waitForTimeout(extra);
}
async function enterTps(page) {
  await page.evaluate(() => setView('3d-walk'));
  await page.waitForFunction(() => WALK.active, null, { timeout: 180000 });
  await settle3d(page, 1000);
  // 製品の「一人称」ボタンを押して三人称・女性にする
  await page.evaluate(() => document.getElementById('walk-tps-toggle').click());
  await page.waitForFunction(() => ThirdPerson.isOn() && ThirdPerson.modelState('walker-female-02a') === 'ready', null, { timeout: 120000 }).catch(() => console.log('model not ready'));
  await page.waitForTimeout(3000);
}
async function walkAt(page, at, look, pitch) {
  await page.evaluate(([at, look, pitch]) => {
    ST.floor = 1; WALK.floor = 1; WALK.groundOff = 0; window._walkCollFloor = null;
    WALK.x = at[0] * U; WALK.z = at[1] * U; walkUpdateGround(true);
    WALK.yaw = Math.atan2(-(look[0] - at[0]), -(look[1] - at[1])); WALK.pitch = pitch; WALK.keys = {};
    walkApplyCamera(); drawWalkMinimap(); if (typeof invalidate3D === 'function') invalidate3D();
  }, [at, look, pitch]);
  await page.waitForTimeout(1500);
}
// 2本指のピンチイン（指の間を縮める）で画角を広げる。製品の式: tan(新しい半角) = tan(68°/2) / (今の指の間 / 始めの指の間)
async function pinchTo(page, fov) {
  if (fov === 68) return;
  const s = Math.tan((68 * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);   // 指の間の比
  const cdp = await page.context().newCDPSession(page);
  const cx = 220, cy = 520, d0 = 160, d1 = d0 * s, steps = 12;
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  const got = await page.evaluate(() => camExt.fov);
  console.log('  pinch fov ->', got.toFixed(1));
}
// 人物をこちらへ向かせる: 下キー（製品の十字キーと同じ WALK.keys.back）を少し押して戻す
// （位置を後から戻すと、戻した分を「奥へ歩いた」と数えて背中に戻るので、先に少し前へ置いてから下がる）
// 'back' も同じ形で、少し後ろに置いて上キーで前へ歩かせる（瞬間移動した向きで背中・正面が決まってしまうため）
async function setBody(page, at, look, pitch, body) {
  const dx = look[0] - at[0], dy = look[1] - at[1], L = Math.hypot(dx, dy), k = body === 'front' ? 450 : -450;
  await walkAt(page, [at[0] + (dx / L) * k, at[1] + (dy / L) * k], look, pitch);
  await page.evaluate((key) => { WALK.keys = { [key]: true }; }, body === 'front' ? 'back' : 'fwd');
  await page.waitForFunction((at) => Math.hypot(WALK.x - at[0] * U, WALK.z - at[1] * U) < 0.06, at, { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => { WALK.keys = {}; });
  await page.waitForTimeout(1500);   // 振り向きが終わるまで（製品では 0.45 秒で半回転）
}
// ソファに座る: 製品の「ソファに座る」ボタンを押し、座ったまま視点を回す（座っている間は人物の向きが家具に固定され、
// カメラだけが回るので、横顔や斜め前からの姿が撮れる）
async function sitAndLook(page, at, look, pitch) {
  await walkAt(page, at, look, pitch);
  await page.waitForTimeout(800);
  const label = await page.evaluate(() => { const b = document.getElementById('walk-sit-toggle'); return b && b.style.display !== 'none' ? b.textContent : null; });
  if (!label) { console.log('  座れる家具が近くにない'); return; }
  await page.evaluate(() => document.getElementById('walk-sit-toggle').click());
  await page.waitForTimeout(1500);
  // 座った人物の頭の位置から見て look の方を向く（左右のドラッグと同じ WALK.yaw を変える）
  await page.evaluate(([look, pitch]) => {
    const seat = ThirdPerson.seated(); if (!seat) return;
    WALK.yaw = Math.atan2(-(look[0] * U - WALK.x), -(look[1] * U - WALK.z)); WALK.pitch = pitch;
    walkApplyCamera(); drawWalkMinimap(); if (typeof invalidate3D === 'function') invalidate3D();
  }, [look, pitch]);
  await page.waitForTimeout(1500);
}
// 画面に重なる案内（吹き出し）があれば隠す。操作の部品（ミニマップ・十字キー・切り替え）は残す
async function hideHints(page) {
  return page.evaluate(() => {
    const found = [];
    document.querySelectorAll('.walk-hint, .coach, .hint-bubble, .toast').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' && el.textContent.trim()) { found.push((el.id || el.className) + ': ' + el.textContent.trim().slice(0, 40)); el.style.visibility = 'hidden'; }
    });
    return found;
  });
}

async function probe() {
  const { browser, page } = await open();
  const info = await page.evaluate(() => ({
    rooms: DATA.rooms.filter((r) => r.floor === 1).map((r) => [r.name || r.type, Math.round(Math.min(...r.pts.map((p) => p.x))), Math.round(Math.min(...r.pts.map((p) => p.y))), Math.round(Math.max(...r.pts.map((p) => p.x))), Math.round(Math.max(...r.pts.map((p) => p.y)))].join(' ')),
    items: DATA.items.filter((i) => i.floor === 1 && !/^neighbor|^ext|tree|fence/.test(i.type)).map((i) => [i.type, Math.round(i.x), Math.round(i.y), Math.round(i.w || 0), Math.round(i.d || 0), Math.round(i.rot || 0)].join(' ')),
  }));
  console.log(info.rooms.join('\n')); console.log('---'); console.log(info.items.join('\n'));
  await browser.close();
}

async function shoot(list) {
  const { browser, page } = await open();
  await enterTps(page);
  for (const s of list) {
    const t = Date.now();
    // 画角は毎回 68° に戻してからピンチする（前の行の画角を持ち越さない）
    await page.evaluate(() => { camExt.fov = 68; camExt.updateProjectionMatrix(); if (ThirdPerson.seated()) document.getElementById('walk-sit-toggle').click(); });
    await page.waitForTimeout(600);
    if (s.body === 'sit') await sitAndLook(page, s.at, s.look, s.pitch);
    else await setBody(page, s.at, s.look, s.pitch, s.body);
    await pinchTo(page, s.fov);
    await page.evaluate(() => { walkApplyCamera(); if (typeof invalidate3D === 'function') invalidate3D(); });
    await settle3d(page, 2500);
    const hidden = await hideHints(page);
    if (hidden.length) console.log('  hid', hidden);
    const file = s.name + (s.fov !== 68 ? '-fov' + s.fov : '') + '.png';
    await page.screenshot({ path: OUT + file });
    console.log('saved', file, ((Date.now() - t) / 1000).toFixed(0) + 's', s.note || '');
  }
  await browser.close();
}

const args = process.argv.slice(2);
if (args[0] === 'probe') await probe();
else await shoot(args.length ? SHOTS.filter((s) => args.includes(String(s.no))) : SHOTS);
