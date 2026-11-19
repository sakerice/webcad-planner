// 他人のプランが画面に入る入口のすべてに、壊れた・攻撃のプランを通す(実物の画面、headless)。
//
// 入口: ファイルの読み込み(#import-file)・共有 URL の部屋に入る・相手の差分(WebSocket)・自動保存の復元(起動時)・
//       プラン一覧から開く(PlanLibrary.loadIntoEditor)・比較で並べる(CompareMode.start)・
//       読み取りとチャットの取り込み(どちらも DATA を差し替えて normalizeLoadedPlan を呼ぶ。同じ呼び方で確かめる)。
// 見ること: pageerror が無い・3D で飛ばした物が無い・Object.prototype が汚れない・ページが固まらない
//   (次の evaluate が返る)・そろえた後の形(配列・素のオブジェクト・座標が有限・階が範囲)・3D と設定欄を開ける。
// 大きさ: 2 百万字の部屋の名前は切られて数秒で開く。物の数が上限を超えたプランは、どの入口でも入れずに
//   利用者向けの文で断り、今のプランが残る。上限ちょうどのプランは開ける(かかった時間を出す)。
//
// sh tools/run_browser_tests.sh plan-load-guards
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { watch3dSkips } from './build3d-skips.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'injection', 'plans.json'), 'utf8'));
const LIMITS = createRequire(import.meta.url)('../../assets/js/plan-schema.js').LIMITS;
const ROOM = 'PlanLoadGuardRoom00001';
const T = { timeout: 90000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const caseText = (c) => (c.json !== undefined ? c.json : JSON.stringify(c.plan));

const browser = await chromium.launch();
const failures = [];
const note = (where, what) => failures.push(`${where}: ${what}`);

async function openPage(label, { room = null, storage = null, preset = 'blank' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const st = { label, errors: [], dialogs: [] };
  page.on('pageerror', (e) => st.errors.push(e.message.slice(0, 300)));
  watch3dSkips(page, st.errors);
  // 起動時の「前回保存したプランがあります。読み込みますか？」は受ける(自動保存の復元の道を通すため)。ほかは閉じる。
  page.on('dialog', (d) => { const m = d.message(); st.dialogs.push(m.slice(0, 200)); (/前回保存したプラン/.test(m) ? d.accept() : d.dismiss()).catch(() => {}); });
  await page.addInitScript(() => {
    class FakeWS { constructor(url) { this.url = url; this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() { this.readyState = 3; } }
    window.WebSocket = FakeWS;
  });
  if (room !== null) {
    await page.route('**/api/rooms/' + ROOM, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: room }));
    await page.route('**/api/rooms/' + ROOM + '/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1}' }));
    await page.goto(APP + '#room=' + ROOM);
    await page.waitForFunction(() => window.SHARED && (SHARED.roomId || document.getElementById('share-status')), null, T);
    await page.waitForTimeout(800);
    return { context, page, st };
  }
  if (storage !== null) {
    // 先に同じオリジンで保存の枠へ文字のまま書き(__proto__ を自分の鍵として保つ)、起動し直す
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.PRESET_CURRENT === 'blank', null, T);
    await page.evaluate((text) => new Promise((resolve, reject) => {
      const req = indexedDB.open('webcad', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('plans')) req.result.createObjectStore('plans'); };
      req.onsuccess = () => { const t = req.result.transaction('plans', 'readwrite'); t.objectStore('plans').put(text, 'webcad-plan-v1'); t.oncomplete = () => { req.result.close(); resolve(); }; t.onerror = () => reject(t.error); };
      req.onerror = () => reject(req.error);
    }), storage);
    await page.goto(APP);
    // 保存を開いた(_defaultPlanPending が false)か、開かずに既定プランの選択を出したかのどちらか
    await page.waitForFunction(() => window.DATA && window.ST && (window._defaultPlanPending === false
      || (document.getElementById('preset-choice-modal') || { classList: { contains: () => false } }).classList.contains('show')), null, T).catch(() => {});
    await page.waitForTimeout(800);
    return { context, page, st };
  }
  await page.goto(APP + '?preset=' + preset);
  await page.waitForFunction((p) => window.PRESET_CURRENT === p && window._defaultPlanPending === false, preset, T);
  await page.waitForTimeout(200);
  return { context, page, st };
}

