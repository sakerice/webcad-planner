// プランの中の文字で、画面にスクリプトを差し込めないこと。
//
// なぜ要るか: プランのどの欄も、他人が決められる(他人のプランのファイル、共有 URL、
// 共同編集の相手の差分、AI の出力)。欄の文字をエスケープせずに画面の HTML へつないで
// いた所があり、物を1回選ぶだけで相手のスクリプトが動いた(2026-11 の監査で実際に確かめた)。
// 種類名(type)などで表を引く所は、継承した鍵(constructor・__proto__ …)に当たると
// 3D が全部出なくなり、自動保存に残って起動のたびに壊れたままになった。
//
// 攻撃の文字は tools/tests/fixtures/injection/payloads.json(AI への入力のテストと共用)。
// 土台は tools/tests/fixtures/house-2f.json。
//
// 入れる道:
//   (a) ファイルの読み込み(doImport と同じ道。#import-file)
//   (b) 共有 URL への参加(ルームの GET を偽物にする)
//   (c) 共同編集の相手の差分(WebSocket の patch と presence)
//   (d) 選択中の物を相手が書き換える差分(applySharedPatch が欄を描き直す)
// 見ること: 全部の壁・物・部屋を選ぶ、外観・内観・屋根の色の欄、高さの既定、ロック管理、
// プラン一覧、共有のダイアログ、一括差し替え・建物の仕上げのダイアログ、図面(全部の図面と印刷)、
// 3D の作り直し。そのあいだ window.__xss が空、オリジンの外への要求が無い、
// pageerror が無い、操作が例外を出さない、画面に差し込まれたハンドラが無いこと。
//
// アプリには「物の一覧」「検索」の画面は無い(2026-11 時点)。物の名前が出る所は、
// 設定欄・一括差し替え・建物の仕上げのダイアログ・図面で見ている。
//
// sh tools/run_browser_tests.sh injection-screen
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch3dSkips, read3dSkips } from './build3d-skips.mjs';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const ORIGIN = new URL(APP).origin;
const T = { timeout: 60000 };
// 攻撃の文字と、それを入れたプランの作り方は injection-plan.cjs(node の単体テストと共用)
const { PAYLOADS, BASE, clone, stringPayloads, tagged, sparse, inheritedValue, evilPlan } = createRequire(import.meta.url)('./injection-plan.cjs');
// index.html が自分で読む外部(書体)。これ以外のオリジン外への要求は失敗にする。どれも実際には送らない。
const APP_EXTERNAL = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const ROOM = 'InjectionTestRoom00001';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ページ ───────────────────────────────────────────────────
const browser = await chromium.launch();
const failures = [];
function note(where, what) { failures.push(`${where}: ${what}`); }

async function openPage(label, { shared = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const st = { label, outside: [], errors: [], dialogs: [] };
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === ORIGIN || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (!APP_EXTERNAL.has(u.hostname)) st.outside.push(u.href.slice(0, 160));
    return route.abort();
  });
  page.on('pageerror', (e) => st.errors.push(e.message.slice(0, 300)));
  // 3D の作り直しは、1つの物で例外が出るとその物だけ飛ばして console.error を出す(残りは描く)。
  // 飛ばした物があれば、作り直しが例外を出したのと同じに扱う(check でも window.__build3dSkipped を見る)。
  watch3dSkips(page, st.errors);
  page.on('dialog', (d) => { st.dialogs.push(d.message().slice(0, 120)); d.dismiss().catch(() => {}); });
  await page.addInitScript(() => {
    window.__xss = [];
    // 共同編集のソケットは偽物にする(テストから __ws.onmessage で差分を入れる)
    class FakeWS { constructor(url) { this.url = url; this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() { this.readyState = 3; } }
    window.WebSocket = FakeWS;
  });
  if (shared) {
    await page.route('**/api/rooms/' + ROOM, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: JSON.stringify(shared) }));
    await page.route('**/api/rooms/' + ROOM + '/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(APP + '#room=' + ROOM);
    await page.waitForFunction(() => window.SHARED && SHARED.roomId && window.__ws, null, T);
  } else {
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.DATA && window.ST && window._defaultPlanPending === false, null, T);
  }
  await page.waitForTimeout(300);
  return { context, page, st };
}

