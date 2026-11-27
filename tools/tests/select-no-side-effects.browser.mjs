// 物を選んだだけ・3D に切り替えただけでは、プランが書き換わらず、共同編集の相手にも何も送られないことを確かめる。
//
// なぜ要るか: 設定欄を描く updateProps() と、壁の面の設定を読む関数が、読むだけの場面でプランへ値を書いていた。
//   - 家具を選ぶと elev:0 が書かれた。未保存の印も取り消しの履歴も付かないのに、書き出す JSON には入り、
//     共同編集では手元(elev:0)と相手(無し)に分かれた。
//   - 壁を選ぶ・3D に切り替えると、外観と内観の設定に空の欄(mode:'inherit' …)が増え、共同編集では設定が
//     丸ごと1回送られた。受けた相手は、取り消しの履歴が消え、複数選択が外れ、保存ボタンが「今すぐ保存」に変わった。
// 直したあとは、欄を作るのは利用者が設定欄で値を変えたときだけ。その書き込みが壊れていないことも、ここで見る。
//
// 既定プランは読まない。tools/tests/fixtures/house-2f.json を読み込み、本物のマウス操作で選ぶ。
// 共同編集の2画面は shared-drag-release と同じ作り(サーバーは使わず、テスト側の中継でつなぐ)。
//
// sh tools/run_browser_tests.sh select-no-side-effects
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const FIXTURE = join(HERE, 'fixtures', 'house-2f.json');
const T = { timeout: 30000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ページを1枚開き、テスト用のプランを読み込む。room があれば、共同編集のルームに参加した直後と同じ状態にする。
async function openPage(browser, errors, label, room) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  if (room) {
    await page.exposeFunction('__relayUpdate', async (body) => {
      const payload = JSON.parse(body);
      await sleep(20);
      const version = ++room.version;
      const msg = { type: 'patch', version, expiresAt: Date.now() + 1e9, clientId: payload.clientId, patch: payload.patch };
      room.log.push({ from: label, version, patch: payload.patch });
      room.chain = room.chain.then(() => {
        for (const p of room.pages) {
          p.page.evaluate((m) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(m) }), msg).catch(() => {});
        }
      });
      await sleep(20);
      return JSON.stringify({ version, expiresAt: msg.expiresAt, savedAt: 0, checkpointPending: true, conflict: false });
    });
    await page.addInitScript((label) => {
      try { sessionStorage.setItem('webcad-collab-client', 'client-' + label + '-0000000000000000'); } catch (e) {}
      class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} }
      window.WebSocket = FakeWS;
      const realFetch = window.fetch.bind(window);
      window.fetch = function (url, init) {
        if (typeof url === 'string' && /\/api\/rooms\/[^/]+\/update$/.test(url)) {
          return window.__relayUpdate(init.body).then((txt) => new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return realFetch(url, init);
      };
    }, label);
  }
  await page.goto(APP + '?preset=blank');
  await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', FIXTURE);
  await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 4, null, T);
  await page.waitForTimeout(300);
  if (room) {
    await page.evaluate(() => {
      window.queueSharedLocalAutoSave = function () {};
      SHARED.roomId = 'testroomtestroomtestro'; SHARED.version = 1;
      SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking();
      connectSharedSocket(); clearDirty(); clearEditHistory();
    });
    room.pages.push({ label, page, context });
  } else {
    await page.evaluate(() => { clearDirty(); clearEditHistory(); });
  }
  return { page, context };
}
async function makeRoom(browser) {
  const room = { version: 1, pages: [], log: [], errors: [], chain: Promise.resolve() };
  room.a = (await openPage(browser, room.errors, 'A', room)).page;
  room.b = (await openPage(browser, room.errors, 'B', room)).page;
  room.close = async () => { for (const p of room.pages) await p.context.close(); };
  return room;
}
// 送る予約・送信中が無く、中継に新しい差分が来なくなるまで待つ
async function settle(r) {
  let quiet = 0, last = -1;
  for (let i = 0; i < 60 && quiet < 4; i++) {
    await sleep(400);
    await r.chain;
    const busy = await Promise.all([r.a, r.b].map((p) => p.evaluate(() => !!sharedHasTrackedChanges() || SHARED.sending || !!SHARED.timer)));
    const ok = !busy[0] && !busy[1] && r.log.length === last;
    quiet = ok ? quiet + 1 : 0; last = r.log.length;
  }
}
const sendsFrom = (r, label) => r.log.filter((l) => l.from === label).length;

