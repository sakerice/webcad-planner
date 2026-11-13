// 共同編集で、相手が変えた「壁の高さの既定」「階ごとの高さ」「部屋の自動照明を切る設定」が
// 手元に届くこと。届かないと、同じルームにいるのに自分だけ古い高さ・照明で見続ける
// (ルームに入り直すまで直らない)。
//
// サーバーは使わない。ページを2枚開き、1枚め(送り手)の buildSharedPatch の結果を
// 2枚め(受け手)の applySharedPatch(patch,false) に手で運ぶ。
//
// 細工: 共有の変更追跡は「ルームに参加中」(SHARED.roomId がある)のときしか働かないので、
// 両方のページで SHARED.roomId に形だけの値を入れる。そのままだと markDirty が
// 700ms 後に /api/rooms/… へ送ろうとして追跡の記録を消してしまうので、送信の予約
// (queueSharedSync)と手元への自動保存の予約(queueSharedLocalAutoSave)を空の関数にする。
// それ以外は本物の関数をそのまま呼ぶ。
//
// sh tools/run_browser_tests.sh shared-fields
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 30000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 見本。既定は高さを持たない古い保存データ(階ごとの高さは切、WALL_H は 2400 で開く)。
// saved-2f は階ごとの高さが入の保存データ。
const FIXTURE = (name) => join(HERE, 'fixtures', 'compat', name + '.json');

async function openPage(browser, label, errors, file = FIXTURE('legacy-no-heights'), share = true) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console.error: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + '?preset=blank');
  await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
  // 「読込」と同じ入口で見本のプランを開く
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', file);
  await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 4, null, T);
  await page.waitForTimeout(300);
  if (!share) return { context, page };
  // ルームに参加中に見せる(上の「細工」)
  await page.evaluate(() => {
    window.queueSharedSync = function () {};
    window.queueSharedLocalAutoSave = function () {};
    SHARED.roomId = 'testroomtestroomtestro';
    SHARED.baseline = sharedBaselineFrom(DATA);
    sharedResetDirtyTracking();
  });
  return { context, page };
}

async function pair(browser, errors, file) {
  const a = await openPage(browser, '送り手', errors, file);
  const b = await openPage(browser, '受け手', errors, file);
  return { a: a.page, b: b.page, close: async () => { await a.context.close(); await b.context.close(); } };
}

// 送り手の差分を作り、受け手へ当てる。送り手は送ったことにして基準を進める。
// echo: 受けた直後に受け手が送り返す差分が無いことまで見るか(受け手に未送信の変更があるときは false)
async function carry(a, b, echo = true) {
  const patch = await a.page.evaluate(() => {
    const p = buildSharedPatch(DATA, SHARED.baseline);
    SHARED.baseline = sharedBaselineFrom(DATA);
    sharedResetDirtyTracking();
    return p;
  });
  if (patch) {
    // 受けた直後(3D の作り直しの前)に、受け手から送り返す差分が無く、送信の予約もしていないこと
    const check = echo;
    echo = await b.page.evaluate((p) => {
      let queued = 0;
      const q = window.queueSharedSync;
      window.queueSharedSync = function () { queued++; };
      try { applySharedPatch(p, false); } finally { window.queueSharedSync = q; }
      return { queued, again: buildSharedPatch(DATA, SHARED.baseline) };
    }, patch);
    assert.equal(echo.queued, 0, '受けた変更を送り返す予約をした');
    if (check) assert.equal(echo.again, null, '受けた直後に送り返す差分がある: ' + JSON.stringify(echo.again).slice(0, 200));
  }
  return patch;
}

const wallHeights = (page) => page.evaluate(() => DATA.walls.map((w) => [String(w.id), w.wallHeight === undefined ? null : w.wallHeight]).sort());
// 全部の物の高さ(elev)。id → 値
const itemElevs = (page) => page.evaluate(() => Object.fromEntries(DATA.items.map((i) => [String(i.id), i.elev === undefined ? null : i.elev])));
function diffElevs(want, got) {
  const ids = [...new Set([...Object.keys(want), ...Object.keys(got)])];
  return ids.filter((id) => want[id] !== got[id]).map((id) => `${id}: ${want[id]} / ${got[id]}`);
}