async function importPlan(page, plan) {
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.waitForFunction(() => window.DATA !== window.__before, null, T);
  await page.waitForTimeout(300);
}

// 土台のプランを開き、壁の面の設定の鍵を集める(面の鍵は壁の id と面の位置から作られる)
async function collectFaceKeys() {
  const { context, page } = await openPage('face-keys');
  await importPlan(page, BASE);
  const keys = await page.evaluate(() => {
    const ex = [], int = [];
    DATA.walls.forEach((w) => {
      getWallExteriorSpans(w).forEach((f) => ex.push(exteriorFaceKey(w, f)));
      getWallInteriorFaces(w).forEach((f) => int.push(interiorFaceKey(w, f)));
    });
    return { exterior: ex, interior: int };
  });
  await context.close();
  return keys;
}

// 利用者が触る画面をひととおり開く。例外は集めて返す。
const SWEEP = async ({ with3D }) => {
  const errs = [];
  const step = (name, fn) => { try { fn(); } catch (e) { errs.push(name + ': ' + String(e && e.message || e).slice(0, 200)); } };
  for (const n of ['walls', 'items', 'rooms']) {
    (DATA[n] || []).forEach((o, i) => step(`選ぶ ${n}[${i}]`, () => { ST.selected = o; updateProps(); }));
  }
  step('選択を外す', () => { ST.selected = null; updateProps(); });
  for (const m of ['exterior', 'interior', 'roof']) step('色の欄 ' + m, () => renderExteriorWallPanel(m));
  step('外観カラー設定を開く', () => toggleExteriorColorPanel());
  step('高さの既定', () => syncHeightDefaultsUI());
  step('ロック管理', () => syncLockBatchUi());
  step('共有のダイアログ', () => { openShareDialog(); renderSharedUi(); });
  step('プラン一覧', () => PlanLibrary.openList());
  (window.AssetSets && AssetSets.sets() || []).forEach((s) => {
    if (s.swap && window.AssetSwap) step('一括差し替え ' + s.id, () => { AssetSwap.open(s.id); const m = document.getElementById('asset-swap-modal'); if (m) m.setAttribute('data-test-seen', '1'); });
    if (s.style && window.BuildingStyle) step('建物の仕上げ ' + s.id, () => { BuildingStyle.open(s.id); });
  });
  step('図面', () => {
    openJisDrawingDialog();
    JISDRAW.availableSheets().forEach((s) => jisSelectSheet(s.kind, s.key));
    jisPrint();
  });
  if (with3D) {
    step('3D 外観', () => { setView('3d-ext'); });
    step('3D の作り直し', () => { if (typeof sc3 !== 'undefined' && sc3) perform3DRebuild(); });
  }
  await new Promise((r) => setTimeout(r, 400));
  return { errs, has3D: typeof sc3 !== 'undefined' && !!sc3 };
};

// 画面に差し込まれた物を探す(押さないと動かないハンドラも見つける)
const SCAN = () => {
  const bad = [];
  const scan = (doc, where) => {
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) {
        const n = a.name.toLowerCase(), v = a.value;
        if (n.startsWith('on') && /__xss/.test(v)) bad.push(`${where} <${el.tagName.toLowerCase()} ${n}="${v.slice(0, 80)}">`);
        if (/^(href|src|xlink:href|action|formaction|srcdoc)$/.test(n) && /^\s*javascript:/i.test(v)) bad.push(`${where} <${el.tagName.toLowerCase()} ${n}=javascript:>`);
        if (n === 'style' && /attacker\.invalid/.test(v)) bad.push(`${where} <${el.tagName.toLowerCase()} style="${v.slice(0, 80)}">`);
      }
      if (el.tagName === 'SCRIPT' && /__xss/.test(el.textContent)) bad.push(`${where} <script>${el.textContent.slice(0, 60)}`);
    });
    doc.querySelectorAll('iframe').forEach((f, i) => { try { if (f.contentDocument) scan(f.contentDocument, where + ' iframe' + i); } catch (e) { /* 別オリジン */ } });
  };
  scan(document, 'page');
  return { bad, xss: (window.__xss || []).slice(0, 20) };
};

