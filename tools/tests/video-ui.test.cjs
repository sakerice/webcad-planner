// Task 8: 動画AIレンダーのボタンとダイアログ。
//
// この計画では grep のアサーションが5回、未修正のコードに対して通っている。
// なのでここでの主検査は grep ではない。index.html から UI の関数を波括弧の
// 対応で切り出し、node:vm で**実際に走らせ**、本物の VideoPrompt と最小の DOM を
// 食わせて、「何が起きるか」を測る:
//
//   - プリセットの一覧が、画面に出ているものに従って入れ替わること
//   - プリセットを選ぶと本文が入力欄に入ること
//   - generateVideoRenderPackage へ渡る引数が、ウィジェットの値そのものであること
//   - 拒否されたとき、その**文面がそのまま**ユーザーへ届き、ダイアログが
//     操作可能なまま残ること
//
// grep のアサーションも数本あるが、いずれも上の実行検査の補足（配線の確認）である。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const VideoPrompt = require(join(ROOT, 'assets', 'js', 'video-prompt.js'));

// ── index.html からの切り出し（plan-capture.test.cjs と同じやり方）─────────
function topLevelFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  let skip = 1;
  if (at === -1) { at = html.indexOf('\nasync function ' + name + '('); skip = 1; }
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + skip;
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

// ── 最小の DOM ────────────────────────────────────────────────────────────
function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.value = '';
  this.textContent = '';
  this.checked = false;
  this.disabled = false;
  this.children = [];
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
  this.appendChild = function (c) { self.children.push(c); return c; };
}
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return ''; },
  set: function () { this.children.length = 0; }
});
Object.defineProperty(El.prototype, 'options', {
  get: function () { return this.children; }
});

function makeDom() {
  const byId = {};
  function add(id, tag) { const el = new El(tag || 'div'); byId[id] = el; return el; }
  add('video-render-modal');
  add('video-render-status');
  add('video-render-source');
  add('video-render-preset', 'select');
  add('video-render-text', 'textarea');
  add('video-render-duration', 'input').value = '8';
  add('video-render-duration-val');
  add('video-render-guides-check', 'input');
  add('video-render-img', 'img');
  add('video-render-files');
  const run = add('video-render-run', 'button');
  const close = add('video-render-close', 'button');
  close.classList.add('unity-render-close');
  const buttons = [run, close];
  return {
    byId: byId,
    buttons: buttons,
    doc: {
      getElementById: function (id) { return byId[id] || null; },
      createElement: function (tag) { return new El(tag); },
      querySelectorAll: function () { return buttons; }
    }
  };
}

// 切り出しはテストの中で行う（読み込み時に落とすと他のテストの赤黒が見えなくなる）
function ui(opts) {
  const o = opts || {};
  const dom = makeDom();
  const calls = [];
  const generate = o.generate || function () { return Promise.resolve(null); };
  const ctx = vm.createContext({
    console: console,
    document: dom.doc,
    VideoPrompt: VideoPrompt,
    ST: { view: o.view || '3d-int', floor: 2 },
    generateVideoRenderPackage: function (options) {
      calls.push(options);
      return Promise.resolve().then(function () { return generate(options); });
    }
  });
  vm.runInContext([
    topLevelVar('VIDEO_RENDER_UI'),
    topLevelVar('VIDEO_RENDER_MIN_DURATION_SEC'),
    topLevelFunction('videoRenderSourceFromView'),
    topLevelFunction('videoRenderSourceLabel'),
    topLevelFunction('videoRenderPresetById'),
    topLevelFunction('videoRenderSelectedPresetId'),
    topLevelFunction('videoRenderSelectedPreset'),
    topLevelFunction('videoRenderFillPresetOptions'),
    topLevelFunction('videoRenderSetPromptFromPreset'),
    topLevelFunction('onVideoRenderPresetChange'),
    topLevelFunction('videoRenderSourceNoteText'),
    topLevelFunction('syncVideoRenderSource'),
    topLevelFunction('videoRenderDurationSec'),
    topLevelFunction('onVideoRenderDurationInput'),
    topLevelFunction('videoRenderIncludesGuides'),
    topLevelFunction('videoRenderUserText'),
    topLevelFunction('setVideoRenderStatus'),
    topLevelFunction('setVideoRenderImage'),
    topLevelFunction('setVideoRenderFileList'),
    topLevelFunction('setVideoRenderBusy'),
    topLevelFunction('openVideoRenderDialog'),
    topLevelFunction('closeVideoRenderModal'),
    topLevelFunction('runVideoRenderPackage')
  ].join('\n'), ctx);
  ctx.$dom = dom;
  ctx.$calls = calls;
  return ctx;
}