// そろえた後の形と、Object.prototype の汚れ。戻り値は問題の文の配列。
const SHAPE = (max) => {
  const out = [];
  const C = { walls: ['x1', 'y1', 'x2', 'y2'], rooms: ['x', 'y', 'w', 'd'], items: ['x', 'y'] };
  for (const n of ['walls', 'items', 'rooms']) {
    if (!Array.isArray(DATA[n])) { out.push(n + ' が配列でない'); continue; }
    DATA[n].forEach((o, i) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) { out.push(`${n}[${i}] が素のオブジェクトでない`); return; }
      C[n].forEach((k) => { if (typeof o[k] !== 'number' || !isFinite(o[k]) || Math.abs(o[k]) > 1e9) out.push(`${n}[${i}].${k}=${String(o[k]).slice(0, 30)}`); });
      if (o.floor !== undefined && o.floor !== null && !(typeof o.floor === 'number' && o.floor >= 1 && o.floor <= max)) out.push(`${n}[${i}].floor=${o.floor}`);
      Object.keys(o).forEach((k) => { const v = o[k]; if (typeof v === 'string' && v.length > 10000 && v.slice(0, 5) !== 'data:') out.push(`${n}[${i}].${k} が長い`); });
    });
  }
  const stack = [DATA];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    ['__proto__', 'constructor', 'prototype'].forEach((k) => { if (Object.prototype.hasOwnProperty.call(v, k)) out.push('危ない鍵 ' + k + ' が残っている'); });
    Object.keys(v).forEach((k) => { if (k !== '_texObj') stack.push(v[k]); });
  }
  if (({}).polluted !== undefined) out.push('Object.prototype が汚れた');
  if (Object.getPrototypeOf(DATA) !== Object.prototype) out.push('プランの継承元が差し替えられた');
  return out;
};

// 入れた後に触る: 全部を選ぶ・2D・3D(外観)・色の欄。例外は集めて返す。
const SWEEP = () => {
  const errs = [];
  const step = (name, fn) => { try { fn(); } catch (e) { errs.push(name + ': ' + String(e && e.message || e).slice(0, 200)); } };
  for (const n of ['walls', 'items', 'rooms']) (DATA[n] || []).slice(0, 400).forEach((o, i) => step(`選ぶ ${n}[${i}]`, () => { ST.selected = o; updateProps(); }));
  step('選択を外す', () => { ST.selected = null; updateProps(); });
  step('2D', () => draw2d());
  step('3D', () => { setView('3d-ext'); rebuild3D(); });
  for (const m of ['exterior', 'interior', 'roof']) step('色の欄 ' + m, () => renderExteriorWallPanel(m));
  step('2D に戻す', () => setView('2d'));
  return errs;
};

async function check(where, page, st, { sweep = true } = {}) {
  const t0 = Date.now();
  let alive = false;
  try { alive = await Promise.race([page.evaluate(() => true), new Promise((r) => setTimeout(() => r(false), 30000))]); } catch (e) { alive = false; }
  if (!alive) { note(where, 'ページが 30 秒応えない(固まった)'); return; }
  const shape = await page.evaluate(SHAPE, LIMITS.MAX_FLOOR);
  shape.forEach((s) => note(where, s));
  if (sweep) {
    const errs = await page.evaluate(SWEEP);
    errs.forEach((e) => note(where, e));
    await page.waitForTimeout(300);
  }
  st.errors.splice(0).forEach((e) => note(where, 'pageerror ' + e));
  const ms = Date.now() - t0;
  if (ms > 30000) note(where, `確かめに ${ms}ms かかった`);
}

async function importText(page, text) {
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForFunction(() => window.DATA !== window.__before, null, T).catch(() => {});
  await page.waitForTimeout(300);
}