const results = [];
async function test(name, fn, file) {
  const errors = [];
  const browser = await chromium.launch();
  let p = null;
  try {
    p = await pair(browser, errors, file);
    await fn({ a: { page: p.a }, b: { page: p.b }, browser, errors });
    assert.deepEqual(errors, [], 'ページでエラーが出た');
    results.push(['ok  ', name]);
  } catch (e) {
    results.push(['FAIL', name + '\n    ' + String(e && e.message || e).split('\n').join('\n    ')]);
  } finally {
    if (p) await p.close();
    await browser.close();
  }
}

await test('相手が変えた壁の高さの既定が届く', async ({ a, b }) => {
  // 受け手は 3D を開いている(描き直しまで見る)
  await b.page.evaluate(() => {
    setView('3d-ext');
    window.__counts = { draw2d: 0, rebuild3D: 0 };
    const d = window.draw2d, r = window.rebuild3D;
    window.draw2d = function () { window.__counts.draw2d++; return d.apply(this, arguments); };
    window.rebuild3D = function () { window.__counts.rebuild3D++; return r.apply(this, arguments); };
  });
  const before = await b.page.evaluate(() => WALL_H);
  assert.equal(before, 2400);
  // 送り手は家具を1つ選んだまま、設定パネルで壁の高さを変える
  await a.page.evaluate(() => {
    ST.selected = DATA.items.find((i) => i.type !== 'site-rect') || DATA.items[0];
    setDefaultWallHeight(null, 2600);
  });
  const patch = await carry(a, b);
  assert.ok(patch, '差分が出ない');
  assert.ok(patch.collections.walls && patch.collections.walls.upserts.length > 0,
    '高さを付け替えた既存の壁が差分に入っていない: ' + JSON.stringify(Object.keys(patch.collections)));
  await b.page.waitForTimeout(1200);
  const got = await b.page.evaluate(() => ({
    WALL_H,
    newWall: mkWall(0, 0, 1000, 0).wallHeight,
    panel: (document.querySelector('#height-defaults-body input') || {}).value,
    counts: window.__counts,
  }));
  assert.equal(got.WALL_H, 2600, '受け手の WALL_H');
  assert.equal(got.newWall, 2600, '受け手で新しく引く壁の高さ');
  assert.deepEqual(await wallHeights(b.page), await wallHeights(a.page), '既存の壁の高さが送り手と違う');
  assert.equal(got.panel, '2600', '設定パネルの壁の高さが描き直されていない');
  assert.ok(got.counts.draw2d > 0, '平面図が描き直されていない');
  assert.ok(got.counts.rebuild3D > 0, '3D が描き直されていない');
});

await test('階ごとの高さが届く', async ({ a, b }) => {
  await a.page.evaluate(() => { setPerFloorHeights(true); setDefaultWallHeight(2, 2700); });
  assert.ok(await carry(a, b), '差分が出ない');
  const pick = (page) => page.evaluate(() => ({ floors: JSON.stringify(DATA.floors), per: perFloorHeightsEnabled(), f2: defaultWallHeightMmForFloor(2), checked: document.getElementById('height-per-floor').checked }));
  const sa = await pick(a.page), sb = await pick(b.page);
  assert.equal(sb.per, true, '受け手で階ごとの高さが入になっていない');
  assert.equal(sb.floors, sa.floors, '受け手の DATA.floors が送り手と違う');
  assert.equal(sb.f2, 2700);
  assert.equal(sb.checked, true, '設定パネルの「階ごと」が描き直されていない');
  assert.deepEqual(await wallHeights(b.page), await wallHeights(a.page), '既存の壁の高さが送り手と違う');
});

await test('自動照明を切った設定が届く', async ({ a, b }) => {
  await a.page.evaluate(() => setAutoRoomLights(false));
  assert.ok(await carry(a, b), '切ったときに差分が出ない');
  let sb = await b.page.evaluate(() => ({ on: autoRoomLightsEnabled(), box: document.getElementById('auto-room-lights').checked }));
  assert.equal(sb.on, false, '受け手で自動照明が切れていない');
  assert.equal(sb.box, false, '照明パネルのチェックが描き直されていない');
  // 入に戻す(送り手では欄を消す)変更も届き、受け手の保存データに余計な欄が残らない
  await a.page.evaluate(() => setAutoRoomLights(true));
  const patch = await carry(a, b);
  assert.ok(patch, '入に戻したときに差分が出ない');
  sb = await b.page.evaluate(() => ({ on: autoRoomLightsEnabled(), box: document.getElementById('auto-room-lights').checked, has: 'autoRoomLights' in DATA, json: JSON.stringify(DATA).includes('"autoRoomLights"') }));
  assert.equal(sb.on, true, '受け手で自動照明が入に戻っていない');
  assert.equal(sb.box, true);
  assert.equal(sb.has, false, '受け手のプランに autoRoomLights の欄が残った');
  assert.equal(sb.json, false, '保存データに autoRoomLights が残る');
});

