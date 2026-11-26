// タッチ端末の画面と、平面図の細かさ(端末の倍率)の検査。
//
// 確かめること:
//   1. iPad(縦・横)と横向きのスマートフォンが、幅が 768px を超えていてもスマートフォン向けの
//      画面(下のナビ)になり、座標・壁の本数・版の番号の帯が出ない。マウスの PC は今までどおり。
//   2. 平面図(#c2d)の裏地が「CSS の画素 × 端末の倍率」になり、描く位置・タップの当たり・
//      ドラッグ・壁の作図・画像の書き出しがずれない。
//      何も操作しないあいだは描き直さない。
//   3. 操作の案内(#help-box・#joy-hint)を閉じられ、開き直しても閉じたまま。設定欄から出し直せる。
//
// 間取りは凍結間取り tools/tests/fixtures/house-2f.json をファイル選択で読み込む。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'house-2f.json'));
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const TOUCH = { isMobile: true, hasTouch: true };
const DEVICES = {
  pc: { viewport: { width: 1440, height: 900 } },
  'ipad-landscape': { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, ...TOUCH },
  'ipad-portrait': { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, ...TOUCH },
  'phone-landscape': { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, ...TOUCH },
  'phone-portrait': { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, ...TOUCH },
};

const browser = await chromium.launch();
const errors = [];

async function open(name, { plan = true } = {}) {
  const context = await browser.newContext(DEVICES[name]);
  // AI・共同編集の通信は外へ出さない
  await context.route(/\/api\//, (r) => r.fulfill({ status: 503, body: '{}' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(APP + '?preset=blank');
  await page.waitForFunction(() => window.DATA && window.ST && window._defaultPlanPending === false, null, T);
  if (plan) {
    await page.evaluate(() => { window.__before = DATA; });
    await page.setInputFiles('#import-file', { name: 'plan.json', mimeType: 'application/json', buffer: FIXTURE });
    await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 10, null, T);
    await page.waitForTimeout(300);
  }
  return { context, page };
}