// ── 1. 固定集を、すべての入口に通す ──────────────────────────────
// CASES=id,id で固定集の一部だけを走らせる(手元で直すとき)。
const ONLY = (process.env.CASES || '').split(',').filter(Boolean);
for (const c of FIX.plans.filter((x) => !process.env.MEASURE && (!ONLY.length || ONLY.includes(x.id)))) {
  const caseStart = Date.now();
  const text = caseText(c);
  const want = c.expect;
  const counts = (page) => page.evaluate(() => ({ walls: DATA.walls.length, items: DATA.items.length, rooms: DATA.rooms.length }));
  const expectCounts = async (where, page) => {
    const got = await counts(page);
    for (const n of ['walls', 'items', 'rooms']) if (got[n] !== want[n]) note(where, `${n} が ${got[n]} 個(期待 ${want[n]})`);
  };

  // ファイルの読み込み
  {
    const { context, page, st } = await openPage('file ' + c.id);
    await importText(page, text);
    await expectCounts('ファイル ' + c.id, page);
    await check('ファイル ' + c.id, page, st);
    await context.close();
  }
  // 共有 URL の部屋に入る
  {
    const { context, page, st } = await openPage('room ' + c.id, { room: text });
    const joined = await page.evaluate(() => !!(SHARED && SHARED.roomId));
    if (!joined) note('共有の部屋 ' + c.id, '部屋に入れなかった: ' + await page.evaluate(() => document.getElementById('share-status').textContent));
    else { await expectCounts('共有の部屋 ' + c.id, page); await check('共有の部屋 ' + c.id, page, st); }
    await context.close();
  }
  // 自動保存の復元(起動時)
  {
    const { context, page, st } = await openPage('storage ' + c.id, { storage: text });
    await check('自動保存 ' + c.id, page, st);
    await context.close();
  }
  // 一覧から開く・比較で並べる・読み取りとチャットの取り込みの道(DATA を差し替えて normalizeLoadedPlan)
  {
    const { context, page, st } = await openPage('others ' + c.id);
    await page.evaluate((t) => PlanLibrary.loadIntoEditor(JSON.parse(t), null, null), text);
    await expectCounts('一覧 ' + c.id, page);
    await check('一覧 ' + c.id, page, st);
    await page.evaluate((t) => { DATA = JSON.parse(t); normalizeLoadedPlan({ resetHeights: false, restoreView: false }); draw2d(); }, text);
    await expectCounts('取り込み ' + c.id, page);
    await check('取り込み ' + c.id, page, st);
    await page.evaluate((t) => { if (CompareMode.isOn()) return; CompareMode.start(JSON.parse(t)); }, text);
    await page.waitForTimeout(500);
    await check('比較 ' + c.id, page, st, { sweep: false });
    await context.close();
  }
  // 相手の差分(WebSocket): 固定集の物と全体の欄を、部屋に入った画面へ差分で送る
  {
    const { context, page, st } = await openPage('patch ' + c.id, { room: readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8') });
    const parsed = JSON.parse(text);
    const collections = {};
    for (const n of ['walls', 'items', 'rooms']) {
      const list = Array.isArray(parsed[n]) ? parsed[n] : [];
      const upserts = list.filter((o) => o && typeof o === 'object' && !Array.isArray(o) && o.id !== undefined && o.id !== null);
      if (upserts.length) collections[n] = { upserts, removes: [] };
    }
    const fields = {};
    for (const k of Object.keys(parsed)) if (!['walls', 'items', 'rooms'].includes(k)) fields[k] = parsed[k];
    await page.evaluate((m) => { try { window.__ws.onmessage({ data: m }); } catch (e) { window.__patchError = String(e && e.message || e); } }, JSON.stringify({ type: 'patch', version: 2, clientId: 'someone-else', patch: { collections, fields } }));
    await page.waitForTimeout(500);
    await check('相手の差分 ' + c.id, page, st);
    await context.close();
  }
  console.log('ok', c.id, Math.round((Date.now() - caseStart) / 1000) + 's');
}

// ── 2. 2 百万字の部屋の名前 ──────────────────────────────────────
if (!process.env.MEASURE) {
  const base = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
  base.rooms[0].n = 'あ'.repeat(2000000);
  const { context, page, st } = await openPage('long name');
  const t0 = Date.now();
  await importText(page, JSON.stringify(base));
  const ms = Date.now() - t0;
  const len = await page.evaluate(() => DATA.rooms[0].n.length);
  if (len !== 10000) note('長い名前', `名前が ${len} 字(期待 10000)`);
  if (ms > 15000) note('長い名前', `読み込みに ${ms}ms`);
  await check('長い名前', page, st);
  console.log('ok long-name', ms + 'ms');
  await context.close();
}

// ── 3. 物の数の上限 ──────────────────────────────────────────────
function bigPlan(n) {
  const base = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
  const W = [], I = [], R = [];
  let id = 1;
  for (let r = 0; W.length + I.length + R.length < n; r++) {
    const dx = (r % 10) * 20000, dy = Math.floor(r / 10) * 20000;
    for (const w of base.walls) W.push({ ...w, id: id++, x1: w.x1 + dx, x2: w.x2 + dx, y1: w.y1 + dy, y2: w.y2 + dy });
    for (const it of base.items) I.push({ ...it, id: id++, x: it.x + dx, y: it.y + dy });
    for (const rm of base.rooms) R.push({ ...rm, id: 'rm' + (id++), x: rm.x + dx, y: rm.y + dy });
  }
  let over = W.length + I.length + R.length - n;
  while (over-- > 0) I.pop();
  return { ...base, walls: W, items: I, rooms: R };
}
const MAX = LIMITS.MAX_LOAD_OBJECTS;
// MEASURE=300,1000 で、その数のプランの読み込みと 3D の組み立ての時間だけを測って終わる(上限を決めるとき)。
if (process.env.MEASURE) {
  for (const n of process.env.MEASURE.split(',').map(Number)) {
    const { context, page } = await openPage('measure ' + n);
    await page.evaluate(() => { window.__before = DATA; });
    const t0 = Date.now();
    await page.setInputFiles('#import-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bigPlan(n))) });
    await page.waitForFunction(() => window.DATA !== window.__before, null, { timeout: 600000 });
    const t1 = Date.now();
    const t3d = await page.evaluate(() => { const s = performance.now(); setView('3d-ext'); rebuild3D(); return Math.round(performance.now() - s); });
    const t3d2 = await page.evaluate(() => { const s = performance.now(); rebuild3D(); return Math.round(performance.now() - s); });
    console.log(`MEASURE ${n} 個: 読み込み ${t1 - t0}ms・3D(初回) ${t3d}ms・3D(2回め) ${t3d2}ms`);
    await context.close();
  }
  await browser.close();
  process.exit(0);
}
{
  // 上限ちょうど: 開ける。2D と 3D の時間を出す
  const plan = bigPlan(MAX);
  const { context, page, st } = await openPage('max');
  const t0 = Date.now();
  await importText(page, JSON.stringify(plan));
  const t1 = Date.now();
  const n = await page.evaluate(() => DATA.walls.length + DATA.items.length + DATA.rooms.length);
  if (n !== MAX) note('上限ちょうど', `${n} 個しか入らなかった`);
  const t3d = await page.evaluate(() => { const s = performance.now(); setView('3d-ext'); rebuild3D(); return Math.round(performance.now() - s); });
  console.log(`上限ちょうど(${MAX} 個): 読み込み ${t1 - t0}ms・3D の組み立て ${t3d}ms`);
  // 3D の組み立ては数の2乗で重くなる(plan-schema.js の MAX_LOAD_OBJECTS の注釈)。上限ちょうどでも終わることだけを見る
  if (t1 - t0 > 20000) note('上限ちょうど', `読み込みに ${t1 - t0}ms`);
  if (t3d > 120000) note('上限ちょうど', `3D に ${t3d}ms`);
  st.errors.splice(0).forEach((e) => note('上限ちょうど', 'pageerror ' + e));
  await context.close();
}
{
  // 上限を超える: どの入口でも入れずに断る
  const text = JSON.stringify(bigPlan(MAX + 1));
  const msg = /大きすぎるため開けません/;
  {
    const { context, page, st } = await openPage('over file');
    const before = await page.evaluate(() => { window.__keep = DATA; return DATA.walls.length; });
    await page.setInputFiles('#import-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForTimeout(1500);
    if (!st.dialogs.some((d) => msg.test(d))) note('上限超え ファイル', '断りの文が出ない: ' + JSON.stringify(st.dialogs));
    if (!(await page.evaluate(() => DATA === window.__keep))) note('上限超え ファイル', '今のプランが入れ替わった');
    st.errors.splice(0).forEach((e) => note('上限超え ファイル', 'pageerror ' + e));
    void before;
    await context.close();
  }
  {
    const { context, page, st } = await openPage('over room', { room: text });
    const s = await page.evaluate(() => ({ room: SHARED.roomId, status: document.getElementById('share-status').textContent, n: DATA.items.length }));
    if (s.room) note('上限超え 共有', '部屋に入ってしまった');
    if (!msg.test(s.status)) note('上限超え 共有', '断りの文が出ない: ' + s.status.slice(0, 120));
    st.errors.splice(0).forEach((e) => note('上限超え 共有', 'pageerror ' + e));
    await context.close();
  }
  {
    const { context, page, st } = await openPage('over storage', { storage: text });
    await page.waitForTimeout(1500);
    if (!st.dialogs.some((d) => msg.test(d))) note('上限超え 自動保存', '断りの文が出ない: ' + JSON.stringify(st.dialogs));
    const n = await page.evaluate(() => DATA.walls.length + DATA.items.length + DATA.rooms.length);
    if (n > MAX) note('上限超え 自動保存', '入ってしまった');
    st.errors.splice(0).forEach((e) => note('上限超え 自動保存', 'pageerror ' + e));
    await context.close();
  }
  {
    const { context, page, st } = await openPage('over others');
    await page.evaluate(() => { window.__keep = DATA; });
    await page.evaluate((t) => PlanLibrary.loadIntoEditor(JSON.parse(t), null, null), text);
    if (!(await page.evaluate(() => DATA === window.__keep))) note('上限超え 一覧', '今のプランが入れ替わった');
    await page.evaluate((t) => CompareMode.start(JSON.parse(t)), text);
    if (await page.evaluate(() => CompareMode.isOn())) note('上限超え 比較', '並べてしまった');
    if (st.dialogs.filter((d) => msg.test(d)).length < 2) note('上限超え 一覧・比較', '断りの文が出ない: ' + JSON.stringify(st.dialogs));
    st.errors.splice(0).forEach((e) => note('上限超え 一覧・比較', 'pageerror ' + e));
    await context.close();
  }
  console.log('ok over-limit');
}

await browser.close();
if (failures.length) {
  console.error(failures.length + ' 件の問題:\n' + failures.slice(0, 80).join('\n'));
  assert.fail('プランの入口の守り: ' + failures.length + ' 件');
}
console.log('plan-load-guards: すべて通った');
