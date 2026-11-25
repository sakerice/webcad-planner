// プランの文字を画面の HTML へつなぐ所が、エスケープを通していること(ブラウザ無しで、PR のたびに走る)。
//
// なぜ要るか: プランのどの欄も他人が決められる(他人のプランのファイル・共有 URL・共同編集の
// 相手の差分・AI の出力)。欄を1つ足すときに `'+it.x+'` とつなぐだけで、物を選んだ人の画面で
// 相手のスクリプトが動く(2026-11 の監査で実際に起きた)。画面テスト injection-screen は
// 約10分かかり CI では走らないので、ここで同じ攻撃の文字を node:vm の上で確かめる。
//
// 見ること:
//   1. エスケープの関数(escHtml・safeHtmlColor・htmlNum・ownGet・ownSlot)の境目の値
//   2. 設定欄(updateProps。全部の壁・物・部屋)・外観/内観/屋根の色の欄(renderExteriorWallPanel)・
//      図面の一覧(renderJisSheetList)・手すりの欄(railingDesignHtml)に攻撃の文字を入れ、
//      出た HTML を読んで、生のタグ・ハンドラ・属性の切れ目が出ていないこと
//   3. 新しく足す HTML の組み立てが、プランの欄をエスケープなしでつないでいないこと(簡単な静的検査)
//
// 攻撃の文字とプランの作り方は injection-plan.cjs(画面テストと共用)。
// 関数は app-source.cjs のソースから名前で切り出し、足りない名前は実行して分かった順に載せる
// (ReferenceError の名前をソースから探して載せ、もう一度走らせる)。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { appSource, ROOT } = require('./app-source.cjs');
const { PAYLOADS, BASE, clone, stringPayloads, tagged, inheritedValue, evilPlan } = require('./injection-plan.cjs');

const src = appSource();

// ── ソースから名前で切り出す ─────────────────────────────────────
function scanBalanced(from) {
  let depth = 0, mode = null, started = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; started = true; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; if (started && depth === 0) return i; continue; }
    if ((c === ';' || c === '\n') && depth === 0 && started) return i;
  }
  throw new Error('閉じていない');
}
// 1番上の段の function / var / const / let の定義。無ければ null。
function definitionOf(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at >= 0) {
    const brace = src.indexOf('{', src.indexOf(')', at));
    return src.slice(at + 1, scanBalanced(brace) + 1);
  }
  for (const kw of ['var ', 'const ', 'let ']) {
    const m = new RegExp('\\n' + kw + name.replace(/\$/g, '\\$') + '\\s*=').exec(src);
    if (!m) continue;
    const eq = src.indexOf('=', m.index + 1);
    let i = eq + 1;
    while (/\s/.test(src[i])) i++;
    let end;
    if ('{[('.includes(src[i])) {
      end = scanBalanced(i);
      const semi = src.indexOf(';', end), nl = src.indexOf('\n', end);
      if (semi >= 0 && semi < nl) end = semi;
    } else {
      const semi = src.indexOf(';', i), nl = src.indexOf('\n', i);
      end = (semi >= 0 && semi < nl) ? semi : nl - 1;
    }
    return 'var ' + name + ' ' + src.slice(eq, end + 1) + ';';
  }
  return null;
}