const idsOf = (sel) => sel.children.map((o) => o.value);
const PLAN_IDS = VideoPrompt.presetsFor('plan').map((p) => p.id);
const D3_IDS = VideoPrompt.presetsFor('3d').map((p) => p.id);

// ── 1. プリセットの一覧は画面に出ているものが決める ──────────────────────
test('3Dを見ているとき、選べるのは3D系プリセットだけ', () => {
  const c = ui({ view: '3d-int' });
  c.openVideoRenderDialog();
  assert.deepEqual(idsOf(c.$dom.byId['video-render-preset']), D3_IDS);
  assert.ok(D3_IDS.length > 0);
});

test('平面図を見ているとき、選べるのは図面系プリセットだけ', () => {
  const c = ui({ view: '2d' });
  c.openVideoRenderDialog();
  assert.deepEqual(idsOf(c.$dom.byId['video-render-preset']), PLAN_IDS);
  // 2つの一覧が本当に違うこと（同じなら取り違えを防げていない）
  PLAN_IDS.forEach((id) => assert.ok(D3_IDS.indexOf(id) === -1, id + ' が3D側にも居る'));
});

test('ダイアログを開いたままビューを切り替えると、一覧も本文も入れ替わる', () => {
  const c = ui({ view: '3d-int' });
  c.openVideoRenderDialog();
  const sel = c.$dom.byId['video-render-preset'];
  const ta = c.$dom.byId['video-render-text'];
  assert.deepEqual(idsOf(sel), D3_IDS);
  const before = ta.value;

  c.ST.view = '2d';
  c.syncVideoRenderSource();          // setView の末尾から呼ばれるもの

  assert.deepEqual(idsOf(sel), PLAN_IDS);
  assert.equal(sel.value, PLAN_IDS[0]);
  assert.notEqual(ta.value, before);
  assert.equal(ta.value, VideoPrompt.presetsFor('plan')[0].body);
  assert.equal(c.$dom.byId['video-render-modal'].classList.contains('show'), true);
});

test('同じビューのまま呼ばれても、書きかけの本文を消さない', () => {
  const c = ui({ view: '3d-int' });
  c.openVideoRenderDialog();
  const ta = c.$dom.byId['video-render-text'];
  ta.value = '手で書いた本文';
  c.syncVideoRenderSource();
  c.syncVideoRenderSource();
  assert.equal(ta.value, '手で書いた本文');
});

// ── 2. プリセットを選ぶと入力欄に入る ────────────────────────────────────
test('プリセットを選ぶと、その本文が入力欄に入る', () => {
  const c = ui({ view: '3d-int' });
  c.openVideoRenderDialog();
  const sel = c.$dom.byId['video-render-preset'];
  const ta = c.$dom.byId['video-render-text'];
  const second = VideoPrompt.presetsFor('3d')[1];
  sel.value = second.id;
  c.onVideoRenderPresetChange();
  assert.equal(ta.value, second.body);
});

test('手で書き換えた後にプリセットを選び直すと上書きされる', () => {
  const c = ui({ view: '3d-int' });
  c.openVideoRenderDialog();
  const sel = c.$dom.byId['video-render-preset'];
  const ta = c.$dom.byId['video-render-text'];
  ta.value = 'わたしが書いた文';
  const third = VideoPrompt.presetsFor('3d')[2];
  sel.value = third.id;
  c.onVideoRenderPresetChange();
  assert.equal(ta.value, third.body);
});

// ── 3. 入力欄の値が generateVideoRenderPackage へどう渡るか ────────────────
test('触っていない本文は userText として渡さない（渡すと光の文が落ちる）', async () => {
  const c = ui({ view: '3d-int', generate: () => ({ files: [], images: {} }) });
  c.openVideoRenderDialog();
  await c.runVideoRenderPackage();
  assert.equal(c.$calls.length, 1);
  assert.equal(c.$calls[0].userText, '');
  assert.equal(c.$calls[0].presetId, D3_IDS[0]);
  assert.equal(c.$calls[0].source, '3d');
});

test('書き換えた本文は userText として渡る', async () => {
  const c = ui({ view: '3d-int', generate: () => ({ files: [], images: {} }) });
  c.openVideoRenderDialog();
  c.$dom.byId['video-render-text'].value = 'A slow dolly through a snowy room.';
  await c.runVideoRenderPackage();
  assert.equal(c.$calls[0].userText, 'A slow dolly through a snowy room.');
});

test('平面図を見ているときは source:"plan" と図面系プリセットが渡る', async () => {
  const c = ui({ view: '2d', generate: () => ({ files: [], images: {} }) });
  c.openVideoRenderDialog();
  await c.runVideoRenderPackage();
  assert.equal(c.$calls[0].source, 'plan');
  assert.ok(PLAN_IDS.indexOf(c.$calls[0].presetId) >= 0);
});

