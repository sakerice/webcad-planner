// プランを開くときの補完は normalizeLoadedPlan(assets/js/app-state.js) の1か所に集める。
//
// 経路ごとに ensure* を並べて書くと、並びや抜けが経路ごとにずれていく(実際にずれていた:
// 保存の復元だけ高さの既定を戻さない、取り込みだけ高さの既定を写さない、など)。
// ここでは「ensure*() か normalizeLegacyFurnitureItems() の呼び出しが、同じ関数の中で
// 10行以内に2つ以上ある箇所」を、補完の並びを手で書いた箇所とみなし、normalizeLoadedPlan の
// 本体と、件数を決めて残した箇所(NOT_YET)以外に無いことを見る。
//
// 拾う呼び出し: 引数なしで呼んでいる文としての呼び出し。`var s=ensureExteriorWallSettings();` の
// ように戻り値を使う呼び出し(設定を読むための呼び出し)と、`root.ensure…()` のような
// オブジェクト経由の呼び出しは並びとみなさない。
// 近さは10行。loadPlanFromStorage の旧い並びは1行に1つずつ書いてあり、7行に渡っていた。
//
// 呼び出しがどの関数の中にあるかは、手前の function の見出しから波括弧を数えて決める
// (文字列とコメントは飛ばす)。無名の関数は「外側の名前>無名」として数える。
// `x = function(){}` / `x: function(){}` は x の名前で数える。
// 限界: アロー関数(=>)は関数として扱わず、外側の関数の中として数える。正規表現の
// リテラルの中の引用符や波括弧は数え違えることがある(今のソースでは当たっていない)。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { ROOT } = require('./app-source.cjs');

const NEAR = 10;
const SELF = 'assets/js/app-state.js:normalizeLoadedPlan';

// まだ ensure* を並べて書いている、プランを「開く」7経路以外の箇所と、その呼び出しの件数。
// 保存・書き出し・共同編集の開始・レンダリング依頼の直前の整え、共同編集の参加
// (installSharedPlan)、読み取りの見直し用の画像を撮る一時的な整え(PlanSnapshot の capture)、
// 起動時の初期化(index.html の関数の外)、3Dの組み立ての前の整え(build3D)、
// 白紙から始める(chooseBlankPlan。読み込みではないので置き換えない)。
// 2026-11-11 の置き換え(開く7経路)の対象外として残した。件数が増えたら落ちる。
// 直して減ったら、ここの数も減らす(一覧は減らす方向にだけ動かす)。
const NOT_YET = {
  'index.html:exportPlan': 7,
  'index.html:savePlanToStorage': 7,
  'index.html:installSharedPlan': 5,
  'index.html:createSharedRoom': 5,
  'index.html:buildUnityRenderRequest': 5,
  'index.html:(先頭)': 2,
  'index.html:build3D': 2,
  'assets/js/plan-data.js:chooseBlankPlan': 2,
  'assets/js/plan-snapshot.js:capture': 5,
};

const NAME = '(?:ensure[A-Z][\\w$]*|normalizeLegacyFurnitureItems)';
// 直前が = . function return の呼び出しは拾わない
const CALL = new RegExp('(?<![=.$\\w]\\s*|function\\s+|return\\s+)\\b' + NAME + '\\s*\\(\\s*\\)', 'g');

function sources() {
  const out = [['index.html', readFileSync(join(ROOT, 'index.html'), 'utf8')]];
  const dir = join(ROOT, 'assets', 'js');
  readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    .forEach((f) => out.push(['assets/js/' + f, readFileSync(join(dir, f), 'utf8')]));
  return out;
}

// text[from] が '{' のとき、文字列とコメントを飛ばして波括弧を数え、pos の時点でまだ
// 閉じていなければ true(pos はその本体の中)。
function bodyContains(text, from, pos) {
  let depth = 0, mode = null;
  for (let i = from; i < pos; i++) {
    const c = text[i], n = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode || (c === '\n' && mode !== '`')) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return false; }
  }
  return depth > 0;
}