await test('欄の無い差分を受けても今の値を保つ', async ({ b }) => {
  await b.page.evaluate(() => { setDefaultWallHeight(null, 2550); setAutoRoomLights(false); SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking(); });
  const before = await b.page.evaluate(() => JSON.stringify([DATA.heightDefaults, DATA.floors, DATA.autoRoomLights, WALL_H]));
  // 古い版の送り手: 高さ・照明の欄を知らない
  await b.page.evaluate(() => applySharedPatch({ collections: {}, fields: {} }, false));
  await b.page.evaluate(() => applySharedPatch({ collections: {}, fields: { northDeg: 15 } }, false));
  const after = await b.page.evaluate(() => JSON.stringify([DATA.heightDefaults, DATA.floors, DATA.autoRoomLights, WALL_H]));
  assert.equal(after, before);
});

await test('視点は届かない', async ({ a, b }) => {
  const view = (page) => page.evaluate(() => JSON.stringify([DATA.viewState === undefined ? null : DATA.viewState, Math.round(ST.zoom * 1000), Math.round(ST.panX), Math.round(ST.panY)]));
  const before = await view(b.page);
  await a.page.evaluate(() => {
    ST.zoom *= 2; ST.panX += 500; ST.panY -= 300;
    DATA.viewState = { twoD: { zoom: ST.zoom, panX: ST.panX, panY: ST.panY } };
    setDefaultWallHeight(null, 2650);
  });
  const patch = await carry(a, b);
  assert.ok(patch, '差分が出ない');
  assert.ok(!('viewState' in patch.fields), '視点が差分に入った');
  // 送り手が視点を混ぜてきても当てない
  await b.page.evaluate(() => applySharedPatch({ collections: {}, fields: { viewState: { twoD: { zoom: 9, panX: 1, panY: 2 } } } }, false));
  assert.equal(await view(b.page), before);
  assert.equal(await b.page.evaluate(() => WALL_H), 2650);
});

// ── 高さの既定を変えたとき、照明などの物の高さも送り手と受け手でそろう ──
// 受け手は差分を当てたあとの補完で、天井付けの照明を新しい天井面へ寄せる。送り手も同じ寄せ方を
// 通さないと、同じ間取りなのに照明の高さだけが食い違う。
async function elevsAgree(a, b, change) {
  const before = await itemElevs(a.page);
  await a.page.evaluate(change);
  const moved = diffElevs(before, await itemElevs(a.page));
  assert.ok(moved.length > 0, '高さを変えても送り手で動いた物が無い(照明が古い高さのまま)');
  assert.ok(await carry(a, b), '差分が出ない');
  const off = diffElevs(await itemElevs(a.page), await itemElevs(b.page));
  assert.deepEqual(off, [], `送り手と受け手で物の高さが違う(${off.length}件, 送り手 / 受け手)`);
  assert.deepEqual(await wallHeights(b.page), await wallHeights(a.page));
}

await test('高さの既定を変えると、物の高さも送り手と受け手でそろう(古いデータ)', async ({ a, b }) => {
  await elevsAgree(a, b, () => setDefaultWallHeight(null, 2600));
});

await test('高さの既定を変えると、物の高さも送り手と受け手でそろう(階ごとの高さが入)', async ({ a, b }) => {
  await elevsAgree(a, b, () => { setDefaultWallHeight(1, 2800); setDefaultWallHeight(2, 2600); });
}, FIXTURE('saved-2f'));

