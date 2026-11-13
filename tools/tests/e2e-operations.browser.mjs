// 利用者の操作を、画面のボタン・キャンバスへのマウスとキーボードで通しで確かめる。
//
// 他のブラウザ検査の多くはページ内の関数を直接呼んで確かめている。ここでは
// 操作はすべて画面経由(クリック・ドラッグ・キー・ファイル選択・ダウンロード)で行い、
// 結果だけをページの DATA などから読む。
//
// 見る場面
//   1. 起動 →「はじめる間取りを選んでください」で 2階建て / 3階建て / 白紙 を選ぶ → 平面図が出る
//   2. 壁を引く・家具を置く・部屋を描く・移動・削除・Undo / Redo
//   3. 保存 → 再読み込み → 同じ中身で戻る(壁の高さ WALL_H と各壁の wallHeight、外壁・内壁・屋根も)
//   4. JSON を書き出す → 白紙 →「読込」でその JSON を開く → 同じ中身
//   5. 保存一覧に名前を付けて保存 → 別のプランを読込 → 一覧から開き直す → 同じ中身
//   6. 外観3D・内観3D・ウォークスルー → 3D の絵が単色でない → 平面図へ戻る
//   7. 起動時の選択で 3階建てを選んだとき、背後で先に開いていた 2階建ての壁の高さを引き継がない
//      (2階建てを編集したあとに別の既定プランへ切り替える画面上の導線は無い。
//       既定プランを選べるのは起動時の選択画面だけで、選ぶと閉じて二度と出ない)
//
// どの場面でも console.error と pageerror を集め、1つでも出たら落とす。
// '[WebCAD] plan load warnings' は console.warn なので集めていない(想定内)。
//
// APP_URL を外の URL(本番)に向けても動くように、サーバ上のテスト用ファイルには頼らない。
// 別のプランとして読む JSON は tools/tests/fixtures/ からファイル選択で渡す。
//
// sh tools/run_browser_tests.sh e2e-operations
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OTHER_PLAN = join(HERE, 'fixtures', 'house-2f.json');
const APP = process.env.APP_URL || 'http://localhost:8932/';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const VIEWPORT = { width: 1440, height: 1000 };
const T = { timeout: 60000 };

