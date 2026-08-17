// Task 32: 画像AIレンダーは「ボタンを押してから生成」する。
//
// 見ているのは文字列ではなく**実際に走らせた結果**である。index.html から
// 入口ボタンの onclick 属性と、生成まわりの関数を波括弧の対応で切り出し、
// node:vm の上で最小の DOM を食わせて実行する。測っているのは:
//
//   - メニューの入口を押したとき、ダイアログが開くだけで
//     **撮影も表示切り替えも生成も1回も走らない**こと（本題の退行）
//   - 「データ作成」のボタンを押したとき、そこで初めて撮影と生成が走り、
//     データ出力欄（指示文・プレビュー・保存リンク）が埋まること
//   - **ダイアログを開いた後に変えた設定**が、その生成に反映されること
//     （開いた瞬間に撮っていた頃はできなかったこと）
//   - 設定を触らずに押したときの中身が、これまでと同じ並びであること
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ── index.html からの切り出し（video-ui.test.cjs と同じやり方）──────────────
function topLevelFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  if (at === -1) at = html.indexOf('\nasync function ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  assert.notEqual(i, -1);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}
// 複数行の配列リテラル（表）を取り出す。topLevelVar の正規表現は1行しか掴めない。
function topLevelArrayVar(name) {
  const at = html.indexOf('\nvar ' + name + '=[');
  assert.notEqual(at, -1, 'var ' + name + ' の配列が index.html に無い');
  let i = html.indexOf('[', at), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) break; }
  }
  return html.slice(at + 1, i + 2);
}

// ボタンの onclick を、書かれているとおりに取り出す（押したのと同じものを走らせる）
function onclickOf(id) {
  const re = new RegExp('<(?:button|a|div)\\b[^>]*\\bid="' + id + '"[^>]*>', 'i');
  const m = html.match(re);
  assert.notEqual(m, null, 'id="' + id + '" のボタンが index.html に無い');
  const oc = m[0].match(/onclick="([^"]*)"/);
  assert.notEqual(oc, null, id + ' に onclick が無い');
  return oc[1];
}

// 浮きボタン(#unity-render-fab)は削除したので、入口はヘッダーの1つ。
const ENTRY_IDS = ['unity-render-toolbar-btn'];
const RUN_ID = 'ai-render-run';

// ── 最小の DOM ────────────────────────────────────────────────────────────
function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.value = '';
  this.textContent = '';
  this.checked = false;
  this.disabled = false;
  this.href = '';
  this.style = {};
  this.attrs = {};
  const self = this;
  const classes = {};
  this.classList = {
    add: function (c) { classes[c] = true; },
    remove: function (c) { delete classes[c]; },
    contains: function (c) { return !!classes[c]; },
    toggle: function (c, on) { if (on === undefined) on = !classes[c]; if (on) classes[c] = true; else delete classes[c]; return !!classes[c]; }
  };
  this.setAttribute = function (k, v) { self.attrs[k] = v; };
  this.removeAttribute = function (k) { delete self.attrs[k]; };
  this.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(self.attrs, k) ? self.attrs[k] : null; };
  this.focus = function () {};
  this.select = function () {};
}

const DL_IDS = ['ai-dl-bundle', 'ai-dl-json', 'ai-dl-prompt', 'ai-dl-base', 'ai-dl-edge',
  'ai-dl-segmentation', 'ai-dl-depth', 'ai-dl-normal', 'ai-dl-instance'];

function makeDom() {
  const byId = {};
  const buttons = [];
  function add(id, tag) { const el = new El(tag || 'div'); byId[id] = el; return el; }
  add('unity-render-modal');
  add('unity-render-status');
  add('unity-render-img', 'img');
  add('ai-instructions-preview', 'textarea');
  add('ai-package-preview');
  ['ai-base-img', 'ai-edge-img', 'ai-seg-img', 'ai-depth-img', 'ai-normal-img', 'ai-instance-img']
    .forEach(function (id) { add(id, 'img'); });
  DL_IDS.forEach(function (id) { const a = add(id, 'a'); a.classList.add('disabled'); });
  add('ai-render-style-input', 'input');
  add('ai-render-source');
  add('ai-render-preset', 'select');
  ENTRY_IDS.concat([RUN_ID]).forEach(function (id) { buttons.push(add(id, 'button')); });
  return {
    byId: byId,
    doc: {
      getElementById: function (id) { return byId[id] || null; },
      createElement: function (tag) { return new El(tag); },
      querySelectorAll: function () { return buttons; }
    }
  };
}