// 1人で使うとき: 高さを変えた直後の物の高さが、保存して読み直した後と同じ。undo で両方戻る。
await test('高さの既定を変えた直後の物の高さは、読み直した後と同じ。undo で戻る', async ({ a, browser, errors }) => {
  const start = await a.page.evaluate(() => JSON.stringify({ hd: DATA.heightDefaults, WALL_H, items: DATA.items.map((i) => [i.id, i.elev]) }));
  await a.page.evaluate(() => setDefaultWallHeight(null, 2600));
  const now = await itemElevs(a.page);
  const saved = await a.page.evaluate(() => serializeDataSnapshot());
  const dir = mkdtempSync(join(tmpdir(), 'shared-fields-'));
  try {
    const file = join(dir, 'saved.json');
    writeFileSync(file, saved);
    const c = await openPage(browser, '読み直し', errors, file, false);
    try {
      const off = diffElevs(now, await itemElevs(c.page));
      assert.deepEqual(off, [], `変えた直後と読み直した後で物の高さが違う(${off.length}件, 直後 / 読み直し)`);
    } finally { await c.context.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  await a.page.evaluate(() => undoAction());
  const back = await a.page.evaluate(() => JSON.stringify({ hd: DATA.heightDefaults, WALL_H, items: DATA.items.map((i) => [i.id, i.elev]) }));
  assert.equal(back, start, 'undo 1回で、高さの既定と物の高さが元に戻らない');
});

// ── 受け手の未送信の変更が、相手の差分を受けても消えない ──
// 受け手が家具を動かした直後(まだ送っていない間)に相手の差分を受けても、その家具の変更は
// 次の送信に残る。前は差分を当てたあとに基準を丸ごと取り直していたので、二度と送られなかった。
const pickItem = () => DATA.items.find((i) => i.type !== 'site-rect' && !/^light-/.test(i.type) && (i.floor || 1) === 1);
async function moveItemUnsent(page) {
  return page.evaluate((pick) => {
    const it = (0, eval)('(' + pick + ')')();
    ST.selected = it; saveState(); it.x += 300; ST.selected = null;
    return String(it.id);
  }, pickItem.toString());
}
async function keptAfter(a, b, senderChange) {
  const id = await moveItemUnsent(b.page);
  await a.page.evaluate(senderChange);
  assert.ok(await carry(a, b, false), '送り手の差分が出ない');
  const mine = await b.page.evaluate((id) => {
    const p = buildSharedPatch(DATA, SHARED.baseline);
    const ups = (p && p.collections.items && p.collections.items.upserts) || [];
    const sent = ups.find((u) => String(u.id) === id);
    const now = DATA.items.find((i) => String(i.id) === id);
    return { sent: sent ? sent.x : null, now: now.x };
  }, id);
  assert.notEqual(mine.sent, null, '受け手が動かした家具が、次に送る差分に入っていない');
  assert.equal(mine.sent, mine.now);
}

await test('相手の壁の変更を受けても、受け手の未送信の家具の移動は次に送られる', async ({ a, b }) => {
  await keptAfter(a, b, () => { ST.selected = null; const w = DATA.walls[3]; ST.selected = w; saveState(); w.x1 += 200; ST.selected = null; });
});

await test('相手の高さの既定の変更を受けても、受け手の未送信の家具の移動は次に送られる', async ({ a, b }) => {
  await keptAfter(a, b, () => { ST.selected = null; setDefaultWallHeight(null, 2600); });
});

await test('同じ家具を両方が変えていたら、受けた値が勝つ(送り返さない)', async ({ a, b }) => {
  const id = await moveItemUnsent(b.page);
  const sender = await a.page.evaluate((id) => {
    const it = DATA.items.find((i) => String(i.id) === id);
    ST.selected = it; saveState(); it.y += 200; ST.selected = null;
    return { x: it.x, y: it.y };
  }, id);
  assert.ok(await carry(a, b, false), '送り手の差分が出ない');
  const got = await b.page.evaluate((id) => {
    const it = DATA.items.find((i) => String(i.id) === id);
    const p = buildSharedPatch(DATA, SHARED.baseline);
    const ups = (p && p.collections.items && p.collections.items.upserts) || [];
    return { x: it.x, y: it.y, resend: ups.some((u) => String(u.id) === id) };
  }, id);
  assert.deepEqual({ x: got.x, y: got.y }, sender, '受け手の家具が送り手の値になっていない');
  assert.equal(got.resend, false, '受けた値で上書きされた家具を送り返そうとしている');
});

for (const [s, n] of results) console.log(`${s} ${n}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
if (failed) { console.log(`FAIL shared-fields: ${failed}/${results.length}`); process.exit(1); }
console.log(`PASS shared-fields: ${results.length} 件`);