test('尺は 4〜15 に収まり、既定は 8', async () => {
  const c = ui({ view: '3d-int', generate: () => ({ files: [], images: {} }) });
  c.openVideoRenderDialog();
  assert.equal(c.videoRenderDurationSec(), VideoPrompt.DEFAULT_DURATION_SEC);
  c.$dom.byId['video-render-duration'].value = '99';
  assert.equal(c.videoRenderDurationSec(), VideoPrompt.MAX_DURATION_SEC);
  c.$dom.byId['video-render-duration'].value = '1';
  assert.equal(c.videoRenderDurationSec(), 4);
  c.$dom.byId['video-render-duration'].value = '12';
  await c.runVideoRenderPackage();
  assert.equal(c.$calls[0].durationSec, 12);
});

test('詳細ガイドは既定オフで、チェックしたときだけ true が渡る', async () => {
  const c = ui({ view: '3d-int', generate: () => ({ files: [], images: {} }) });
  c.openVideoRenderDialog();
  assert.equal(c.videoRenderIncludesGuides(), false);
  await c.runVideoRenderPackage();
  assert.equal(c.$calls[0].includeGuides, false);
  c.$dom.byId['video-render-guides-check'].checked = true;
  await c.runVideoRenderPackage();
  assert.equal(c.$calls[1].includeGuides, true);
});

// ── 4. 拒否されたときに何が起きるか（この課題の本体）────────────────────
const REFUSAL = '平面図の中で家が長い方の軸の 21.9% しか占めていません（下限 35%）。'
  + '主題が小さい参照を渡すと、生成AIはほとんど空の映像を返します。'
  + 'この階に設計要素があるか確かめてください。';

test('拒否の文面がそのままユーザーへ届く（握りつぶさない）', async () => {
  const c = ui({
    view: '2d',
    generate: () => { throw new Error(REFUSAL); }
  });
  c.openVideoRenderDialog();
  const status = c.$dom.byId['video-render-status'];
  await c.runVideoRenderPackage();
  assert.ok(status.textContent.indexOf(REFUSAL) >= 0,
    '拒否の文面が状態表示に出ていない: ' + status.textContent);
  assert.ok(status.textContent.indexOf('エラーが発生しました') === -1);
});

test('拒否の後もダイアログは操作できる（設定が残り、ボタンが戻る）', async () => {
  const c = ui({
    view: '2d',
    generate: () => { throw new Error(REFUSAL); }
  });
  c.openVideoRenderDialog();
  c.$dom.byId['video-render-duration'].value = '11';
  c.$dom.byId['video-render-text'].value = '書きかけの本文';
  await c.runVideoRenderPackage();

  assert.equal(c.$dom.byId['video-render-modal'].classList.contains('show'), true, 'ダイアログが閉じている');
  assert.deepEqual(idsOf(c.$dom.byId['video-render-preset']), PLAN_IDS, 'プリセットの一覧が消えた');
  assert.equal(c.$dom.byId['video-render-duration'].value, '11', '尺が巻き戻った');
  assert.equal(c.$dom.byId['video-render-text'].value, '書きかけの本文', '本文が消えた');
  c.$dom.buttons.forEach((b) => assert.equal(b.disabled, false, 'ボタンが無効のまま残っている'));

  // 直してもう一度押せる
  await c.runVideoRenderPackage();
  assert.equal(c.$calls.length, 2);
});

test('拒否は毎回ちがう文面をそのまま出す（定型文へ潰さない）', async () => {
  const messages = [
    '平面図の中で家がフレームからはみ出しています。切れた壁のある参照を渡すと、生成AIは切れた先を自分で作ります。',
    '平面図の家具 13 件が灰色のプレースホルダのままです（上面画像 32 枚中 13 枚が 8ms 待っても読めていません）。',
    '表現プリセット "plan-to-life" は平面図を参照にする前提の文です。',
    '光の状態をプロンプトに書けませんでした（時刻プリセット "blue-hour"）。'
  ];
  for (const m of messages) {
    const c = ui({ view: '3d-int', generate: () => { throw new Error(m); } });
    c.openVideoRenderDialog();
    await c.runVideoRenderPackage();
    assert.ok(c.$dom.byId['video-render-status'].textContent.indexOf(m) >= 0, m);
  }
});

// ── 5. 成功したとき ──────────────────────────────────────────────────────
test('成功すると、出来たファイルの一覧が表示される', async () => {
  const files = [
    { name: 'reference.png', size: 1915673 },
    { name: 'prompt.txt', size: 1229 },
    { name: 'package.json', size: 10806 }
  ];
  const c = ui({
    view: '2d',
    generate: () => ({ files: files, images: { reference: 'data:image/png;base64,AAAA' } })
  });
  c.openVideoRenderDialog();
  const pkg = await c.runVideoRenderPackage();
  assert.ok(pkg, 'パッケージが返っていない');
  const shown = c.$dom.byId['video-render-files'].textContent + '\n' + c.$dom.byId['video-render-status'].textContent;
  files.forEach((f) => assert.ok(shown.indexOf(f.name) >= 0, f.name + ' が出ていない'));
  assert.equal(c.$dom.byId['video-render-img'].getAttribute('src'), 'data:image/png;base64,AAAA');
  assert.equal(c.$dom.byId['video-render-modal'].classList.contains('show'), true);
});