// つかめる物と、つかむ画面上の位置を探す(shared-drag-release の findGrab と同じ調べ方)。
// want: 'furnitureNoElev'(高さ Z の欄が出る家具で、elev を持たない物)・'wall'(厚さ 120mm 以上で、設定欄に内面と外面が出る壁)
const findGrab = (page, want) => page.evaluate((want) => {
  ST.selected = null; clearMultiSelection(); DRAG.active = false;
  const rect = canvas.getBoundingClientRect();
  const isWall = want === 'wall', coll = isWall ? 'walls' : 'items', kind = isWall ? 'wall' : 'item';
  for (const obj of DATA[coll]) {
    if ((obj.floor || 1) !== ST.floor || isObjectLocked(obj)) continue;
    if (isWall) {
      if ((obj.thick || 0) < 120) continue;
      const inner = getWallInteriorFaces(obj).filter((f) => !wallFaceCoveredByOtherWalls(obj, f.a / U, f.b / U, f.sign));
      if (!inner.length || !getWallExteriorSpans(obj).length) continue;
    } else {
      if (!/^(fmp-|im0261-|washer)/.test(obj.type || '') || !canSetItemElevation(obj)) continue;
      if (Object.prototype.hasOwnProperty.call(obj, 'elev')) continue;
    }
    let points;
    if (isWall) points = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85].map((t) => ({ x: obj.x1 + (obj.x2 - obj.x1) * t, y: obj.y1 + (obj.y2 - obj.y1) * t }));
    else { const pose = getItemDisplayPose(obj); points = [{ x: pose.x, y: pose.y }]; }
    for (const w of points) {
      const c0 = w2c(w.x, w.y), px = Math.round(rect.left + c0.cx), py = Math.round(rect.top + c0.cy);
      const c = { cx: px - rect.left, cy: py - rect.top };
      if (c.cx < 40 || c.cy < 40 || c.cx > rect.width - 200 || c.cy > rect.height - 80) continue;
      if (document.elementFromPoint(px, py) !== canvas) continue;
      const at = c2w(c.cx, c.cy);
      const cands = collect2DPickCandidates(c.cx, c.cy, snapV(at.x), snapV(at.y), { includeRoomArea: false });
      if (!cands.length || cands[0].obj !== obj || cands[0].kind !== kind) continue;
      return { id: String(obj.id), coll, x: px, y: py };
    }
  }
  return null;
}, want);