// ── ページを開き、エラーを集める ──
async function openPage(browser, label, errors, url = APP, beforeGoto = null) {
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await context.newPage();
  if (beforeGoto) await beforeGoto(page);
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console.error: ${m.text()}`); });
  // 起動時の「前回保存したプランがあります」の確認は「開く」で答える
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.DATA && DATA.walls && window.ST, null, T);
  return { context, page };
}

async function waitLoadingHidden(page) {
  await page.waitForFunction(() => {
    const l = document.getElementById('app-loading');
    return !l || getComputedStyle(l).display === 'none' || !l.classList.contains('show');
  }, null, T);
}

// 起動時の選択画面で選ぶ。key は '2f' / '3f' / 'blank'
async function choosePreset(page, key) {
  await page.locator('#preset-choice-modal.show').waitFor(T);
  if (key === 'blank') await page.locator('.preset-blank-btn', { hasText: '白紙から始める' }).click();
  else await page.locator('.preset-choice-btn', { hasText: key === '2f' ? '2階建て' : '3階建て' }).click();
  if (key === 'blank') {
    await page.waitForFunction(() => window.PRESET_CURRENT === 'blank' && _defaultPlanPending === false, null, T);
  } else {
    await page.waitForFunction((k) => window.PRESET_CURRENT === k && DATA.walls.length > 0
      && DATA.items.length > 0 && DATA.rooms.length > 0, key, T);
  }
  await page.locator('#preset-choice-modal').waitFor({ state: 'hidden', ...T });
  await waitLoadingHidden(page);
}

// 平面図のキャンバスに何かが描かれているか(画素の色が1色でないか)
async function planCanvasStats(page) {
  return page.evaluate(() => {
    const c = document.getElementById('c2d');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return { visible: getComputedStyle(c).display !== 'none', colors: colors.size };
  });
}

// ── 指紋: 再読み込み・書き出し・一覧の前後で比べる中身 ──
// 実行時だけの作業用の値(先頭が _ のキー。読み込んだテクスチャなど)は外す。
// 視点(viewState)は保存のたびに今のカメラで書き直されるので、開いた直後と
// 保存直前とでは違って当然。中身の比較からは外す。
function fingerprint() {
  const stable = (v) => JSON.stringify(v === undefined ? null : v, (k, x) => {
    if (k && k[0] === '_') return undefined;
    if (typeof x === 'function') return undefined;
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      return Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {});
    }
    return x;
  });
  const sorted = (arr) => arr.map((o) => stable(o)).sort();
  return {
    counts: { walls: DATA.walls.length, items: DATA.items.length, rooms: DATA.rooms.length },
    WALL_H: typeof WALL_H === 'number' ? WALL_H : null,
    wallHeights: DATA.walls.map((w) => `${w.id}:${w.floor || 1}:${w.wallHeight === undefined ? '-' : w.wallHeight}`).sort(),
    heightDefaults: stable(DATA.heightDefaults),
    floors: stable(DATA.floors),
    floorMetadata: stable(DATA.floorMetadata),
    exteriorWallSettings: stable(DATA.exteriorWallSettings),
    interiorWallSettings: stable(DATA.interiorWallSettings),
    roofAppearance: stable(DATA.roofAppearance),
    northDeg: DATA.northDeg === undefined ? null : DATA.northDeg,
    walls: sorted(DATA.walls),
    rooms: sorted(DATA.rooms),
    items: sorted(DATA.items),
  };
}

// 指紋どうしを比べ、違う項目の名前を先に出す(全体の差分は長すぎて読めないため)
function assertSamePlan(actual, expected, what) {
  const diff = Object.keys(expected).filter((k) => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]));
  if (diff.length) {
    const detail = diff.map((k) => {
      if (Array.isArray(expected[k])) {
        const a = new Set(actual[k]), e = new Set(expected[k]);
        const lost = expected[k].filter((x) => !a.has(x)).slice(0, 3);
        const extra = actual[k].filter((x) => !e.has(x)).slice(0, 3);
        return `${k}: 消えた ${JSON.stringify(lost)} / 増えた ${JSON.stringify(extra)}`;
      }
      return `${k}: 期待 ${JSON.stringify(expected[k])} / 実際 ${JSON.stringify(actual[k])}`;
    }).join('\n  ');
    assert.fail(`${what}: 中身が変わった項目がある\n  ${detail}`);
  }
}

// ── キャンバス操作の道具 ──
async function screenOf(page, wx, wy) {
  return page.evaluate(({ wx, wy }) => {
    const p = w2c(wx, wy), r = canvas.getBoundingClientRect();
    return { x: p.cx + r.left, y: p.cy + r.top };
  }, { wx, wy });
}
async function clickWorld(page, wx, wy, opts) {
  const p = await screenOf(page, wx, wy);
  await page.mouse.click(p.x, p.y, opts);
}
async function dragWorld(page, from, to) {
  const a = await screenOf(page, from[0], from[1]);
  const b = await screenOf(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

// 1階で、何も置かれていない広さ wMm × hMm の場所を、画面に見えている範囲から探す。
// 見つからなければ Ctrl+ホイールで縮小して探し直す(利用者が引いて空き地を探すのと同じ)。
async function findEmptyArea(page, wMm, hMm) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = await page.evaluate(({ wMm, hMm }) => {
      const r = canvas.getBoundingClientRect();
      const boxes = DATA.items.concat(DATA.walls, DATA.rooms)
        .filter((o) => (o.floor || 1) === ST.floor)
        .map((o) => {
          const pts = getObjBounds(o);
          if (!pts || !pts.length) return null;
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          const pad = 400;
          return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
        }).filter(Boolean);
      const step = 30;
      for (let sy = r.top + 60; sy < r.bottom - 60; sy += step) {
        for (let sx = r.left + 60; sx < r.right - 60; sx += step) {
          const o = c2w(sx - r.left, sy - r.top);
          const x1 = o.x, y1 = o.y, x2 = o.x + wMm, y2 = o.y + hMm;
          if (boxes.some((b) => !(x2 < b[0] || x1 > b[2] || y2 < b[1] || y1 > b[3]))) continue;
          // 画面上でキャンバスが見えていて、他の画面部品に覆われていないこと
          const corners = [];
          for (let fx = 0; fx <= 1; fx += 0.25) for (let fy = 0; fy <= 1; fy += 0.25) {
            const p = w2c(x1 + wMm * fx, y1 + hMm * fy);
            corners.push([p.cx + r.left, p.cy + r.top]);
          }
          if (corners.every(([x, y]) => x > 0 && y > 0 && x < innerWidth && y < innerHeight
            && document.elementFromPoint(x, y) === canvas)) {
            return { x: Math.ceil(x1 / 100) * 100 + 100, y: Math.ceil(y1 / 100) * 100 + 100 };
          }
        }
      }
      return null;
    }, { wMm: wMm + 200, hMm: hMm + 200 });
    if (found) return found;
    const c = await page.evaluate(() => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.5 }; });
    await page.mouse.move(c.x, c.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 25);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => true);
  }
  throw new Error('平面図の上に、操作に使える空き地が見つからない');
}

// サイドバーの道具を押す。道具の入った分類が閉じていれば、見出しを押して開く。
async function pickSidebarTool(page, tool) {
  const btn = page.locator(`#sidebar [data-tool="${tool}"]`).first();
  if (!(await btn.isVisible())) {
    const header = page.locator(`#sidebar .cat-body:has([data-tool="${tool}"])`).first()
      .locator('xpath=preceding-sibling::div[contains(@class,"cat-hdr")][1]');
    await header.click();
  }
  await btn.click();
  await page.waitForFunction((t) => ST.tool === t, tool, T);
}