// ── 実行環境: 本物の生成手順を、撮影だけ差し替えて走らせる ─────────────────
function harness(opts) {
  const o = opts || {};
  const dom = makeDom();
  const calls = [];   // 撮影・表示切り替え・生成の呼び出し順
  const zips = [];    // makeZipBlob へ渡ったファイル一覧

  const ctx = vm.createContext({
    console: console,
    document: dom.doc,
    setTimeout: setTimeout,
    TextEncoder: TextEncoder,
    JSON: JSON,
    Math: Math,
    Date: Date,
    Object: Object,
    ST: { view: o.view || '2d', floor: 2 },
    LIGHT_SETTINGS: { timeOfDay: 'day', sunSim: false, hour: 12, season: 'summer' },
    camExt: { position: { x: 0, y: 5, z: 10 }, fov: 45 },
    orbit: { target: { x: 0, y: 0, z: 0 } },
    URL: { createObjectURL: function () { return 'blob:test'; }, revokeObjectURL: function () {} },
    Blob: function (parts) { this.size = (parts && parts.length) || 0; },
    atob: function (b) { return Buffer.from(b, 'base64').toString('binary'); },
    Uint8Array: Uint8Array,
    alert: function (msg) { calls.push('alert:' + msg); },
    // 入口が触るもの（開くときの同期）
    isUnityRenderFeatureEnabled: function () { return true; },
    syncUnityRenderServerInput: function () { calls.push('syncUnityRenderServerInput'); },
    syncAiRenderSource: function () { calls.push('syncAiRenderSource'); },
    // 撮影まわり（ここが走ったかどうかが本題）
    setView: function (v) { calls.push('setView:' + v); ctxRef.ST.view = v; },
    captureCurrent3DDataUrl: function () { calls.push('captureCurrent3DDataUrl'); return 'data:image/png;base64,base'; },
    captureSegmentation3DDataUrl: function () { calls.push('captureSegmentation3DDataUrl'); return 'data:image/png;base64,seg'; },
    captureInstance3DData: function () {
      calls.push('captureInstance3DData');
      return { dataUrl: 'data:image/png;base64,inst', legend: [{ id: 'wall-1' }] };
    },
    captureAiOverrideGuideDataUrl: function (kind) { calls.push('captureAiOverrideGuideDataUrl:' + kind); return 'data:image/png;base64,' + kind; },
    capturePlan2dDataUrl: function () { calls.push('capturePlan2dDataUrl'); return 'data:image/png;base64,plan'; },
    makeEdgeDataUrlFromSegmentation: function () { calls.push('makeEdgeDataUrlFromSegmentation'); return Promise.resolve('data:image/png;base64,edge'); },
    // 設計情報は本物の形だけ与える（プロンプト組み立ては本物を走らせる）
    buildAiRenderMetadata: function (legend) {
      calls.push('buildAiRenderMetadata');
      return {
        version: 2, createdAt: '2026-08-15T00:00:00.000Z', app: 'house-planner mobile',
        view: o.metaView || 'exterior', floor: 2,
        counts: { floors: 2, walls: 10, rooms: 3, items: 4 },
        materials: { floors: [1, 2], sites: [], floorClassifications: [] },
        floorClassifications: [],
        siteContext: { hasSite: false, sites: [] },
        segmentationLegend: { wall: '#ff0000' },
        instanceLegend: legend || []
      };
    },
    dataUrlToBytes: function (url) { return Promise.resolve(new TextEncoder().encode(String(url))); },
    makeZipBlob: function (files) {
      // vm の中の配列をそのまま持ち出すと realm 違いで比較できないので詰め替える
      const names = [];
      for (let i = 0; i < files.length; i++) names.push(files[i].name);
      zips.push(names);
      return { size: files.length };
    }
  });
  const ctxRef = ctx;

  vm.runInContext([
    topLevelVar('AI_RENDER_PACKAGE'),
    topLevelVar('AI_RENDER_DOWNLOAD_URLS'),
    topLevelVar('unityRenderBusy'),
    topLevelFunction('waitFrame'),
    topLevelFunction('isUnityRenderableView'),
    topLevelFunction('openUnityRenderModal'),
    topLevelFunction('closeUnityRenderModal'),
    topLevelFunction('setUnityRenderStatus'),
    topLevelFunction('setUnityRenderImage'),
    topLevelFunction('setUnityRenderBusy'),
    topLevelFunction('ensureAiRenderableView'),
    topLevelFunction('setAiPackagePreview'),
    topLevelFunction('setAiInstructionsPreview'),
    topLevelFunction('revokeAiRenderDownloadUrls'),
    topLevelFunction('makeAiDownloadObjectUrl'),
    topLevelFunction('setAiDownloadLink'),
    topLevelFunction('clearAiRenderDownloadLinks'),
    topLevelArrayVar('AI_IMAGE_PRESETS'),
    topLevelFunction('aiRenderPresetById'),
    topLevelFunction('aiRenderSelectedPreset'),
    topLevelFunction('aiRenderFillPresetOptions'),
    topLevelFunction('aiRenderNote'),
    topLevelFunction('dataUrlToBlobSync'),
    topLevelFunction('setAiImageDownloadLink'),
    topLevelFunction('aiRenderPackageJsonText'),
    topLevelFunction('syncAiRenderDownloadLinks'),
    topLevelFunction('buildAiRenderPrompt'),
    topLevelFunction('generateAiRenderPackage'),
    // 押したあと完了を待つための包み（本体はそのまま呼ぶ）
    'var __genCalls=0, __pending=null, __gen=generateAiRenderPackage;',
    'generateAiRenderPackage=function(){__genCalls++;__pending=__gen.apply(this,arguments);return __pending;};'
  ].join('\n'), ctx);

  return {
    ctx: ctx,
    dom: dom,
    calls: calls,
    zips: zips,
    // ボタンを「押す」: index.html に書かれている onclick をそのまま走らせる
    press: async function (id) {
      vm.runInContext(onclickOf(id), ctx);
      if (ctx.__pending) await ctx.__pending;
    },
    genCalls: function () { return ctx.__genCalls; },
    pkg: function () { return ctx.AI_RENDER_PACKAGE; }
  };
}

