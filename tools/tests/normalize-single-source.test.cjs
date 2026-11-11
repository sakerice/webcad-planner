// プランを開くときの補完は normalizeLoadedPlan(assets/js/app-state.js) の1か所に集める。
//
// 経路ごとに ensure* を並べて書くと、並びや抜けが経路ごとにずれていく(実際にずれていた:
// 保存の復元だけ高さの既定を戻さない、取り込みだけ高さの既定を写さない、など)。
// ここでは「ensureExteriorWallSettings(); と normalizeLegacyFurnitureItems(); を近くで両方
// 呼んでいる箇所」を、補完の並びを手で書いた箇所とみなし、normalizeLoadedPlan の本体以外に
// 新しく書き足されていないことを見る。
//
// 近さは10行以内。loadPlanFromStorage の旧い並びは1行に1つずつ書いてあり、2つの呼び出しが
// 7行離れていたので、5行では拾えなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { ROOT } = require('./app-source.cjs');

const NEAR = 10;

// まだ ensure* を並べて書いている、プランを「開く」以外の箇所。
// 保存・書き出し・共同編集の開始・レンダリング依頼の直前の整えと、共同編集の参加
// (installSharedPlan)。2026-11-11 の置き換え(開く7経路)の対象外として残した。
// ここを増やすのではなく、減らす方向でだけ書き換えること。
const NOT_YET = new Set([
  'index.html:exportPlan',
  'index.html:savePlanToStorage',
  'index.html:installSharedPlan',
  'index.html:createSharedRoom',
  'index.html:buildUnityRenderRequest',
]);

function sources() {
  const out = [['index.html', readFileSync(join(ROOT, 'index.html'), 'utf8')]];
  const dir = join(ROOT, 'assets', 'js');
  readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    .forEach((f) => out.push(['assets/js/' + f, readFileSync(join(dir, f), 'utf8')]));
  return out;
}

// その行を含む関数の名前（いちばん近い手前の "function 名前(" ）
function enclosingName(lines, at) {
  for (let i = at; i >= 0; i--) {
    const m = lines[i].match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (m) return m[1];
  }
  return '(先頭)';
}

function handWrittenSequences() {
  const found = [];
  for (const [file, text] of sources()) {
    const lines = text.split('\n');
    const ext = [], legacy = [];
    lines.forEach((l, i) => {
      if (/ensureExteriorWallSettings\(\);/.test(l)) ext.push(i);
      if (/normalizeLegacyFurnitureItems\(\);/.test(l)) legacy.push(i);
    });
    const seen = new Set();
    ext.forEach((a) => legacy.forEach((b) => {
      if (Math.abs(a - b) > NEAR) return;
      const at = Math.min(a, b);
      const name = enclosingName(lines, at);
      const key = file + ':' + name;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ key, where: file + ':' + (at + 1) + ' (' + name + ')' });
    }));
  }
  return found;
}

test('開く経路で ensure* の並びを手で書いている箇所が、normalizeLoadedPlan の本体以外に無い', () => {
  const extra = handWrittenSequences()
    .filter((f) => f.key !== 'assets/js/app-state.js:normalizeLoadedPlan' && !NOT_YET.has(f.key))
    .map((f) => f.where);
  assert.deepEqual(extra, [], '補完は normalizeLoadedPlan(options) を呼んで済ませる:\n' + extra.join('\n'));
});

test('残してある箇所の一覧が古くなっていない（直したら NOT_YET から消す）', () => {
  const keys = new Set(handWrittenSequences().map((f) => f.key));
  const stale = [...NOT_YET].filter((k) => !keys.has(k));
  assert.deepEqual(stale, [], 'もう並びを書いていないのに一覧に残っている: ' + stale.join(', '));
});

test('検査が実際に拾う（normalizeLoadedPlan の本体は見つかる）', () => {
  const keys = handWrittenSequences().map((f) => f.key);
  assert.ok(keys.includes('assets/js/app-state.js:normalizeLoadedPlan'), JSON.stringify(keys));
});