// 画面に見えているか(display と大きさ)
const shown = (page, id) => page.evaluate((id) => {
  const e = document.getElementById(id); if (!e) return false;
  const r = e.getBoundingClientRect();
  return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0;
}, id);
const rect = (page, id) => page.evaluate((id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, id);

try {
  // ── 1. どの端末がどちらの画面になるか ─────────────────────────────
  {
    const { context, page } = await open('pc');
    assert.equal(await page.evaluate(() => isMobileLayout()), false, 'マウスの PC はマウス向けの画面のまま');
    assert.equal(await shown(page, 'statusbar'), true, 'PC の下の帯は今までどおり出る');
    assert.equal(await shown(page, 'bottom-nav'), false, 'PC に下のナビは出ない');
    const sb = await rect(page, 'sidebar');
    assert.ok(sb.left >= 0 && sb.width > 150 && sb.bottom <= 900 + 1, 'PC の左のパネルは常に出る');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.help-desktop')).display !== 'none'), true, 'PC の操作ガイドはマウス向けの文');
    const c = await page.evaluate(() => ({ w: canvas.width, h: canvas.height, cw: document.getElementById('canvas-area').clientWidth, ch: document.getElementById('canvas-area').clientHeight }));
    assert.deepEqual([c.w, c.h], [c.cw, c.ch], '倍率 1 の画面では、平面図の裏地は今までと同じ画素数');
    await context.close();
  }

  for (const name of ['ipad-landscape', 'ipad-portrait', 'phone-landscape', 'phone-portrait']) {
    const { context, page } = await open(name);
    const vp = DEVICES[name].viewport, dpr = DEVICES[name].deviceScaleFactor;
    assert.equal(await page.evaluate(() => isMobileLayout()), true, `${name}: スマートフォン向けの画面になる`);
    for (const id of ['statusbar', 'coords', 'app-version']) {
      assert.equal(await shown(page, id), false, `${name}: 開発寄りの表示 #${id} は出ない`);
    }
    assert.equal(await shown(page, 'bottom-nav'), true, `${name}: 下のナビが出る`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.help-desktop')).display), 'none', `${name}: マウス向けの操作ガイドは出ない`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.help-touch')).display !== 'none'), true, `${name}: タッチ向けの案内が出る`);

    // 上の帯・右上の表示の切り替え・案内の箱・下のナビが、互いに重ならず画面に収まる
    const tb = await rect(page, 'toolbar'), nav = await rect(page, 'bottom-nav'), sel = await rect(page, 'surface-control'), help = await rect(page, 'help-box');
    assert.ok(tb.right <= vp.width + 1 && nav.right <= vp.width + 1 && nav.bottom <= vp.height + 1, `${name}: 上の帯と下のナビが画面に収まる`);
    assert.ok(sel.top >= tb.bottom - 1, `${name}: 表示の切り替えが上の帯に隠れない (${sel.top} >= ${tb.bottom})`);
    assert.ok(help.top >= tb.bottom - 1 && help.bottom <= nav.top, `${name}: 案内の箱が上の帯と下のナビに隠れない`);
    const overlapX = Math.min(help.right, sel.right) - Math.max(help.left, sel.left), overlapY = Math.min(help.bottom, sel.bottom) - Math.max(help.top, sel.top);
    assert.ok(overlapX <= 0 || overlapY <= 0, `${name}: 案内の箱と表示の切り替えが重ならない`);
    const fab = await rect(page, 'chat-fab');
    assert.ok(fab.bottom <= nav.top + 1 && fab.top >= tb.bottom, `${name}: 「AIに頼む」のボタンが下のナビに隠れない`);
    if (name === 'phone-landscape') {
      assert.ok(tb.height <= 64, `横向きのスマートフォン: 上の帯は1段 (${tb.height}px)`);
      // 開いた直後の間取りが、上下の帯のあいだに見えている
      const fit = await page.evaluate(() => { resetView(); const b = planSubjectBoundsMm(ST.floor), a = w2c(b.minX, b.minY), z = w2c(b.maxX, b.maxY); return { top: a.cy, bottom: z.cy, left: a.cx, right: z.cx }; });
      assert.ok(fit.top >= tb.bottom - 1 && fit.bottom <= nav.top + 1, `横向きのスマートフォン: 間取りが上下の帯のあいだに収まる (${fit.top}..${fit.bottom})`);
      assert.ok(fit.bottom - fit.top >= 180, `横向きのスマートフォン: 間取りが小さくなりすぎない (高さ ${Math.round(fit.bottom - fit.top)}px)`);
      assert.ok(fit.left >= help.right - 1 && fit.right <= sel.left + 1, '横向きのスマートフォン: 間取りが案内の箱と表示の切り替えの横に収まる');
    }

    // ── 2. 平面図の細かさと座標 ──────────────────────────────────────
    const c = await page.evaluate(() => { const a = document.getElementById('canvas-area'), r = canvas.getBoundingClientRect(); return { w: canvas.width, h: canvas.height, cw: a.clientWidth, ch: a.clientHeight, rw: r.width, rh: r.height }; });
    assert.deepEqual([c.w, c.h], [Math.round(c.cw * dpr), Math.round(c.ch * dpr)], `${name}: 平面図の裏地は CSS の画素 × ${dpr}`);
    assert.deepEqual([c.rw, c.rh], [c.cw, c.ch], `${name}: 平面図の見た目の大きさは図の欄と同じ`);

    // 何も操作しないあいだ、描き直しも裏地の張り替えも起きない(大きさ決めと描き直しが互いを呼び続けないこと)
    const idle = await page.evaluate(async () => {
      const real = window.draw2dScene; let draws = 0, changes = 0, w = canvas.width, h = canvas.height;
      window.draw2dScene = function () { draws++; return real.apply(this, arguments); };
      const end = performance.now() + 2000;
      while (performance.now() < end) {
        await new Promise((r) => requestAnimationFrame(r));
        if (canvas.width !== w || canvas.height !== h) { changes++; w = canvas.width; h = canvas.height; }
      }
      window.draw2dScene = real;
      return { draws, changes };
    });
    // (読み込みの直後は、絵が読めた知らせで 1〜2 回描き直すことがある。描き直しが回り続けると 2 秒で 100 回を超える)
    assert.equal(idle.changes, 0, `${name}: 何もしない 2 秒間に平面図の裏地の大きさが変わった`);
    assert.ok(idle.draws <= 5, `${name}: 何もしない 2 秒間に平面図を ${idle.draws} 回描き直した`);

    // 決まった物と壁だけの図面にして、位置を確かめる
    // (上の帯・案内の箱・下のナビに隠れない所へ図面を寄せる)
    const pan = name === 'phone-landscape' ? { x: 400, y: 80 } : { x: 60, y: 300 };
    await page.evaluate((pan) => {
      DATA.items = [mkItem('table', 1000, 200, 0, 1, 800, 800)];
      DATA.walls = [mkWall(1000, 1600, 3400, 1600, 1, 120)];
      DATA.rooms = []; ST.floor = 1; ST.selected = null; clearMultiSelection();
      ST.zoom = 1.6; ST.panX = pan.x; ST.panY = pan.y; ST.snap = 10; ST.showGrid = false;
      setTool('select'); clearEditHistory(); draw2d();
    }, pan);
    const pos = (x, y) => page.evaluate(({ x, y }) => { const pt = w2c(x, y), r = canvas.getBoundingClientRect(); return { x: pt.cx + r.left, y: pt.cy + r.top, cx: pt.cx, cy: pt.cy }; }, { x, y });
    // 描いた壁が、倍率ぶんずれずに裏地の同じ場所にある(壁の上は暗く、少し離れた所は明るい)
    const lum = (cx, cy) => page.evaluate(({ cx, cy }) => { const k = planCanvasRatio(canvas), d = canvas.getContext('2d').getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; }, { cx, cy });
    const onWall = await pos(2200, 1600), offWall = await pos(2200, 2000);
    assert.ok(await lum(onWall.cx, onWall.cy) < 110, `${name}: 壁が計算どおりの画素に描かれている`);
    assert.ok(await lum(offWall.cx, offWall.cy) > 200, `${name}: 壁の無い所は地の色`);

    // タップで物が選べる(タッチの入力)
    const table = await pos(1400, 600);
    await page.touchscreen.tap(table.x, table.y);
    assert.equal(await page.evaluate(() => !!ST.selected && ST.selected === DATA.items[0]), true, `${name}: タップした場所の物が選ばれる`);
    // 何も無い所のタップで選択が外れる
    const empty = await pos(2600, 900);
    await page.touchscreen.tap(empty.x, empty.y);
    assert.equal(await page.evaluate(() => ST.selected), null, `${name}: 何も無い所のタップでは選ばれない`);
    // ドラッグで物が、指の動いた分だけ動く
    // (壁へ吸い付く距離までは近づけない)
    const to = await pos(2000, 800);
    await page.mouse.move(table.x, table.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => [DATA.items[0].x, DATA.items[0].y]), [1600, 400], `${name}: ドラッグした分だけ物が動く`);
    // 壁の作図: 2点を押すと、その2点を結ぶ壁ができる
    // (物を選んだときに下から出る設定のシートは、図面の下の方を覆うので閉じておく)
    await page.evaluate(() => { ST.selected = null; closeMobilePropPanel(); setTool('wall'); });
    const w1 = await pos(500, 2400), w2 = await pos(2500, 2400);
    await page.mouse.click(w1.x, w1.y); await page.mouse.click(w2.x, w2.y);
    await page.keyboard.press('Escape');
    // (壁の端は近くの壁の通りへ吸い付くことがあるので、吸い付きの幅だけ許す。倍率ぶんのずれなら桁が違う)
    const made = await page.evaluate(() => DATA.walls.slice(1).map((w) => [w.x1, w.y1, w.x2, w.y2]));
    assert.equal(made.length, 1, `${name}: 2点を押すと壁が1本できる (${JSON.stringify(made)})`);
    [500, 2400, 2500, 2400].forEach((want, i) => assert.ok(Math.abs(made[0][i] - want) <= 130, `${name}: 押した2点を結ぶ壁ができる (${JSON.stringify(made[0])})`));
    await page.evaluate(() => setTool('select'));

    // 画像の書き出し: 端末の倍率に左右されず、撮ったあと画面の裏地とパン・ズームが元に戻る
    const cap = await page.evaluate(async () => {
      const before = { w: canvas.width, h: canvas.height, panX: ST.panX, panY: ST.panY, zoom: ST.zoom };
      const size = async (url) => { const im = new Image(); im.src = url; await im.decode(); return [im.naturalWidth, im.naturalHeight]; };
      const one = await size(capturePlan2dDataUrl({ fit: true, grid: false }));
      const two = await size(capturePlan2dDataUrl({ fit: true, grid: false, scale: 2 }));
      const view = PLAN_CAPTURE_VIEW;
      const after = { w: canvas.width, h: canvas.height, panX: ST.panX, panY: ST.panY, zoom: ST.zoom };
      // 撮ったあとの画面も描き直されている(壁の画素が残っている)
      return { before, after, one, two, viewW: view.width };
    });
    assert.deepEqual(cap.one, [c.cw, c.ch], `${name}: 書き出す画像は CSS の画素の大きさ(倍率 1 の画面と同じ)`);
    assert.deepEqual(cap.two, [c.cw * 2, c.ch * 2], `${name}: scale:2 の書き出しはその 2 倍`);
    assert.equal(cap.viewW, c.cw * 2, `${name}: 撮影の座標系(PLAN_CAPTURE_VIEW)は撮った画像の画素`);
    assert.deepEqual(cap.after, cap.before, `${name}: 書き出しのあと、画面の裏地とパン・ズームが元に戻る`);
    const wallNow = await pos(2200, 1600);
    assert.ok(await lum(wallNow.cx, wallNow.cy) < 110, `${name}: 書き出しのあとも画面が描き直されている`);
    await context.close();
  }

  // ── 3. 操作の案内を閉じる ───────────────────────────────────────────
  for (const name of ['ipad-landscape', 'pc']) {
    const { context, page } = await open(name, { plan: false });
    assert.equal(await shown(page, 'help-box'), true, `${name}: 平面図の案内は最初は出ている`);
    assert.equal(await shown(page, 'hints-restore'), false, `${name}: 閉じる前は「もう一度表示」を出さない`);
    const before = await page.evaluate(() => JSON.stringify(planViewSafeInsets()));
    const walls = await page.evaluate(() => DATA.walls.length);
    if (DEVICES[name].hasTouch) await page.locator('#help-box .hint-close').tap(); else await page.locator('#help-box .hint-close').click();
    assert.equal(await shown(page, 'help-box'), false, `${name}: 閉じるボタンで平面図の案内が消える`);
    assert.equal(await page.evaluate(() => DATA.walls.length), walls, `${name}: 閉じるボタンを押しても下の図面には何も置かれない`);
    assert.notEqual(await page.evaluate(() => JSON.stringify(planViewSafeInsets())), before, `${name}: 案内が消えた分、間取りを収める範囲が広がる`);
    if (DEVICES[name].hasTouch) {
      // 閉じたあとの「全体表示」は、上の帯と右上の表示の切り替えの下に収まる
      const top = await page.evaluate(() => planViewSafeInsets().top);
      const tb = await rect(page, 'toolbar'), sel = await rect(page, 'surface-control');
      assert.ok(top >= tb.bottom && top >= sel.bottom, `${name}: 案内を閉じたあとも、間取りが上の帯に隠れない (${top})`);
    }
    // 表示を切り替えて戻っても出てこない
    await page.evaluate(() => { document.getElementById('help-box').style.display = 'block'; });
    assert.equal(await shown(page, 'help-box'), false, `${name}: 平面図へ戻っても閉じたまま`);
    // 内観3D の案内(表示の条件だけを作って確かめる。3D は立ち上げない)
    await page.evaluate(() => { document.getElementById('c3d-wrap').style.display = 'block'; document.getElementById('joy-hint').style.display = 'block'; });
    assert.equal(await shown(page, 'joy-hint'), true, `${name}: 内観3D の案内は閉じるまで出る`);
    if (DEVICES[name].hasTouch) {
      const jr = await rect(page, 'joy-hint');
      assert.ok(jr.height <= 44, `${name}: 内観3D の案内は1行に収まる (${jr.height}px)`);
      await page.locator('#joy-hint .hint-close').tap();
    } else await page.locator('#joy-hint .hint-close').click();
    assert.equal(await shown(page, 'joy-hint'), false, `${name}: 閉じるボタンで内観3D の案内が消える`);
    // 開き直しても閉じたまま
    await page.reload();
    await page.waitForFunction(() => window.DATA && window.ST && window._defaultPlanPending === false, null, T);
    assert.equal(await shown(page, 'help-box'), false, `${name}: 開き直しても平面図の案内は閉じたまま`);
    await page.evaluate(() => { document.getElementById('joy-hint').style.display = 'block'; });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('joy-hint')).display), 'none', `${name}: 開き直しても内観3D の案内は閉じたまま`);
    // 設定欄から出し直せる
    assert.equal(await page.evaluate(() => !document.getElementById('hints-restore').hidden), true, `${name}: 閉じたあとは設定欄に「もう一度表示」が出る`);
    await page.evaluate(() => document.getElementById('hints-restore-btn').click());
    assert.equal(await shown(page, 'help-box'), true, `${name}: 「もう一度表示」で平面図の案内が戻る`);
    assert.equal(await page.evaluate(() => localStorage.getItem('webcad-hints-off')), null, `${name}: 出し直したら覚えを消す`);
    await context.close();
  }

  assert.deepEqual(errors, []);
  console.log('PASS タッチ端末はスマートフォン向けの画面・平面図は端末の倍率で描き座標がずれない・操作の案内を閉じて覚える');
} finally {
  await browser.close();
}