// ── 画面の代わり(innerHTML に入れた文字を取っておく) ─────────────────
function fakeEl(id, sink) {
  const e = {
    id, style: {}, dataset: {}, textContent: '', value: '', checked: false, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, removeAttribute() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, appendChild() {}, addEventListener() {},
    closest() { return null; }, focus() {}, blur() {},
  };
  Object.defineProperty(e, 'innerHTML', { get() { return sink[id] || ''; }, set(v) { sink[id] = String(v); } });
  return e;
}
function makeCtx() {
  const sink = {};
  const els = {};
  const document = {
    getElementById: (id) => (els[id] ||= fakeEl(id, sink)),
    querySelector: () => null, querySelectorAll: () => [], createElement: (t) => fakeEl('new-' + t, sink),
    body: fakeEl('body', sink), addEventListener() {},
  };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    document, navigator: { userAgent: 'node' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    alert() {}, confirm: () => false,
  });
  ctx.window = ctx;
  ctx.__sink = sink;
  // 高さの読み取り(土間の深さなど)は画面と Worker が共有する部品。画面では <script> で先に載っている。
  ctx.HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
  // 設定欄は setPropsBodyHtml で差し込む(ロック中の欄を無効にするため DOM を触る)。ここでは文字を取るだけ
  vm.runInContext('var __propsHtml=null; function setPropsBodyHtml(b,h){ __propsHtml=h; }', ctx);
  ctx.__loaded = new Set(['setPropsBodyHtml']);
  return ctx;
}
// code を走らせ、知らない名前があればソースから載せて走らせ直す
function run(ctx, code) {
  for (let k = 0; k < 600; k++) {
    try { return vm.runInContext(code, ctx); }
    catch (e) {
      const m = /^(\S+) is not defined$/.exec(e && e.message);
      if (!m) throw e;
      const name = m[1];
      if (ctx.__loaded.has(name)) throw new Error(name + ' を載せたのにまだ見つからない');
      ctx.__loaded.add(name);
      const def = definitionOf(name);
      if (!def) throw new Error('ソースに無い名前: ' + name);
      vm.runInContext(def, ctx);
    }
  }
  throw new Error('載せる名前が多すぎる');
}

// ── 出た HTML を読む(ブラウザと同じ区切り方の、小さな字句解析) ───────────
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|quot|amp|lt|gt|apos);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'quot') return '"'; if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'apos') return "'";
  return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