function headersOf(text) {
  const re = /(?:([A-Za-z_$][\w$]*)\s*[:=]\s*)?\bfunction\b\s*([A-Za-z_$][\w$]*)?\s*\(/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const close = text.indexOf(')', m.index + m[0].length - 1);
    const open = close < 0 ? -1 : text.indexOf('{', close);
    if (open < 0) continue;
    out.push({ at: m.index, open, name: m[2] || m[1] || null });
  }
  return out;
}

// pos を含む関数の名前。無名なら外側の名前に「>無名」を付ける。どれにも入っていなければ (先頭)。
function enclosingName(text, headers, pos) {
  let anon = 0;
  for (let k = headers.length - 1; k >= 0; k--) {
    const h = headers[k];
    if (h.open >= pos) continue;
    if (!bodyContains(text, h.open, pos)) continue;
    if (h.name) return h.name + '>無名'.repeat(anon);
    anon++;
  }
  return '(先頭)' + '>無名'.repeat(anon);
}

function handWrittenSequences() {
  const counts = {};
  for (const [file, text] of sources()) {
    const headers = headersOf(text);
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (pos) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
    const calls = [];
    let m;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(text))) calls.push({ line: lineOf(m.index), fn: enclosingName(text, headers, m.index) });
    calls.forEach((c, i) => {
      const near = calls.some((d, j) => j !== i && d.fn === c.fn && Math.abs(d.line - c.line) <= NEAR);
      if (!near) return;
      const key = file + ':' + c.fn;
      (counts[key] ||= { n: 0, first: c.line + 1 }).n++;
    });
  }
  return counts;
}

const found = handWrittenSequences();
// PRINT_SEQUENCES=1 で、拾った箇所と件数を出す(NOT_YET の数を直すとき用)
if (process.env.PRINT_SEQUENCES === '1') console.log(JSON.stringify(found, null, 1));

test('開く経路で ensure* の並びを手で書いている箇所が、normalizeLoadedPlan の本体以外に無い', () => {
  const extra = Object.keys(found).filter((k) => k !== SELF && !(k in NOT_YET))
    .map((k) => k + ' (' + found[k].first + '行目から ' + found[k].n + '件)');
  assert.deepEqual(extra, [], '補完は normalizeLoadedPlan(options) を呼んで済ませる:\n' + extra.join('\n'));
});

test('残してある箇所の呼び出しの件数が、決めた数と同じ(書き足すと落ちる。減ったら数を減らす)', () => {
  const got = {};
  Object.keys(NOT_YET).forEach((k) => { got[k] = found[k] ? found[k].n : 0; });
  assert.deepEqual(got, NOT_YET);
});

test('検査が実際に拾う（normalizeLoadedPlan の本体は1つの並びとして見つかる）', () => {
  assert.ok(found[SELF], JSON.stringify(Object.keys(found)));
  assert.equal(found[SELF].n, 7);   // ensureObjectIds〜ensureHeightDefaults の6つと normalizeLegacyFurnitureItems
});

test('呼び出しの拾い方: 戻り値を使う呼び出し・定義・オブジェクト経由は拾わず、無名関数は外側の名前で数える', () => {
  const t = [
    'function a(){ var s=ensureX(); return ensureY(); }',
    'function ensureZ(){ root.ensureW(); }',
    'var b = function(){ ensureP(); normalizeLegacyFurnitureItems(); };',
    'function c(){ list.forEach(function(){ ensureQ();',
    ' ensureR(); }); }',
  ].join('\n');
  const headers = headersOf(t);
  const names = [];
  let m; CALL.lastIndex = 0;
  while ((m = CALL.exec(t))) names.push(m[0].trim() + '@' + enclosingName(t, headers, m.index));
  assert.deepEqual(names, ['ensureP()@b', 'normalizeLegacyFurnitureItems()@b', 'ensureQ()@c>無名', 'ensureR()@c>無名']);
});