// ── 本題: 開いただけでは何も起きない ───────────────────────────────────────
test('メニューの入口を押すと、ダイアログが開くだけで撮影も生成も走らない', async () => {
  for (const id of ENTRY_IDS) {
    const h = harness({ view: '2d' });
    await h.press(id);
    assert.equal(h.dom.byId['unity-render-modal'].classList.contains('show'), true,
      id + ' でダイアログが開いていない');
    const ran = h.calls.filter(function (c) { return /^(setView|capture|makeEdge|buildAiRenderMetadata)/.test(c); });
    assert.deepEqual(ran, [], id + ' を押しただけで走ったもの: ' + ran.join(', '));
    assert.equal(h.genCalls(), 0, id + ' が生成を呼んでいる');
    assert.equal(h.pkg(), null, id + ' を押しただけでパッケージが出来ている');
    assert.equal(h.zips.length, 0, id + ' を押しただけでZIPが組まれている');
    assert.equal(h.dom.byId['unity-render-status'].textContent, '',
      id + ' を押しただけで進捗が出ている');
    assert.equal(h.ctx.ST.view, '2d', id + ' が表示を勝手に切り替えている');
  }
});

test('入口の onclick は生成関数を名指ししていない（開くだけの配線である）', () => {
  ENTRY_IDS.forEach(function (id) {
    const oc = onclickOf(id);
    assert.ok(oc.indexOf('generateAiRenderPackage') < 0,
      id + ' の onclick が生成を直接呼んでいる: ' + oc);
    assert.ok(oc.indexOf('openUnityRenderModal') >= 0,
      id + ' の onclick がダイアログを開いていない: ' + oc);
  });
});