function parseHtml(html) {
  const tags = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    const m = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const tag = { name: m[1].toLowerCase(), attrs: [], close: html[lt + 1] === '/' };
    let j = lt + m[0].length;
    for (;;) {
      while (j < n && /[\s/]/.test(html[j])) j++;
      if (j >= n || html[j] === '>') { j++; break; }
      let k = j;
      while (k < n && !/[\s/>=]/.test(html[k])) k++;
      if (k === j) k++;
      const an = html.slice(j, k).toLowerCase();
      j = k;
      while (j < n && /\s/.test(html[j])) j++;
      let val = '';
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") { const e = html.indexOf(q, j + 1); val = html.slice(j + 1, e < 0 ? n : e); j = e < 0 ? n : e + 1; }
        else { let e = j; while (e < n && !/[\s>]/.test(html[e])) e++; val = html.slice(j, e); j = e; }
      }
      tag.attrs.push([an, decode(val)]);
    }
    tags.push(tag);
    i = j;
  }
  return tags;
}
function shape(html) {
  const tags = new Set(), attrs = new Set();
  for (const t of parseHtml(html)) { tags.add(t.name); for (const [a] of t.attrs) attrs.add(a); }
  return { tags, attrs };
}
// 攻撃の文字が HTML の形を変えていないか。allowed は同じ欄に無害な文字を入れたときの形。
function problemsIn(html, allowed) {
  const out = [];
  for (const t of parseHtml(html)) {
    if (!allowed.tags.has(t.name)) out.push(`知らないタグ <${t.name}>`);
    if (t.name === 'script' && !t.close) out.push('<script> が出た');
    for (const [a, v] of t.attrs) {
      if (!allowed.attrs.has(a)) out.push(`知らない属性 ${a}= (<${t.name}>)`);
      if (/^on/.test(a) && /__xss|attacker\.invalid/.test(v)) out.push(`ハンドラに攻撃の文字 <${t.name} ${a}="${v.slice(0, 80)}">`);
      if (/^(href|src|action|formaction|xlink:href)$/.test(a) && /^\s*(javascript|data):/i.test(v)) out.push(`${a}=${v.slice(0, 40)}`);
      if (a === 'style' && /attacker\.invalid|url\(|expression\(/i.test(v)) out.push(`style に外の値 "${v.slice(0, 80)}"`);
    }
  }
  return [...new Set(out)];
}

// ── 1つのプランで画面の HTML を全部作る ──────────────────────────
function loadCeilingDesigner(ctx) {
  // 天井範囲の欄(CeilingDesigner.props)。読み込めなければ updateProps は汎用の欄を出す
  try { run(ctx, readFileSync(join(ROOT, 'assets', 'js', 'ceiling-designer.js'), 'utf8')); } catch (e) { /* 読み込めない時は汎用の欄 */ }
}
function faceKeysOf(plan) {
  const ctx = makeCtx();
  ctx.DATA = clone(plan);
  ctx.ST = { selected: null, floor: 1, view: '2d' };
  return run(ctx, `(function(){ var ex=[], int=[]; DATA.walls.forEach(function(w){
    getWallExteriorSpans(w).forEach(function(f){ ex.push(exteriorFaceKey(w,f)); });
    getWallInteriorFaces(w).forEach(function(f){ int.push(interiorFaceKey(w,f)); });
  }); return JSON.stringify({exterior:ex, interior:int}); })()`);
}
function renderAll(plan) {
  const ctx = makeCtx();
  ctx.DATA = plan;
  ctx.ST = { selected: null, floor: 1, view: '2d' };
  loadCeilingDesigner(ctx);
  const out = [], errors = [];
  const take = (where, fn) => {
    try { const h = fn(); if (typeof h === 'string' && h) out.push([where, h]); }
    catch (e) { errors.push(where + ': ' + String(e && e.message).slice(0, 160)); }
  };
  for (const coll of ['walls', 'items', 'rooms']) {
    plan[coll].forEach((o, i) => take(`設定欄 ${coll}[${i}] ${String(o.type || '').slice(0, 30)}`, () => {
      ctx.ST.selected = o; ctx.__propsHtml = null; ctx.__sink['props-body'] = '';
      run(ctx, 'updateProps()');
      return ctx.__propsHtml || ctx.__sink['props-body'];
    }));
  }
  ctx.ST.selected = null;
  // 色の欄。階ごと・壁ごとの欄も出す(壁ごとの欄は linked を外した階で出る)
  for (const mode of ['exterior', 'interior', 'roof']) {
    take('色の欄 ' + mode, () => { ctx.__sink['exterior-wall-panel-body'] = ''; run(ctx, `renderExteriorWallPanel(${JSON.stringify(mode)})`); return ctx.__sink['exterior-wall-panel-body']; });
  }
  take('高さの既定', () => run(ctx, '[1,2,3].map(function(f){return heightDefaultsRowHtml(f);}).join("")'));
  return { out, errors, ctx };
}

const benignV = (field) => 'safe-' + String(field).replace(/[^a-z0-9]/gi, '-');
let FACE_KEYS = null;
const faceKeys = () => (FACE_KEYS ||= JSON.parse(faceKeysOf(BASE)));
// 外観の階ごと・壁ごとの欄が出るよう、linked を外す(画面テストと同じ欄を見るため)
function openAllRows(p) {
  for (const s of [p.exteriorWallSettings, p.interiorWallSettings]) {
    if (!s) continue;
    if (s.whole) s.whole.linked = false;
    for (const f of Object.keys(s.floors || {})) s.floors[f].linked = false;
  }
  return p;
}
let ALLOWED = null;
function allowedShape() {
  if (ALLOWED) return ALLOWED;
  const { out, errors } = renderAll(openAllRows(evilPlan(benignV, faceKeys())));
  assert.deepEqual(errors, [], '無害な文字のプランで例外');
  const tags = new Set(), attrs = new Set();
  for (const [, h] of out) { const s = shape(h); s.tags.forEach((t) => tags.add(t)); s.attrs.forEach((a) => attrs.add(a)); }
  ALLOWED = { tags, attrs, count: out.length };
  return ALLOWED;
}

// ── 1. エスケープの関数の境目の値 ──────────────────────────────
function helperCtx() {
  const ctx = makeCtx();
  for (const n of ['escHtml', 'safeHtmlColor', 'htmlNum', 'ownGet', 'ownSlot']) { ctx.__loaded.add(n); vm.runInContext(definitionOf(n), ctx); }
  return ctx;
}

test('escHtml: 本文と引用符で囲んだ属性で意味を持つ5文字を全部置き換え、0 と false は文字で出す', () => {
  const { escHtml } = helperCtx();
  assert.equal(escHtml(`<a href="x" title='y'>&amp;</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;');
  assert.equal(escHtml(0), '0');
  assert.equal(escHtml(false), 'false');
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(12.5), '12.5');
  assert.equal(escHtml(Object.create(null)), '', 'toString の無い値は空');
  assert.equal(escHtml({ toString: 1 }), '', 'toString が関数でない値は空');
  assert.equal(escHtml({ toString() { throw new Error('x'); } }), '', 'toString が例外の値は空');
  for (const p of stringPayloads()) {
    const e = escHtml(p.value);
    assert.ok(!/[<>"']/.test(e), p.id + ' に < > " \' が残った');
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(e), p.id + ' に置き換えていない & が残った');
  }
});

test('safeHtmlColor: #rgb・#rgba・#rrggbb・#rrggbbaa と厳しい形の rgb()/rgba() だけを通す', () => {
  const { safeHtmlColor } = helperCtx();
  for (const ok of ['#abc', '#abcd', '#a1b2c3', '#A1B2C3D4', 'rgb(1,2,3)', 'rgba(255, 255, 255, 0.5)', 'rgba(0,0,0,1)', 'rgba(0,0,0,.25)', 'rgba(0,0,0,0)']) {
    assert.equal(safeHtmlColor(ok, 'FB'), ok, ok + ' が通らない');
  }
  for (const bad of ['red', 'red;background:url(x)', 'expression(alert(1))', 'rgb(1,2,3);x:y', 'rgb(1,2,3)\n', '#abc\n', ' #abc', '#ab', '#abcde',
    '#ggg', 'rgba(1,2,3,0.5,1)', 'rgb(1,2,3', 'url(//attacker.invalid/x)', '#abc"><img', ['#abc'], { toString: () => '#abc' }, 0x123456, null, undefined, '']) {
    assert.equal(safeHtmlColor(bad, 'FB'), 'FB', JSON.stringify(String(bad)) + ' が通った');
  }
  assert.equal(safeHtmlColor('bad'), '', '既定を渡さなければ空');
  for (const p of stringPayloads()) assert.equal(safeHtmlColor(p.value, 'FB'), 'FB', p.id);
});

test('htmlNum: 有限の数(数の文字を含む)だけを数の文字で出す', () => {
  const { htmlNum } = helperCtx();
  assert.equal(htmlNum(120), '120');
  assert.equal(htmlNum('120'), '120');
  assert.equal(htmlNum(' 1.5 '), '1.5');
  assert.equal(htmlNum(-0.25), '-0.25');
  assert.equal(htmlNum(0), '0');
  assert.equal(htmlNum('1e3'), '1000');
  for (const bad of ['5px', '', '   ', [1], [], {}, Infinity, -Infinity, NaN, '1);alert(1', null, undefined, true]) {
    assert.equal(htmlNum(bad), '', JSON.stringify(String(bad)) + ' が数として出た');
  }
  assert.equal(htmlNum('x', 7), '7', '既定を渡すとその値');
  for (const p of stringPayloads()) assert.ok(/^[-0-9.e+]*$/i.test(htmlNum(p.value)), p.id);
});

test('ownGet・ownSlot: 継承した鍵に当たらず、__proto__ も自分の欄として作る', () => {
  const ctx = helperCtx();
  const table = { a: 1, 0: 'zero' };
  for (const k of PAYLOADS.inheritedKeys) assert.equal(ctx.ownGet(table, k), undefined, k + ' を引けてしまう');
  assert.equal(ctx.ownGet(table, 'a'), 1);
  assert.equal(ctx.ownGet(table, 0), 'zero', '数の鍵で引ける');
  assert.equal(ctx.ownGet(['x', 'y'], 1), 'y', '配列を番号で引ける');
  assert.equal(ctx.ownGet(['x'], 'length'), 1, '配列の自分の欄');
  assert.equal(ctx.ownGet(null, 'a'), undefined);
  assert.equal(ctx.ownGet(table, null), undefined);
  assert.equal(ctx.ownGet(table, undefined), undefined);
  assert.equal(ctx.ownGet(table, { toString() { throw new Error('x'); } }), undefined, '文字に直せない鍵は undefined');

  const slots = {};
  const protoBefore = Object.getPrototypeOf(slots);
  for (const k of PAYLOADS.inheritedKeys) {
    const s = ctx.ownSlot(slots, k, () => ({ made: k }));
    assert.equal(s.made, k, k + ' の入れ物が作られない');
    assert.ok(Object.prototype.hasOwnProperty.call(slots, k), k + ' が自分の欄でない');
    assert.equal(ctx.ownSlot(slots, k, () => ({ made: 'again' })).made, k, k + ' を2回目に作り直した');
  }
  assert.equal(Object.getPrototypeOf(slots), protoBefore, '__proto__ の鍵で継承元が差し替わった');
  assert.equal(({}).made, undefined, 'Object.prototype が汚れた');
  assert.deepEqual(Object.keys(slots).sort(), [...PAYLOADS.inheritedKeys].sort());
});

// ── 2. 画面の HTML を組む関数に攻撃の文字を入れる ───────────────────
test('無害な文字のプランで、見る欄が全部作られる(空振りの検査にしない)', () => {
  const a = allowedShape();
  assert.ok(a.count > 250, '作れた HTML が少ない: ' + a.count);
  for (const t of ['input', 'select', 'button', 'option']) assert.ok(a.tags.has(t), t + ' が無い');
  for (const at of ['onchange', 'onclick', 'value', 'data-wall-id', 'data-face-key']) assert.ok(a.attrs.has(at), at + ' が無い');
  assert.ok(!a.tags.has('img') && !a.tags.has('script') && !a.tags.has('svg'), '比べる元に img・script・svg がある(検査が甘くなる)');
});

for (const p of stringPayloads()) {
  test(`攻撃の文字 ${p.id}: 設定欄・色の欄・高さの既定の HTML の形が変わらない`, () => {
    const allowed = allowedShape();
    const plan = openAllRows(evilPlan(tagged(p), faceKeys()));
    const { out, errors } = renderAll(plan);
    assert.deepEqual(errors, [], '例外が出た');
    assert.ok(out.length >= allowed.count - 5, `作れた HTML が少ない ${out.length} / ${allowed.count}`);
    const bad = [];
    for (const [where, h] of out) for (const pr of problemsIn(h, allowed)) bad.push(where + ': ' + pr);
    assert.deepEqual(bad.slice(0, 20), [], `差し込まれた所が ${bad.length} 件`);
  });
}

test('継承した鍵(constructor・__proto__ …)を種類名・id・テクスチャに入れても、例外も差し込みも無い', () => {
  const allowed = allowedShape();
  const plan = openAllRows(evilPlan(inheritedValue(), faceKeys(), { inherited: true }));
  const { out, errors } = renderAll(plan);
  assert.deepEqual(errors, [], '例外が出た');
  const bad = [];
  for (const [where, h] of out) for (const pr of problemsIn(h, allowed)) bad.push(where + ': ' + pr);
  assert.deepEqual(bad, []);
  assert.equal(({}).color, undefined, 'Object.prototype が汚れた');
});

test('壁の階が継承した鍵でも、外観カラー設定の欄が開く(壁を階ごとに分ける表が継承元を持たない)', () => {
  const allowed = allowedShape();
  for (const k of PAYLOADS.inheritedKeys) {
    const plan = openAllRows(clone(BASE));
    plan.walls.filter((w) => (w.thick || 0) >= 120).slice(0, 3).forEach((w) => { w.floor = k; });
    const ctx = makeCtx();
    ctx.DATA = plan;
    ctx.ST = { selected: null, floor: 1, view: '2d' };
    for (const mode of ['exterior', 'interior', 'roof']) {
      ctx.__sink['exterior-wall-panel-body'] = '';
      run(ctx, `renderExteriorWallPanel(${JSON.stringify(mode)})`);
      const h = ctx.__sink['exterior-wall-panel-body'];
      assert.ok(h.length > 100, `${k} ${mode}: 欄が空`);
      assert.deepEqual(problemsIn(h, allowed), [], `${k} ${mode}`);
    }
  }
});

test('図面の一覧: 図面の名前と鍵に攻撃の文字を入れても、ボタンの形が変わらない', () => {
  const ctx = makeCtx();
  ctx.JIS_UI = { sheet: null };
  const html = (sheets) => { ctx.__sink['jis-sheet-list'] = ''; ctx.__sheets = sheets; run(ctx, 'renderJisSheetList(__sheets)'); return ctx.__sink['jis-sheet-list']; };
  const okHtml = html([{ kind: 'plan', key: 1, label: '1階平面図' }, { kind: 'elev', key: 'N', label: '北立面図' }]);
  const allowed = shape(okHtml);
  assert.ok(allowed.attrs.has('data-key') && allowed.attrs.has('data-key-num'), '比べる元に data-key が無い');
  for (const p of stringPayloads()) {
    const v = tagged(p);
    const h = html([{ kind: 'plan', key: 1, label: v('sheet.label') }, { kind: 'elev', key: v('sheet.key'), label: v('sheet.label2') }, { kind: v('sheet.kind'), key: 2, label: 'x' }]);
    assert.deepEqual(problemsIn(h, allowed), [], p.id);
    // 押したときに読む値は、入れた値のまま戻る(属性の中で切れていない)
    const btn = parseHtml(h).filter((t) => t.name === 'button' && !t.close);
    assert.equal(new Map(btn[1].attrs).get('data-key'), v('sheet.key'), p.id + ' の鍵が属性の中で変わった');
  }
});

test('手すりの欄(railingDesignHtml): 色・意匠の欄に攻撃の文字を入れても形が変わらない', () => {
  const ctx = makeCtx();
  ctx.DATA = clone(BASE);
  ctx.ST = { selected: null, floor: 1 };
  const draw = (it) => { ctx.__it = it; return run(ctx, "railingDesignHtml(__it,{label:'手すりの意匠'}) + railingDesignHtml(__it,{label:'格子の意匠',frameDefault:'#b09468',capToggle:true,autoLabel:'指定しない'})"); };
  const base = { id: 'rail', type: 'balcony-railing', x: 0, y: 0, w: 2000, d: 60, floor: 2 };
  const allowed = shape(draw(Object.assign({}, base, { railCapColor: '#ffffff', railFrameColor: '#000000', railStyle: 'safe', latticeCap: true })));
  assert.ok(allowed.tags.has('input') || allowed.tags.has('select'), '手すりの欄が空');
  for (const p of stringPayloads()) {
    const v = tagged(p);
    const it = Object.assign({}, base, { id: v('rail.id'), railCapColor: v('rail.railCapColor'), railFrameColor: v('rail.railFrameColor'), railStyle: v('rail.railStyle'), railPattern: v('rail.railPattern'), color: v('rail.color'), latticeCap: true });
    assert.deepEqual(problemsIn(draw(it), allowed), [], p.id);
  }
});

// ── 3. 静的検査: HTML の組み立てに、プランの欄を素通しでつないでいないか ─────────
//
// HTML の文字列(引用符の中に '<' がある行)で、`'+it.n+'` のように「物の欄を読む式」を
// エスケープの関数を通さずにつないでいる所を探す。完全な検査ではない(変数に移してから
// つなぐと見えない)。新しく欄を足したときの書き忘れを拾うのが目的。
//
// 物を指す変数: it・r・w・o・room・wall・item・sel・s・ws・a(画面の関数でプランの物を持つ名前)。
// 許す包み: escHtml・esc・safeHtmlColor・htmlNum・escSvgText・Math.*・Number・数を作る関数(toFixed など)。
// 既に安全と確かめた所は ALLOW に「ファイル:行の中身の一部」で残す(行番号は変わるので中身で持つ)。
const HTML_FILES = ['index.html', 'assets/js/app-state.js', 'assets/js/app-constants.js', 'assets/js/ceiling-designer.js',
  'assets/js/asset-swap.js', 'assets/js/building-style.js', 'assets/js/plan-finish.js', 'assets/js/compare-mode.js'];
const OBJ = '(?:it|r|w|o|room|wall|item|sel|ws|a|ST\\.selected)';
// '+it.n+' の形と、'+(it.color||'#fff')+' の形(既定の値を付けて素通しする書き方)
const RAW_FIELD = new RegExp(`['"]\\s*\\+\\s*(?:(${OBJ}\\.[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\s*\\+\\s*['"]|\\(\\s*(${OBJ}\\.[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\s*\\|\\|[^()?:]{1,80}?\\)\\s*\\+\\s*['"])`, 'g');
// 数・真偽にしかならない欄、または既に読んで安全と確かめた欄(式の文字で持つ)。
const SAFE_EXPR = new Set([
  // 数として保存され、HTML へは数の文字しか出ない欄は htmlNum を通すこと。ここに足すのは
  // 「プランの値ではなく、画面が作った値」を持つ欄だけにする。
]);
const ALLOW = [
  // 図面の後退距離の線。a・b は座標を計算して作った点。万一プランの座標が文字で文字のつなぎに
  // なっても、図面は jisSvgIsSafe で読み直してから出すので、画面には入らない。
  'index.html::return \'<line x1="\'+a.x+\'" y1="\'+a.y',
];
// これらの関数の括弧の中にある式は、エスケープを通っている
const WRAPPERS = /(?:escHtml|esc|safeHtmlColor|htmlNum|escSvgText|encodeURIComponent|Number|Math\.\w+)\s*\($/;
function insideWrapper(line, at) {
  const stack = [];
  let quote = null;
  for (let i = 0; i < at; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') stack.push(WRAPPERS.test(line.slice(Math.max(0, i - 40), i + 1)));
    else if (c === ')') stack.pop();
  }
  return stack.some(Boolean);
}
function rawConcatenations() {
  const found = [];
  for (const rel of HTML_FILES) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!/<[a-z]/i.test(line)) return; // HTML を組んでいる行だけ
      if (/^\s*\/\//.test(line)) return;
      for (const m of line.matchAll(RAW_FIELD)) {
        const expr = m[1] || m[2];
        if (insideWrapper(line, m.index + m[0].indexOf(expr))) continue;
        if (SAFE_EXPR.has(expr)) continue;
        if (/\.(length|id\.length)$/.test(expr)) continue;
        if (ALLOW.some((a) => { const [f, frag] = a.split('::'); return f === rel && line.includes(frag); })) continue;
        found.push(`${rel}:${i + 1}: ${expr}  …${line.trim().slice(0, 120)}`);
      }
    });
  }
  return found;
}

test('静的検査: HTML を組む行で、物の欄をエスケープなしでつないでいない', () => {
  const found = rawConcatenations();
  assert.deepEqual(found, [], 'プランの欄を素通しでつないでいる(escHtml・safeHtmlColor・htmlNum を通す):\n' + found.join('\n'));
});

test('静的検査が働いている(素通しのつなぎを見つける)', () => {
  const line = `html += '<div class="pr">'+it.n+'</div>';`;
  const hit = (l) => [...l.matchAll(RAW_FIELD)].filter((m) => !insideWrapper(l, m.index + m[0].indexOf(m[1] || m[2]))).map((m) => m[1] || m[2]);
  assert.deepEqual(hit(line), ['it.n']);
  assert.deepEqual(hit(`html+='<input value="'+(it.color||'#fff')+'">';`), ['it.color'], '既定の値を付けた素通しも拾う');
  assert.deepEqual(hit(`html+='<b>'+(it.texture||it.t2?'<i>あり</i>':'')+'</b>';`), [], '条件に使うだけの欄は拾わない');
  const safe = `html += '<div class="pr">'+escHtml(it.n)+'</div><input value="'+safeHtmlColor(it.color,'#fff')+'">';`;
  assert.deepEqual(hit(safe), []);
  assert.deepEqual(hit(`'<b>'+room.label.text+'</b>'`), ['room.label.text']);
  assert.deepEqual(hit(`html+='<b title="'+escHtml(it.name+' '+it.category+' x')+'">'+it.n+'</b>';`), ['it.n'], 'escHtml( の中は通し、外は拾う');
});