const undoBtn = (page) => page.locator('#sidebar .common-tools [title="Undo"]');
const redoBtn = (page) => page.locator('#sidebar .common-tools [title="Redo"]');

// 3D のキャンバスを画面写真で撮り、色の数と明るさの幅を見る。
// 描画バッファを保持しない WebGL でも、画面に出た絵はスクリーンショットで取れる。
async function canvas3dStats(page) {
  // 3D の絵は three.js の描画先(ren.domElement)。#c3d-wrap にはミニマップの canvas も在る。
  const box = await page.evaluate(() => {
    if (!window.ren || !ren.domElement) return null;
    const r = ren.domElement.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!box || box.width < 50 || box.height < 50) return null;
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let minL = 255, maxL = 0, dark = 0, bright = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 53) {
      const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      colors.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
      minL = Math.min(minL, l); maxL = Math.max(maxL, l);
      if (l < 8) dark++;
      if (l > 247) bright++;
      n++;
    }
    return { colors: colors.size, range: Math.round(maxL - minL), darkRatio: dark / n, brightRatio: bright / n };
  }, png.toString('base64'));
}

async function waitFor3dPicture(page, label) {
  const deadline = Date.now() + 60000;
  let last = null;
  while (Date.now() < deadline) {
    last = await canvas3dStats(page);
    if (last && last.colors >= 40 && last.range >= 40 && last.darkRatio < 0.9 && last.brightRatio < 0.9) return last;
    await page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
  }
  assert.fail(`${label}: 3D の絵が単色のまま(真っ黒・真っ白・描けていない): ${JSON.stringify(last)}`);
}