// ── 6. 配線の確認（上の実行検査の補足）──────────────────────────────────
test('ツールバー・FAB・ボトムナビからダイアログを開ける', () => {
  assert.match(html, /id="video-render-toolbar-btn"[^>]*onclick="openVideoRenderDialog\(\)"/);
  assert.match(html, /id="video-render-fab"[^>]*onclick="openVideoRenderDialog\(\)"/);
  assert.match(html, /id="bnav-video"[^>]*onclick="openVideoRenderDialog\(\)/);
});

test('尺のスライダは 4〜15 の範囲を持ち、既定 8 で置かれている', () => {
  const at = html.indexOf('id="video-render-duration"');
  assert.notEqual(at, -1);
  const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
  assert.match(tag, /min="4"/);
  assert.match(tag, /max="15"/);
  assert.match(tag, /value="8"/);
});

test('詳細ガイドのチェックボックスは既定オフ', () => {
  const at = html.indexOf('id="video-render-guides-check"');
  assert.notEqual(at, -1);
  const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
  assert.doesNotMatch(tag, /\schecked/);
});

test('ビュー切替から一覧の更新が呼ばれている', () => {
  const setView = topLevelFunction('setView');
  assert.match(setView, /syncVideoRenderSource\(\)/);
});

test('既存の静止画AIレンダーは動画側の関数を1つも呼ばない', () => {
  const gen = html.slice(html.indexOf('async function generateAiRenderPackage'),
    html.indexOf('async function copyAiRenderPrompt'));
  assert.doesNotMatch(gen, /[Vv]ideo/);
  const modal = html.slice(html.indexOf('<div id="unity-render-modal"'),
    html.indexOf('<div id="jis-drawing-overlay"'));
  assert.doesNotMatch(modal, /video-render/);
});

// ── 7. ウォークスルーから何が見えるか（Task 10-4）────────────────────────
// videoRenderSourceFromView はウォークスルーも '3d' に倒す。プリセットの候補は
// それでよいが、説明文まで「いま見ている3Dの画角をそのまま参照にします」のまま
// だと、押した瞬間に拒否されるまで嘘を読ませることになる。
test('ウォークスルーでは「撮れない」と、押す前に書いてある', () => {
  const c = ui({ view: '3d-walk' });
  c.openVideoRenderDialog();
  const note = c.$dom.byId['video-render-source'].textContent;
  assert.match(note, /ウォークスルー/, note);
  assert.match(note, /外観3D/, note);
  assert.doesNotMatch(note, /いま見ている3Dの画角をそのまま参照にします/,
    'ウォークスルーで守れない約束を書いている');
  // プリセットは 3D 側のまま（切り替えれば同じ設定でそのまま撮れる）
  assert.deepEqual(idsOf(c.$dom.byId['video-render-preset']), D3_IDS);
});

test('外観3D↔ウォークスルーの往復で説明文が追随する（source が同じでも）', () => {
  const c = ui({ view: '3d-ext' });
  c.openVideoRenderDialog();
  const note = c.$dom.byId['video-render-source'];
  assert.match(note.textContent, /いま見ている3Dの画角/);
  c.ST.view = '3d-walk';
  c.syncVideoRenderSource();
  assert.match(note.textContent, /ウォークスルー/, '説明文が前のまま: ' + note.textContent);
  c.ST.view = '3d-ext';
  c.syncVideoRenderSource();
  assert.match(note.textContent, /いま見ている3Dの画角/, '戻らない: ' + note.textContent);
});

test('ウォークスルーで押すと、拒否の文面がそのままダイアログに出る', async () => {
  // 実際の文面は index.html の videoRenderViewRefusalText が作る（同じ関数を走らせる）。
  const refusal = vm.runInContext('(' + topLevelFunction('videoRenderViewRefusalText') + ')',
    vm.createContext({ ST: { view: '3d-walk' } }))();
  const c = ui({ view: '3d-walk', generate: () => { throw new Error(refusal); } });
  c.openVideoRenderDialog();
  await c.runVideoRenderPackage();
  const status = c.$dom.byId['video-render-status'].textContent;
  assert.ok(status.indexOf(refusal) >= 0, '拒否の文面が出ていない: ' + status);
  assert.match(status, /外観3D/);
  assert.equal(c.$dom.byId['video-render-modal'].classList.contains('show'), true);
});