// ── ボタンを押して初めて生成される ─────────────────────────────────────────
test('「データ作成」のボタンを押すと、そこで撮影と生成が走り、データ出力が埋まる', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  assert.equal(h.genCalls(), 0);
  await h.press(RUN_ID);
  assert.equal(h.genCalls(), 1, '生成が走っていない');
  assert.deepEqual(h.calls.filter(function (c) { return /^capture/.test(c); }), [
    'captureCurrent3DDataUrl',
    'captureSegmentation3DDataUrl',
    'captureInstance3DData',
    'captureAiOverrideGuideDataUrl:depth',
    'captureAiOverrideGuideDataUrl:normal'
  ], '撮影の順序が変わっている');
  const pkg = h.pkg();
  assert.ok(pkg, 'パッケージが出来ていない');
  assert.equal(h.dom.byId['ai-instructions-preview'].value, pkg.prompt, '指示文が出力欄に出ていない');
  assert.equal(h.dom.byId['ai-package-preview'].classList.contains('show'), true, '画像プレビューが出ていない');
  assert.equal(h.dom.byId['unity-render-img'].classList.contains('show'), true, '基準画像が出ていない');
  assert.match(h.dom.byId['unity-render-status'].textContent, /画像AI用データを作りました/, '完了の知らせが出ていない');
  ['ai-dl-bundle', 'ai-dl-prompt', 'ai-dl-base'].forEach(function (id) {
    assert.equal(h.dom.byId[id].classList.contains('disabled'), false, id + ' が押せないまま');
  });
});

test('設定を触らずに押したときのZIPの中身は10件・同じ並び', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  await h.press(RUN_ID);
  assert.deepEqual(h.zips[0], [
    'ai-instructions.md',
    'ai-render-package.json',
    'segmentation-legend.json',
    'instance-legend.json',
    'base_render.png',
    'edge_guide.png',
    'segmentation_guide.png',
    'depth_guide.png',
    'normal_guide.png',
    'instance_guide.png'
  ]);
  // 既定は先頭のプリセット。仕上げメモが空なら style はプリセットそのもの。
  assert.match(h.pkg().prompt,
    new RegExp('Preferred style: ' + h.ctx.AI_IMAGE_PRESETS[0].style.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    '既定の表現プリセットが指示文に入っていない');
});

// ── 利点: 開いてから設定を変えても、その回に効く ───────────────────────────
test('ダイアログを開いた後に変えた設定が、その1回目の生成に反映される', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);           // 開くだけ
  // 開いてから設定を変える（開いた瞬間に撮っていた頃は、ここが効かなかった）
  h.dom.byId['ai-render-style-input'].value = '夕暮れ、暖色の照明';
  h.dom.byId['ai-render-preset'].value = 'life-watercolor';
  await h.press(RUN_ID);

  const prompt = h.pkg().prompt;
  // 仕上げメモはプリセットを置き換えず、後ろに足される。
  assert.match(prompt, /Preferred style: watercolour/, '選んだプリセットが指示文に入っていない');
  assert.match(prompt, /夕暮れ、暖色の照明/, '仕上げメモが指示文に入っていない');
  // 水彩を頼みながら「絵画的な見た目を避けろ」と言わないこと。
  assert.doesNotMatch(prompt, /avoid painterly or illustration looks/,
    '水彩プリセットなのに絵画的な見た目を禁じている');
  assert.doesNotMatch(prompt.slice(prompt.indexOf('Negative prompt:')), /illustration/,
    '水彩プリセットなのにネガティブプロンプトが illustration を禁じている');
});