const errors = [];
// 3D はソフトウェア描画だと重く、画面写真が時間切れになる。Mac では他の 3D の検査と
// 同じく GPU(Metal)で描かせる。headless のまま。
const browser = await chromium.launch(process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {});
const started = Date.now();
try {
  // ── 1. 起動して既定プラン・白紙を選ぶ ──
  const startedPlans = {};
  for (const key of ['2f', '3f', 'blank']) {
    const { context, page } = await openPage(browser, '起動 ' + key, errors);
    await choosePreset(page, key);
    const state = await page.evaluate(() => ({
      walls: DATA.walls.length, items: DATA.items.length, rooms: DATA.rooms.length,
      view: ST.view, twoDActive: document.getElementById('btn-2d').classList.contains('active'),
      WALL_H,
    }));
    const stats = await planCanvasStats(page);
    assert.equal(state.view, '2d', `${key}: 平面図で開いていない`);
    assert.ok(state.twoDActive, `${key}: 平面図のボタンが選ばれていない`);
    assert.ok(stats.visible, `${key}: 平面図のキャンバスが見えていない`);
    if (key === 'blank') {
      assert.deepEqual([state.walls, state.items, state.rooms], [0, 0, 0], '白紙なのに何か在る');
    } else {
      assert.ok(state.walls > 4 && state.items > 0 && state.rooms > 0, `${key}: 壁・物・部屋が揃っていない ${JSON.stringify(state)}`);
      assert.ok(stats.colors > 10, `${key}: 平面図に何も描かれていない(色 ${stats.colors})`);
    }
    startedPlans[key] = state;
    console.log(`ok  1. 起動 → ${key} を選ぶ → 平面図(壁 ${state.walls}・物 ${state.items}・部屋 ${state.rooms})`);
    await context.close();
  }

  // ── 7. 3階建てを選んだとき、背後で先に開いた 2階建ての壁の高さを引き継がない ──
  // 起動直後は選択画面の後ろで 2階建てを読み込んでいる。その読み込みが終わってから
  // 3階建てを選び、URL で直接 3階建てを開いたときと壁の高さが同じであることを見る。
  // 出荷している 2階建てと 3階建ては壁の高さが同じ値なので、そのままでは引き継いでも
  // 見分けがつかない。このページでだけ、2階建ての応答の壁の高さを 2500 に書き換えて渡す
  // (サーバのファイルは変えない。外の URL に向けても同じに動く)。
  {
    const TWO_F_WALL_H = 2500;
    const { context, page } = await openPage(browser, '切替 2f→3f', errors, APP, async (p) => {
      await p.route('**/assets/default_plan.json*', async (route) => {
        const res = await route.fetch();
        const plan = await res.json();
        plan.heightDefaults = { ...(plan.heightDefaults || {}), wallHeight: TWO_F_WALL_H };
        await route.fulfill({ response: res, json: plan });
      });
    });
    await page.locator('#preset-choice-modal.show').waitFor(T);
    await page.waitForFunction((h) => window.PRESET_CURRENT === '2f' && DATA.walls.length > 4 && WALL_H === h, TWO_F_WALL_H, T);
    const before = await page.evaluate(() => WALL_H);
    await choosePreset(page, '3f');
    const switched = await page.evaluate(() => ({ WALL_H, hd: JSON.stringify(DATA.heightDefaults), heights: DATA.walls.map((w) => w.wallHeight === undefined ? '-' : w.wallHeight).join(',') }));
    await context.close();
    const direct = await openPage(browser, '直接 3f', errors, APP + '?preset=3f');
    await direct.page.waitForFunction(() => window.PRESET_CURRENT === '3f' && DATA.walls.length > 4, null, T);
    await waitLoadingHidden(direct.page);
    const fresh = await direct.page.evaluate(() => ({ WALL_H, hd: JSON.stringify(DATA.heightDefaults), heights: DATA.walls.map((w) => w.wallHeight === undefined ? '-' : w.wallHeight).join(',') }));
    await direct.context.close();
    assert.deepEqual(switched, fresh, `2階建て(WALL_H=${before})のあとに選んだ 3階建ての壁の高さが、直接開いたときと違う`);
    console.log(`ok  7. 2階建て(WALL_H=${before})の読み込み後に 3階建てを選んでも、壁の高さは直接開いたときと同じ(WALL_H=${fresh.WALL_H})`);
  }

  // ── 2〜6 は 2階建てを開いた1つのページで続けて行う ──
  const { context, page } = await openPage(browser, '2階建ての編集', errors);
  await choosePreset(page, '2f');

  // ── 2. 編集の操作 ──
  const O = await findEmptyArea(page, 10000, 7000);
  const base = await page.evaluate(() => ({ walls: DATA.walls.length, items: DATA.items.length, rooms: DATA.rooms.length }));
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} と ${b} の差が ${tol} を超えた`);

  // 壁: 壁ツールで2点をクリックし、右クリックで引き終える
  await pickSidebarTool(page, 'wall');
  const W1 = [O.x + 1000, O.y + 1000], W2 = [O.x + 5000, O.y + 1000];
  await clickWorld(page, ...W1);
  await clickWorld(page, ...W2);
  await clickWorld(page, ...W2, { button: 'right' });
  await page.waitForFunction((n) => DATA.walls.length === n + 1 && !ST.drawing, base.walls, T);
  const wall = await page.evaluate(() => { const w = DATA.walls[DATA.walls.length - 1]; return { id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, floor: w.floor }; });
  near(wall.x1, W1[0], 150, '壁の始点X'); near(wall.y1, W1[1], 150, '壁の始点Y');
  near(wall.x2, W2[0], 150, '壁の終点X'); near(wall.y2, W2[1], 150, '壁の終点Y');
  assert.equal(wall.floor, 1);

  // 家具: サイドバーの「家具」から布団セットを選び、空き地をクリックして置く
  await pickSidebarTool(page, 'futon_set');
  const F = [O.x + 7000, O.y + 2500];
  await clickWorld(page, ...F);
  await page.waitForFunction((n) => DATA.items.length === n + 1 && ST.tool === 'select', base.items, T);
  const futon = await page.evaluate(() => { const i = DATA.items[DATA.items.length - 1]; return { id: i.id, type: i.type, x: i.x, y: i.y, w: i.w, d: i.d, selected: ST.selected === i }; });
  assert.equal(futon.type, 'futon_set');
  assert.ok(futon.selected, '置いた家具が選ばれていない');
  near(futon.x + futon.w / 2, F[0], 150, '家具の中心X'); near(futon.y + futon.d / 2, F[1], 150, '家具の中心Y');

  // 部屋: 部屋(矩形)で対角の2点をクリック
  await pickSidebarTool(page, 'room-rect');
  const R1 = [O.x + 1000, O.y + 2500], R2 = [O.x + 4000, O.y + 5500];
  await clickWorld(page, ...R1);
  await clickWorld(page, ...R2);
  await page.waitForFunction((n) => DATA.rooms.length === n + 1 && !ST.drawing, base.rooms, T);
  const room = await page.evaluate(() => { const r = DATA.rooms[DATA.rooms.length - 1]; return { x: r.x, y: r.y, w: r.w, d: r.d, floor: r.floor }; });
  near(room.x, R1[0], 60, '部屋のX'); near(room.y, R1[1], 60, '部屋のY');
  near(room.w, 3000, 120, '部屋の幅'); near(room.d, 3000, 120, '部屋の奥行');

  // 移動: 選択ツールで家具を掴んで動かす
  await pickSidebarTool(page, 'select');
  const fc = [futon.x + futon.w / 2, futon.y + futon.d / 2];
  await dragWorld(page, fc, [fc[0] + 1000, fc[1] + 1500]);
  await page.waitForFunction(() => !DRAG.active, null, T);
  const moved = await page.evaluate((id) => { const i = DATA.items.find((o) => o.id === id); return { x: i.x, y: i.y }; }, futon.id);
  near(moved.x - futon.x, 1000, 60, '家具の移動量X'); near(moved.y - futon.y, 1500, 60, '家具の移動量Y');

  // 削除: 引いた壁をクリックで選び、Delete キー
  await clickWorld(page, (wall.x1 + wall.x2) / 2, (wall.y1 + wall.y2) / 2);
  await page.waitForFunction((id) => ST.selected && ST.selected.id === id, wall.id, T);
  await page.keyboard.press('Delete');
  await page.waitForFunction((id) => !DATA.walls.some((w) => w.id === id), wall.id, T);

  // Undo / Redo のボタン
  const has = () => page.evaluate(({ wid, fid }) => {
    const f = DATA.items.find((o) => o.id === fid);
    return { wall: DATA.walls.some((w) => w.id === wid), futon: f ? [f.x, f.y] : null };
  }, { wid: wall.id, fid: futon.id });
  await undoBtn(page).click();
  assert.deepEqual(await has(), { wall: true, futon: [moved.x, moved.y] }, 'Undo 1回で壁の削除が戻らない');
  await undoBtn(page).click();
  assert.deepEqual(await has(), { wall: true, futon: [futon.x, futon.y] }, 'Undo 2回で家具が元の位置へ戻らない');
  await redoBtn(page).click();
  assert.deepEqual(await has(), { wall: true, futon: [moved.x, moved.y] }, 'Redo で家具の移動がやり直されない');
  await redoBtn(page).click();
  assert.deepEqual(await has(), { wall: false, futon: [moved.x, moved.y] }, 'Redo で壁の削除がやり直されない');
  await undoBtn(page).click();
  assert.deepEqual(await has(), { wall: true, futon: [moved.x, moved.y] }, '最後の Undo で壁が戻らない');
  const edited = await page.evaluate(() => ({ walls: DATA.walls.length, items: DATA.items.length, rooms: DATA.rooms.length }));
  assert.deepEqual(edited, { walls: base.walls + 1, items: base.items + 1, rooms: base.rooms + 1 });
  console.log('ok  2. 壁を引く・家具を置く・部屋を描く・移動・Delete・Undo/Redo ボタンで DATA が期待どおりに変わった');

  // ── 3. 保存 → 再読み込み → 復元 ──
  // 壁の高さも利用者の操作で変えておく(出荷時の値のままだと、復元で既定へ戻っても
  // 見分けがつかないことがある)。サイドバーの「壁・床の既定値」で 2F の壁の高さを 2750 に。
  {
    const NEW_2F = 2750;
    const old2f = await page.evaluate(() => defaultWallHeightMmForFloor(2));
    assert.notEqual(old2f, NEW_2F, '2F の壁の高さが最初から 2750（変えたことが確かめられない）');
    const input = page.locator('#height-defaults-body .hd-row', { has: page.locator('.hd-tag', { hasText: /^2F$/ }) })
      .locator('input[title="壁の高さ(mm)"]');
    await input.fill(String(NEW_2F));
    await input.press('Tab');
    await page.waitForFunction((h) => defaultWallHeightMmForFloor(2) === h, NEW_2F, T);
    const retagged = await page.evaluate((h) => DATA.walls.filter((w) => w.floor === 2 && w.wallHeight === h).length, NEW_2F);
    assert.ok(retagged > 0, '2F の壁の高さを変えたのに、2F の壁が1本も新しい高さになっていない');
  }
  assert.ok(await page.evaluate(() => DIRTY), '編集したのに未保存の印が付いていない');
  await page.locator('#save-btn').click();
  await page.waitForFunction(() => !DIRTY, null, T);
  const savedPrint = await page.evaluate(fingerprint);
  assert.ok(savedPrint.walls.some((s) => s.includes(`"id":${JSON.stringify(wall.id)}`)), '保存前の指紋に引いた壁が無い');
  await page.reload();
  await page.waitForFunction((n) => window.DATA && DATA.walls && window._defaultPlanPending === false
    && DATA.walls.length === n, savedPrint.counts.walls, T);
  await waitLoadingHidden(page);
  const restoredPrint = await page.evaluate(fingerprint);
  assertSamePlan(restoredPrint, savedPrint, '保存 → 再読み込み');
  assert.ok(await page.evaluate((id) => DATA.walls.some((w) => w.id === id), wall.id), '編集で足した壁が復元されていない');
  assert.equal(await page.locator('#preset-choice-modal').evaluate((el) => el.classList.contains('show')), false, '復元したのに間取りの選択画面が出ている');
  console.log(`ok  3. 保存 → 再読み込みで同じ中身(壁 ${restoredPrint.counts.walls}・物 ${restoredPrint.counts.items}・部屋 ${restoredPrint.counts.rooms}・WALL_H ${restoredPrint.WALL_H})`);

  // ── 4. JSON の書き出し → 白紙 → 読込 ──
  const [download] = await Promise.all([
    page.waitForEvent('download', T),
    page.locator('.toolbar-actions button[onclick="exportPlan()"]').click(),
  ]);
  const exportedPath = await download.path();
  assert.ok(exportedPath, '書き出したファイルが保存されていない');
  const exportedPrint = await page.evaluate(fingerprint);
  const exported = JSON.parse(readFileSync(exportedPath, 'utf8'));
  assert.equal(exported.walls.length, exportedPrint.counts.walls, '書き出したファイルの壁の数が画面と違う');
  {
    const blank = await openPage(browser, '白紙から読込', errors);
    await choosePreset(blank.page, 'blank');
    const [chooser] = await Promise.all([
      blank.page.waitForEvent('filechooser', T),
      blank.page.locator('.toolbar-actions button', { hasText: '読込' }).click(),
    ]);
    await chooser.setFiles(exportedPath);
    await blank.page.waitForFunction((n) => DATA.walls.length === n, exportedPrint.counts.walls, T);
    assertSamePlan(await blank.page.evaluate(fingerprint), exportedPrint, '書き出し → 白紙 → 読込');
    await blank.context.close();
  }
  console.log('ok  4. JSON を書き出し → 白紙から「読込」で開くと、書き出す前と同じ中身');

  // ── 5. 保存一覧 ──
  await page.locator('#plan-library-btn').click();
  await page.locator('.plan-library-save-new').click();
  await page.fill('.plan-library-name-input', 'E2E案');
  await page.press('.plan-library-name-input', 'Enter');
  await page.waitForFunction(() => PLAN_LIBRARY_ID, null, T);
  const libraryPrint = await page.evaluate(fingerprint);
  // 別のプラン(凍結した間取り)を「読込」で開く
  {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', T),
      page.locator('.toolbar-actions button', { hasText: '読込' }).click(),
    ]);
    await chooser.setFiles(OTHER_PLAN);
    const otherWalls = JSON.parse(readFileSync(OTHER_PLAN, 'utf8')).walls.length;
    await page.waitForFunction((n) => DATA.walls.length === n && PLAN_LIBRARY_ID === null, otherWalls, T);
    const other = await page.evaluate(fingerprint);
    assert.notDeepEqual(other.walls, libraryPrint.walls, '別のプランを読み込んだのに壁が同じ');
  }
  await page.locator('#plan-library-btn').click();
  await page.locator('.plan-library-row:has-text("E2E案") >> button:has-text("開く")').click();
  await page.waitForFunction((n) => PLAN_LIBRARY_ID && DATA.walls.length === n, libraryPrint.counts.walls, T);
  assertSamePlan(await page.evaluate(fingerprint), libraryPrint, '保存一覧 → 別のプラン → 一覧から開く');
  console.log('ok  5. 保存一覧に名前を付けて保存 → 別のプランを読込 → 一覧から開くと同じ中身');

  // ── 6. 3D 表示 ──
  for (const [id, name] of [['btn-3de', '外観3D'], ['btn-3di', '内観3D'], ['btn-3dw', 'ウォークスルー']]) {
    await page.locator('#' + id).click();
    await waitLoadingHidden(page);
    await page.waitForFunction(() => document.getElementById('c3d-wrap').style.display !== 'none' && window.ren, null, T);
    const stats = await waitFor3dPicture(page, name);
    console.log(`ok  6. ${name}: 色 ${stats.colors}・明るさの幅 ${stats.range}`);
  }
  await page.locator('#btn-2d').click();
  await page.waitForFunction(() => ST.view === '2d' && document.getElementById('c2d').style.display !== 'none', null, T);
  assert.ok((await planCanvasStats(page)).colors > 10, '3D から平面図に戻ったら何も描かれていない');
  console.log('ok  6. 3D から平面図へ戻った');
  await context.close();

  assert.deepEqual(errors, [], 'コンソールのエラー・ページの例外:\n' + errors.join('\n'));
  console.log(`PASS e2e-operations (${((Date.now() - started) / 1000).toFixed(1)} 秒)`);
} finally {
  await browser.close();
}