// 本物のマウスで1回クリックして選ぶ。選べたことまで確かめる。
async function clickSelect(page, g, what) {
  assert.ok(g, `${what}: 条件に合う物がテスト用のプランに見つからない`);
  await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.up();
  await sleep(150);
  const ok = await page.evaluate((g) => !!ST.selected && String(ST.selected.id) === g.id && document.getElementById('props').classList.contains('show'), g);
  assert.equal(ok, true, `${what}: クリックで選べていない(テストの操作が効いていない)`);
}
const readObj = (page, g) => page.evaluate((g) => {
  const o = DATA[g.coll].find((i) => String(i.id) === g.id);
  return o ? JSON.stringify(o, (k, v) => (k === '_texObj' ? undefined : v)) : null;
}, g);
const settingsJson = (page) => page.evaluate(() => ({
  exterior: JSON.stringify(DATA.exteriorWallSettings === undefined ? null : DATA.exteriorWallSettings),
  interior: JSON.stringify(DATA.interiorWallSettings === undefined ? null : DATA.interiorWallSettings),
}));
// 設定の JSON が変わっていれば、増えた・変わった欄の鍵を数件添えて落とす
function assertSettingsSame(before, after, name) {
  for (const part of ['exterior', 'interior']) {
    if (before[part] === after[part]) continue;
    const b = JSON.parse(before[part]) || {}, a = JSON.parse(after[part]) || {};
    const changed = [];
    for (const table of ['walls', 'faces', 'floors', 'whole']) {
      const bt = b[table] || {}, at = a[table] || {};
      for (const k of new Set([...Object.keys(bt), ...Object.keys(at)])) if (JSON.stringify(bt[k]) !== JSON.stringify(at[k])) changed.push(`${table}[${k}]`);
    }
    assert.fail(`${name}: ${part === 'exterior' ? 'exteriorWallSettings' : 'interiorWallSettings'} が書き換わった(${changed.length} 欄。例: ${changed.slice(0, 3).join(' ')})`);
  }
}
const editState = (page) => page.evaluate(() => ({ dirty: !!DIRTY, history: HISTORY.length }));
// 3D の外観へ、画面のボタンで切り替える。壁が組み上がるまで待つ。
async function switchTo3D(page) {
  await page.click('#btn-3de');
  await page.waitForFunction(() => ST.view === '3d-ext' && typeof ren !== 'undefined' && !!ren && typeof sc3 !== 'undefined' && !!sc3 && typeof camExt !== 'undefined' && !!camExt, null, { timeout: 120000, polling: 200 });
  // 組み立ては切り替えのあとに走る。壁の面の色を決める関数が呼ばれ終わるまで少し待つ
  await page.waitForTimeout(1500);
}

const single = {
  async '(a) elev を持たない家具を選んでも、その家具の JSON は変わらない'(page) {
    const g = await findGrab(page, 'furnitureNoElev');
    assert.ok(g, 'elev を持たない家具がテスト用のプランに見つからない');
    const before = await readObj(page, g);
    assert.ok(!/"elev"/.test(before), 'テストの前提: 選ぶ前から elev がある');
    await clickSelect(page, g, '家具');
    // 高さ Z の欄は出ていて、0 と表示される(書かなくても表示は変わらない)
    const shown = await page.evaluate(() => { const el = document.querySelector('#props-body input[onchange*="\'elev\'"]'); return el ? el.value : null; });
    assert.equal(shown, '0', '高さ Z の欄が 0 と表示されていない');
    assert.equal(await readObj(page, g), before, '家具を選んだだけで、その家具の JSON が変わった');
    assert.deepEqual(await editState(page), { dirty: false, history: 0 }, '選んだだけで、未保存の印か取り消しの履歴が付いた');
    // 高さが数でない(NaN)物を選んでも、欄は 0 と表示され、壊れない
    const nan = await page.evaluate(() => { ST.selected.elev = NaN; updateProps(); const el = document.querySelector('#props-body input[onchange*="\'elev\'"]'); return { value: el ? el.value : null, rows: document.querySelectorAll('#props-body .pr').length }; });
    assert.equal(nan.value, '0', '高さが NaN の物で、高さ Z の欄が 0 と表示されていない');
    assert.ok(nan.rows > 3, '高さが NaN の物で、設定欄が描けていない');
  },
  async '(b) 厚さ 120mm 以上の壁を選んでも、外観・内観の設定の JSON は変わらない'(page) {
    const g = await findGrab(page, 'wall');
    const before = await settingsJson(page);
    await clickSelect(page, g, '壁');
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('#props-body .face-card-title')).map((e) => e.textContent.trim()));
    assert.ok(cards.some((t) => /^内面/.test(t)) && cards.some((t) => /^外面/.test(t)), `設定欄に内面と外面の欄が出ていない(出ている欄: ${cards.join(' ')})`);
    assertSettingsSame(before, await settingsJson(page), '壁を選んだだけ');
    // 壁そのものの JSON は見ない。updateProps() は選んだ物に sScale・sX・sY を補う(別件。この検査の対象は設定の欄)。
    assert.deepEqual(await editState(page), { dirty: false, history: 0 }, '選んだだけで、未保存の印か取り消しの履歴が付いた');
  },
  async '(c) 3D に切り替えても、外観・内観の設定の JSON は変わらない'(page) {
    const before = await settingsJson(page);
    await switchTo3D(page);
    const built = await page.evaluate(() => { let n = 0; sc3.traverse((o) => { if (o.isMesh) n++; }); return n; });
    assert.ok(built > 50, `3D が組み上がっていない(メッシュ ${built} 個)`);
    assertSettingsSame(before, await settingsJson(page), '3D に切り替えただけ');
  },
};