// 既定（写実）のときは、絵画的な見た目を避ける指示とネガティブプロンプトが残る。
// 上のテストだけだと、両方を無条件に消しても緑のままになる。
test('写実プリセットでは、絵画的な見た目を避ける指示が残る', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  await h.press(RUN_ID);
  const prompt = h.pkg().prompt;
  assert.match(prompt, /avoid painterly or illustration looks/);
  assert.match(prompt.slice(prompt.indexOf('Negative prompt:')), /illustration/);
});

// 通行人・自転車を足してよいのは外観だけ。内観に書くと部屋の中を人が横切る。
test('内観では通行人を足してよいと書かない', async () => {
  const h = harness({ view: '3d-int', metaView: 'interior' });
  await h.press(ENTRY_IDS[0]);
  await h.press(RUN_ID);
  assert.match(h.pkg().prompt, /- Do not add people or vehicles\./);
});

// iOS Safari は data: URL の download 属性を無視して開いてしまう。
test('画像の保存リンクは data: ではなく blob:', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  await h.press(RUN_ID);
  ['ai-dl-base', 'ai-dl-edge', 'ai-dl-instance'].forEach(function (id) {
    const a = h.dom.byId[id];
    assert.doesNotMatch(a.href, /^data:/, id + ' が data: URL のまま（iOS Safari で保存されない）');
    assert.match(a.href, /^blob:/, id);
  });
});

test('設定を変えて押し直すと、2回目の内容がその設定に入れ替わる', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  await h.press(RUN_ID);
  const first = h.pkg().prompt;
  h.dom.byId['ai-render-style-input'].value = '朝の光、白い壁';
  await h.press(RUN_ID);
  const second = h.pkg().prompt;
  assert.notEqual(first, second, '押し直しても指示文が変わっていない');
  assert.match(second, /朝の光、白い壁/);
  assert.doesNotMatch(first, /朝の光、白い壁/);
  assert.equal(h.genCalls(), 2);
});

// 「参照にする画面」の一文は、ダイアログを開いたままビューを切り替えても追随する。
// 動画AI側と同じ扱い（setView の末尾から両方が呼ばれる）。
test('ビュー切替から画像AI側の説明文の更新が呼ばれている', () => {
  const setView = topLevelFunction('setView');
  assert.match(setView, /syncAiRenderSource\(\)/);
});

test('ウォークスルーでは画像AIも「撮れない」と押す前に書く', () => {
  const ctx = vm.createContext({ ST: { view: '3d-walk' } });
  const note = vm.runInContext('(' + topLevelFunction('aiRenderSourceNoteText') + ')', ctx)();
  assert.match(note, /ウォークスルー/, note);
  assert.match(note, /外観3D/, note);
});

// ── 表現プリセット ────────────────────────────────────────────────────────
// 生活感の有無はプリセットが決める。以前はチェックボックスだったが、
// プリセット名が「生活画像」である以上、同じ設定が2か所にあることになる。
test('プリセットは3つで、既定は生活画像（従来の既定と同じ）', () => {
  const h = harness({ view: '3d-ext' });
  // vm の外へ出た配列は realm が違うので deepStrictEqual が通らない。文字列で比べる。
  const ids = h.ctx.AI_IMAGE_PRESETS.map((p) => p.id).join(',');
  assert.equal(ids, 'life,life-watercolor,architectural');
  // 既定は先頭。ここが入れ替わると、既存ユーザーの出力が黙って変わる。
  assert.equal(h.ctx.AI_IMAGE_PRESETS[0].life, true, '既定のプリセットで生活感が消えている');
});

test('建築写真プリセットは人を入れない（外観でも）', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  h.dom.byId['ai-render-preset'].value = 'architectural';
  await h.press(RUN_ID);
  const prompt = h.pkg().prompt;
  assert.match(prompt, /- Do not add people or vehicles\./,
    '建築写真なのに通行人を足してよいと書いている');
  assert.match(prompt, /Preferred style: photorealistic architectural photography/);
});

test('生活画像プリセットは外観で人を足してよいと書く（従来どおり）', async () => {
  const h = harness({ view: '3d-ext' });
  await h.press(ENTRY_IDS[0]);
  await h.press(RUN_ID);
  assert.match(h.pkg().prompt, /You MAY add believable street life/);
});