async function check(where, page, st, extra = {}) {
  const r = await page.evaluate(SCAN);
  if (r.xss.length) note(where, 'スクリプトが動いた: ' + r.xss.join(', '));
  if (r.bad.length) note(where, '画面に差し込まれた: ' + r.bad.slice(0, 5).join(' / '));
  if (st.outside.length) note(where, 'オリジンの外へ要求: ' + [...new Set(st.outside)].slice(0, 5).join(' '));
  if (st.errors.length) note(where, 'pageerror: ' + [...new Set(st.errors)].slice(0, 5).join(' / '));
  const skipped = await read3dSkips(page);
  if (skipped && skipped.count) note(where, `3D で ${skipped.count} 個飛ばした: ` + skipped.ids.join(', '));
  if (extra.errs && extra.errs.length) note(where, '操作が例外: ' + extra.errs.slice(0, 6).join(' / ') + (extra.errs.length > 6 ? ` ほか${extra.errs.length - 6}件` : ''));
  st.outside.length = 0; st.errors.length = 0;
  await page.evaluate(() => { window.__xss.length = 0; window.__build3dSkipped = 0; window.__build3dSkippedIds = []; });
}

try {
  const faceKeys = await collectFaceKeys();
  assert.ok(faceKeys.exterior.length > 0 && faceKeys.interior.length > 0, '面の鍵が集まらない(空振りの検査になる)');
  const strings = stringPayloads();
  // INJECTION_ONLY=dq-img,inherited-keys のように、文字の id で絞って走らせられる(直している最中の確かめ用)
  const only = (process.env.INJECTION_ONLY || '').split(',').filter(Boolean);
  const plans = [
    ...strings.map((p) => ({ id: p.id, plan: evilPlan(p.id === PAYLOADS.long.id ? sparse(tagged(p)) : tagged(p), faceKeys) })),
    { id: 'inherited-keys', plan: evilPlan(inheritedValue(), faceKeys, { inherited: true }) },
  ].filter((x) => !only.length || only.includes(x.id));

  // (a) ファイルの読み込み。1つの文字ごとに開き直す。3D は1つおきに見る(時間)
  {
    const { context, page, st } = await openPage('file');
    let n = 0;
    for (const { id, plan } of plans) {
      const where = `(a) ファイル ${id}`;
      await importPlan(page, plan);
      const loaded = await page.evaluate(() => DATA.walls.length + DATA.items.length + DATA.rooms.length);
      if (loaded < 100) note(where, '読み込めていない(空振り)');
      const with3D = id === 'inherited-keys' || n++ % 3 === 0;
      const r = await page.evaluate(SWEEP, { with3D });
      if (with3D && !r.has3D) note(where, '3D が作られていない(空振り)');
      await page.waitForTimeout(300);
      await check(where, page, st, r);
      await page.evaluate(() => { document.querySelectorAll('#asset-swap-modal,#plan-library-modal').forEach((m) => m.remove()); setView('2d'); });
      if (st.dialogs.length) { note(where, 'ダイアログ: ' + st.dialogs.join(' / ')); st.dialogs.length = 0; }
    }
    await context.close();
  }

  // 印刷用の iframe は中のスクリプトを動かさない(sandbox)。それでも親から印刷を呼べること。
  // headless では印刷のダイアログは見えないので、iframe の print が呼ばれたかを数える。
  if (!only.length || only.includes('dq-img')) {
    const { context, page, st } = await openPage('print');
    await importPlan(page, plans.find((x) => x.id === 'dq-img').plan);
    const r = await page.evaluate(async () => {
      let called = 0, sandbox = null, inner = null;
      const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.tagName !== 'IFRAME') return;
        sandbox = n.getAttribute('sandbox');
        n.addEventListener('load', () => { const w = n.contentWindow; const real = w.print.bind(w); w.print = () => { called++; real(); }; inner = n.contentDocument.querySelectorAll('svg').length; });
      })));
      mo.observe(document.body, { childList: true });
      openJisDrawingDialog(); jisPrint();
      await new Promise((res) => setTimeout(res, 2600));
      mo.disconnect();
      return { called, sandbox, inner };
    });
    assert.equal(r.sandbox, 'allow-same-origin allow-modals', '印刷用の iframe に sandbox が無い');
    assert.equal(r.inner, 1, '印刷用の iframe に図面が入っていない');
    assert.equal(r.called, 1, '印刷が呼ばれていない');
    await check('印刷', page, st);
    await context.close();
  }

  // (b) 共有 URL への参加。参加しただけで描かれる物と、そのあとの操作
  for (const { id, plan } of plans.filter((x) => ['dq-img', 'sq-svg', 'js-string', 'js-number', 'attr-break', 'inherited-keys'].includes(x.id))) {
    const where = `(b) 共有 ${id}`;
    const { context, page, st } = await openPage('share-' + id, { shared: plan });
    await check(where + ' 参加直後', page, st);
    const r = await page.evaluate(SWEEP, { with3D: id === 'inherited-keys' });
    await check(where, page, st, r);
    await context.close();
  }

  // (c)(d) 共同編集の相手の差分。土台のプランで参加し、相手の差分で欄を書き換える
  for (const { id, plan } of plans.filter((x) => ['dq-img', 'js-string', 'attr-break', 'inherited-keys'].includes(x.id))) {
    const { context, page, st } = await openPage('patch-' + id, { shared: clone(BASE) });
    // (d) 先に物・壁・部屋を選んでおき、相手がその物を書き換える(何もしなくても欄が描き直される)
    for (const [coll, pick] of [['items', (it) => it.type === 'custom-block'], ['items', (it) => it.type === 'roof'], ['walls', (w, i) => i === 4], ['rooms', (r, i) => i === 0], ['items', (it) => it.type === 'window']]) {
      const base = BASE[coll].find(pick);
      const evil = plan[coll].find((o) => o.x === base.x && o.y === base.y && o.x1 === base.x1 && o.y1 === base.y1 && (o.floor === base.floor || coll !== 'items'));
      assert.ok(evil, `(d) 攻撃のプランに、土台の ${coll} と同じ位置の物が見つからない(空振りの検査になる)`);
      const body = Object.assign({}, evil, { id: base.id });
      await page.evaluate(([coll, id]) => { ST.selected = DATA[coll].find((o) => String(o.id) === String(id)); updateProps(); }, [coll, base.id]);
      const ver = await page.evaluate(() => SHARED.version + 1);
      await page.evaluate((m) => window.__ws.onmessage({ data: JSON.stringify(m) }), { type: 'patch', version: ver, clientId: 'someone-else', patch: { collections: { [coll]: { upserts: [body], removes: [] } }, fields: {} } });
      await page.waitForTimeout(150);
      await check(`(d) 選択中の${coll}を相手が書き換え ${id}`, page, st);
    }
    // (c) 全部を相手の差分で入れ替える(id が変わる物は消して足す)
    const ver = await page.evaluate(() => SHARED.version + 1);
    const collections = {};
    for (const coll of ['walls', 'items', 'rooms']) collections[coll] = { upserts: plan[coll], removes: BASE[coll].map((o) => o.id) };
    const fields = {};
    for (const k of ['exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail']) fields[k] = plan[k];
    await page.evaluate((m) => window.__ws.onmessage({ data: JSON.stringify(m) }), { type: 'patch', version: ver, clientId: 'someone-else', patch: { collections, fields } });
    const name = tagged(PAYLOADS.markup[0])('presence.name');
    await page.evaluate((m) => window.__ws.onmessage({ data: JSON.stringify(m) }), { type: 'presence', people: [{ name }, { name: id === 'inherited-keys' ? '__proto__' : name + '2' }] });
    await page.waitForTimeout(300);
    const where = `(c) 相手の差分 ${id}`;
    await check(where + ' 受けた直後', page, st);
    const r = await page.evaluate(SWEEP, { with3D: id === 'inherited-keys' });
    await check(where, page, st, r);
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  assert.fail(`プランの文字で画面が壊れた・差し込まれた: ${failures.length}件`);
}
console.log('攻撃の文字: どの道・どの欄でも、スクリプトは動かず、外への要求も例外も無い');