const shared = {
  async '(d) 共同編集中に壁を選んだだけ・3D に切り替えただけでは何も送られず、相手の取り消しの履歴と複数選択が残る'(r) {
    // 相手(B)に、取り消しの履歴1件と、2つの複数選択を用意する(保存ボタンは「保存済み」のまま)
    const bBefore = await r.b.evaluate(() => {
      pushHistorySnapshot(HISTORY, serializeDataSnapshot());
      const two = DATA.items.filter((i) => (i.floor || 1) === ST.floor && /^(fmp-|im0261-)/.test(i.type || '')).slice(0, 2);
      ST.multiSelected = [two[0]]; ST.selected = two[1]; updateProps(); draw2d(); renderSaveButtonState();
      return { history: HISTORY.length, multi: ST.multiSelected.length, selected: String(ST.selected.id), save: document.getElementById('save-btn').textContent.trim() };
    });
    assert.deepEqual([bBefore.history, bBefore.multi], [1, 1], 'テストの前提: 相手の履歴と複数選択を用意できていない');
    assert.match(bBefore.save, /保存済み/, 'テストの前提: 相手の保存ボタンが「保存済み」でない');
    const bState = () => r.b.evaluate(() => ({ history: HISTORY.length, multi: (ST.multiSelected || []).length, selected: ST.selected ? String(ST.selected.id) : null, save: document.getElementById('save-btn').textContent.trim() }));

    const settingsBefore = await settingsJson(r.a);
    await clickSelect(r.a, await findGrab(r.a, 'wall'), '壁');
    await settle(r);
    assert.equal(sendsFrom(r, 'A'), 0, `壁を選んだだけなのに、相手へ ${sendsFrom(r, 'A')} 回送られた`);
    assert.equal(await r.a.evaluate(() => !!sharedHasTrackedChanges()), false, '壁を選んだだけで、送る候補の印が付いた');
    assert.deepEqual(await bState(), bBefore, '壁を選んだだけで、相手の取り消しの履歴・複数選択・保存ボタンが変わった');

    await switchTo3D(r.a);
    await settle(r);
    assert.equal(sendsFrom(r, 'A'), 0, `3D に切り替えただけなのに、相手へ ${sendsFrom(r, 'A')} 回送られた`);
    assert.deepEqual(await bState(), bBefore, '3D に切り替えただけで、相手の取り消しの履歴・複数選択・保存ボタンが変わった');
    assert.equal(await r.b.evaluate(() => { SHARED.forceScan = true; const rest = buildSharedPatch(DATA, SHARED.baseline); SHARED.forceScan = false; return !!rest; }), false, '相手の手元に、基準と違う所がある');
    // 手元と相手で、外観・内観の設定が食い違っていない(手元だけに空の欄が増えていない)
    assertSettingsSame(settingsBefore, await settingsJson(r.a), '共同編集中に壁を選び、3D に切り替えただけ');
    assert.deepEqual(await settingsJson(r.b), settingsBefore, '相手の外観・内観の設定が変わった');
    assert.deepEqual(r.errors, [], 'ページで例外');
  },
  async '(e) 設定欄で壁の面の色を変えたときは、面の欄が作られて値が入り、相手に届く'(r) {
    const g = await findGrab(r.a, 'wall');
    await clickSelect(r.a, g, '壁');
    const before = await settingsJson(r.a);
    // 内面と外面のそれぞれで、「個別設定を利用」を選び、個別カラーを変える
    const wanted = { interior: '#336699', exterior: '#884422' }, keys = {};
    for (const [part, title] of [['interior', '内面'], ['exterior', '外面']]) {
      const card = () => r.a.locator('#props-body .face-card', { has: r.a.locator('.face-card-title', { hasText: title }) }).first();
      keys[part] = await card().getAttribute('data-face-key');
      assert.ok(keys[part], `${title}の欄の鍵が取れない`);
      await card().locator('input[type=radio]').first().check();   // 個別設定を利用
      await sleep(150);
      const color = card().locator('input[type=color]').first();
      assert.equal(await color.isDisabled(), false, `${title}: 個別設定にしても、個別カラーの欄が使えない`);
      await color.fill(wanted[part]);
      await color.blur();
      await sleep(150);
    }
    await settle(r);
    const after = await settingsJson(r.a);
    for (const part of ['interior', 'exterior']) {
      const slot = (JSON.parse(after[part]).faces || {})[keys[part]];
      assert.ok(slot, `${part}: 色を変えたのに、面の欄が作られていない`);
      assert.equal(slot.mode, 'custom', `${part}: 面の欄の mode が custom でない`);
      assert.equal(slot.color, wanted[part], `${part}: 面の欄に色が入っていない`);
      assert.equal(Object.keys(JSON.parse(before[part]).faces || {}).length + 1, Object.keys(JSON.parse(after[part]).faces).length, `${part}: 変えた面のほかにも欄が増えた`);
    }
    assert.ok(sendsFrom(r, 'A') >= 1, '色を変えたのに、相手へ送られていない');
    assert.deepEqual(await settingsJson(r.b), after, '相手の画面の外観・内観の設定が、変えた手元と違う');
    // 3D の色を決める関数も、変えた色を返す(書く側と読む側が同じ欄を見ている)
    const resolved = await r.b.evaluate(([id, keys]) => {
      const w = DATA.walls.find((x) => String(x.id) === id);
      const inFace = getWallInteriorFaces(w).find((f) => interiorFaceKey(w, f) === keys.interior);
      const exFace = getWallExteriorSpans(w).find((f) => exteriorFaceKey(w, f) === keys.exterior);
      return { interior: resolveInteriorFaceAppearance(w, inFace).color, exterior: resolveExteriorFaceAppearance(w, exFace).color };
    }, [g.id, keys]);
    assert.deepEqual(resolved, wanted, '相手の画面で、3D の面の色が変えた色になっていない');
    assert.deepEqual(r.errors, [], 'ページで例外');
  },
};

const browser = await chromium.launch();
let failed = 0;
const report = (name, e) => { failed++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); };
try {
  for (const [name, fn] of Object.entries(single)) {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
    const errors = [];
    const { page, context } = await openPage(browser, errors, '1');
    try { await fn(page); assert.deepEqual(errors, [], 'ページで例外'); console.log('ok   ' + name); }
    catch (e) { report(name, e); }
    finally { await context.close(); }
  }
  for (const [name, fn] of Object.entries(shared)) {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
    const r = await makeRoom(browser);
    try { await fn(r); console.log('ok   ' + name); }
    catch (e) { report(name, e); }
    finally { await r.close(); }
  }
} finally {
  await browser.close();
}
assert.equal(failed, 0, `${failed} 件が失敗`);
console.log(`PASS select-no-side-effects: ${Object.keys(single).length + Object.keys(shared).length} 件`);
