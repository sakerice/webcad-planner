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

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const ORIGIN = new URL(APP).origin;
const T = { timeout: 60000 };
const PAYLOADS = JSON.parse(readFileSync(join(HERE, 'fixtures', 'injection', 'payloads.json'), 'utf8'));
const BASE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
// index.html が自分で読む外部(書体)。これ以外のオリジン外への要求は失敗にする。どれも実際には送らない。
const APP_EXTERNAL = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const ROOM = 'InjectionTestRoom00001';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 攻撃の文字 ───────────────────────────────────────────────
function stringPayloads() {
  const long = PAYLOADS.long;
  const longValue = long.unit.repeat(Math.ceil(long.length / long.unit.length)).slice(0, long.length);
  return [...PAYLOADS.markup, ...PAYLOADS.urls, ...PAYLOADS.control, { id: long.id, value: longValue }];
}
const tagged = (p) => (field) => p.value.split(PAYLOADS.tag).join(field);
// 長い文字は、欄の種類ごとに2つまでに入れる(全部に入れるとプランが 50MB を超える)
function sparse(v) {
  const seen = {};
  return (field) => { const k = field.replace(/#.*$/, ''); seen[k] = (seen[k] || 0) + 1; return seen[k] <= 2 ? v(field) : 'x-' + field; };
}
// 継承した鍵の名前は、欄ごとに順に配る(同じ鍵が id で重ならないよう、id には番号を付けない)
function inheritedValue() {
  const keys = PAYLOADS.inheritedKeys;
  let i = 0;
  return () => keys[i++ % keys.length];
}

// ── 悪いプランを作る ─────────────────────────────────────────
// v(field) が欄に入れる文字を返す。field は「どの欄か」の名前(__TAG__ の置き換え先)。
// faceKeys は土台のプランを一度開いて集めた、壁の面の設定の鍵({exterior:[…], interior:[…]})。
function evilPlan(v, faceKeys, opts = {}) {
  const p = clone(BASE);
  const ex = p.exteriorWallSettings, ins = p.interiorWallSettings;
  const rekeyWall = (oldId, newId) => {
    const ok = String(oldId), nk = String(newId);
    if (ex.walls && Object.prototype.hasOwnProperty.call(ex.walls, ok)) { Object.defineProperty(ex.walls, nk, { value: ex.walls[ok], enumerable: true, writable: true, configurable: true }); delete ex.walls[ok]; }
    for (const s of [ex, ins]) {
      for (const k of Object.keys(s.faces || {})) if (k.startsWith(ok + '_')) { s.faces[nk + k.slice(ok.length)] = s.faces[k]; delete s.faces[k]; }
    }
  };
  // 面の設定(個別設定にして、色と画像と巾木の色を入れる)
  for (const [s, keys, name] of [[ex, faceKeys.exterior, 'ext'], [ins, faceKeys.interior, 'int']]) {
    s.faces = s.faces || {};
    keys.forEach((k, i) => { s.faces[k] = { mode: 'custom', color: v(name + '.face.color#' + i), texture: v(name + '.face.texture#' + i), textureFlipX: false, textureFlipY: false, skirting: true, skirtingColor: v(name + '.face.skirtingColor#' + i) }; });
  }
  // 壁
  p.walls.forEach((w, i) => {
    w.color = v('wall.color#' + i); w.exteriorColor = v('wall.exteriorColor#' + i); w.interiorColor = v('wall.interiorColor#' + i);
    if (i % 3 === 0) w.texture = v('wall.texture#' + i);
  });
  // 薄い壁(厚み 120 未満)は欄に色が出る。1枚は薄くしておく
  p.walls[5].thick = 90;
  p.walls[2].thick = v('wall.thick');
  // id を差し替える壁(面の設定の鍵もいっしょに付け替える)
  [0, 1, 3].forEach((i, n) => { const nid = opts.inherited ? v('wall.id') : v('wall.id#' + n); rekeyWall(p.walls[i].id, nid); p.walls[i].id = nid; });
  // 部屋
  p.rooms.forEach((r, i) => {
    r.n = v('room.n#' + i); r.floorColor = v('room.floorColor#' + i); r.ceilingColor = v('room.ceilingColor#' + i);
    if (i % 2) { r.texture = v('room.texture#' + i); r.ceilingTexture = v('room.ceilingTexture#' + i); r.floorMaterial = v('room.floorMaterial#' + i); }
  });
  p.rooms[4].floorRaiseMm = v('room.floorRaiseMm'); p.rooms[6].ceilingHeight = v('room.ceilingHeight');
  [2, 7].forEach((i, n) => { p.rooms[i].id = opts.inherited ? v('room.id') : v('room.id#' + n); });
  // 物
  const textKeys = ['color', 'name', 'label', 'texture', 'model', 'lightColor', 'sashColor', 'roofEdgeColor', 'gapInfillColor',
    'railCapColor', 'railFrameColor', 'coveColor', 'windowStd', 'stairTo', 'baseRoom', 'doorFinish', 'gutterMode'];
  p.items.forEach((it, i) => {
    for (const k of textKeys) it[k] = v('item.' + k + '#' + i);
    it.finishColors = { wood: v('item.finishColors.wood#' + i), fabric: v('item.finishColors.fabric#' + i), metal: v('item.finishColors.metal#' + i), accent: v('item.finishColors.accent#' + i), body: v('item.finishColors.body#' + i) };
    it.finishTextures = { wood: v('item.finishTextures.wood#' + i), fabric: v('item.finishTextures.fabric#' + i) };
    if (it.type === 'memo') it.noteText = v('memo.noteText');
    if (it.type === 'site-rect') {
      it.siteSurface = v('site.siteSurface#' + i);
      it.siteZones = [{ name: v('site.zone.name#' + i), x: 0, y: 0, w: 1000, d: 1000, surface: v('site.zone.surface#' + i) }];
      it.setback = { zone: v('site.setback.zone#' + i), road: true, north: true };
    }
    if (it.type === 'roof') { it.roofType = v('roof.roofType#' + i); it.gapInfillTexture = v('roof.gapInfillTexture#' + i); }
    if (it.type === 'stair') { it.stairOrder = v('stair.stairOrder'); it.stairStyle = v('stair.stairStyle'); it.stairRail = v('stair.stairRail'); it.stairTarget = 'level'; }
    if (/^light-/.test(it.type)) it.lightKind = v('light.lightKind#' + i);
  });
  // 数の欄に文字(設定欄に値として出る物)
  const tree = p.items.find((it) => it.type === 'tree');
  Object.assign(tree, { sScale: v('item.sScale'), sX: v('item.sX'), sY: v('item.sY'), rot: v('item.rot'), elev: v('item.elev') });
  const block = p.items.find((it) => it.type === 'custom-block'); block.customHeight = v('item.customHeight');
  const meter = p.items.find((it) => it.type === 'meter-box'); meter.sScale = v('item.sScale#meter');
  // 階の欄に文字(一括差し替えのダイアログは階をそのまま出していた)
  const fmp = p.items.find((it) => /^fmp-Sofa/.test(it.type)); fmp.floor = opts.inherited ? v('item.floor') : 1;
  // 種類名と id(種類名は、継承した鍵を全部入れる。文字の攻撃のときは2つ)
  const plain = p.items.filter((it) => ['tree', 'bicycle', 'sewer-pit', 'fmp-AirConditionerWall01', 'ac-outdoor', 'im0261-Curtain-MEGA_PACK_Curtain-curtain-177647', 'light-down'].includes(it.type));
  if (opts.inherited) plain.forEach((it) => { it.type = v('item.type'); });
  else plain.slice(0, 2).forEach((it, n) => { it.type = v('item.type#' + n); });
  p.items.filter((it) => it.type === 'sewer-pit').slice(0, 3).forEach((it, n) => { it.id = opts.inherited ? v('item.id') : v('item.id#' + n); });
  // 画面テストのために足す物(土台のプランに無い種類)
  const r0 = BASE.rooms.find((r) => r.floor === 1 && r.w > 2500 && r.d > 2500);
  p.items.push(
    { id: 'inj-walk', type: 'walk-route', x: 1000, y: 1000, w: 2000, d: 10, rot: 0, floor: 1, pathPoints: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], color: v('walk.color') },
    { id: 'inj-ceil', type: 'ceiling-area', x: r0.x + 300, y: r0.y + 300, w: 900, d: 900, rot: 0, floor: 1, offset: -150, cove: true, color: v('ceil.color'), coveColor: v('ceil.coveColor'), texture: v('ceil.texture') },
    { id: 'inj-spot', type: 'light-spot', x: 2000, y: 2000, w: 900, d: 60, rot: 0, floor: 1, elev: 2300, lightKind: 'spot', lightShape: 'line', lightColor: v('spot.lightColor'), lightAim: v('spot.lightAim') },
    { id: 'inj-fence', type: 'wood-fence', x: -800, y: 10500, w: 2000, d: 60, rot: 0, floor: 1, color: v('fence.color'), fencePattern: v('fence.fencePattern'), texture: v('fence.texture') },
  );
  // 家全体の設定
  const paint = (o, name) => { o.color = v(name + '.color'); o.texture = v(name + '.texture'); if ('sheen' in o || name.startsWith('roof')) o.sheen = v(name + '.sheen'); };
  paint(ex.whole, 'ext.whole');
  for (const f of Object.keys(ex.floors)) paint(ex.floors[f], 'ext.floor' + f);
  for (const k of Object.keys(ex.walls)) { ex.walls[k].color = v('ext.walls.color'); ex.walls[k].texture = v('ext.walls.texture'); }
  paint(ins.whole, 'int.whole'); ins.whole.skirtingColor = v('int.whole.skirtingColor');
  for (const f of Object.keys(ins.floors)) { paint(ins.floors[f], 'int.floor' + f); ins.floors[f].skirtingColor = v('int.floor' + f + '.skirtingColor'); }
  p.roofAppearance.whole.linked = false;
  paint(p.roofAppearance.whole, 'roof.whole');
  p.roofAppearance.floors = { 1: { linked: true }, 2: { linked: true }, 3: { linked: true } };
  for (const f of Object.keys(p.roofAppearance.floors)) paint(p.roofAppearance.floors[f], 'roof.floor' + f);
  p.exteriorDetail.gutterColor = v('exteriorDetail.gutterColor');
  p.planName = v('planName');
  return p;
}

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
  // 3D の作り直しは、1つの物で例外が出るとその物だけ飛ばして警告を出す(残りは描く)。
  // 飛ばした物があれば、作り直しが例外を出したのと同じに扱う。
  page.on('console', (m) => { if (/3Dに描けない/.test(m.text())) st.errors.push(m.text().slice(0, 300)); });
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
  if (extra.errs && extra.errs.length) note(where, '操作が例外: ' + extra.errs.slice(0, 6).join(' / ') + (extra.errs.length > 6 ? ` ほか${extra.errs.length - 6}件` : ''));
  st.outside.length = 0; st.errors.length = 0;
  await page.evaluate(() => { window.__xss.length = 0; });
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
