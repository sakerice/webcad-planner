// AIに出させる「もの」の仕様が、アプリの実物とずれていないか。
//
// なぜ在るのか
// ------------
// AIへ渡す種類と既定寸法(浴槽1600×1600など)は worker/plan-item-spec.mjs に
// 書いてあるが、**正はアプリ側の ISIZES**。書き写したものは黙って古くなる。
// ずれると、AIには正しいつもりの寸法を教えて、アプリは別の大きさで描く。
// 図面どおりに読めているのに家が合わない、という一番たちの悪い形になる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const mod = (p) => import(require('node:url').pathToFileURL(join(ROOT, p)).href);

// アプリの定数から ISIZES と名前の表を取り出す。
function appTables() {
  const src = readFileSync(join(ROOT, 'assets', 'js', 'app-constants.js'), 'utf8');
  const grab = (name) => {
    const at = src.search(new RegExp('var\\s+' + name + '\\s*='));
    assert.ok(at >= 0, name + ' がアプリの定数に無い(前提が変わった)');
    let i = src.indexOf('{', at), depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
    }
    return vm.runInNewContext('(' + src.slice(i, end) + ')');
  };
  return { ISIZES: grab('ISIZES') };
}

test('AIに教える種類は、すべてアプリが実際に置ける種類', async () => {
  const { ITEM_SPEC } = await mod('worker/plan-item-spec.mjs');
  const { ISIZES } = appTables();
  for (const s of ITEM_SPEC) {
    assert.ok(ISIZES[s.type],
      `"${s.type}" はアプリの既定寸法の表に無い。AIに出させても置けない`);
  }
});

test('AIに教える既定寸法は、アプリの既定寸法と同じ', async () => {
  const { ITEM_SPEC } = await mod('worker/plan-item-spec.mjs');
  const { ISIZES } = appTables();
  for (const s of ITEM_SPEC) {
    assert.deepEqual({ w: s.w, d: s.d }, { w: ISIZES[s.type].w, d: ISIZES[s.type].d },
      `"${s.type}"(${s.ja}) の既定寸法がアプリとずれている。` +
      `アプリ ${ISIZES[s.type].w}×${ISIZES[s.type].d} / 仕様 ${s.w}×${s.d}`);
  }
});

test('動かせる家具はAIに出させない', async () => {
  const { ALLOWED_ITEM_TYPES } = await mod('worker/plan-item-spec.mjs');
  // 図面の家具記号は「その広さに入る例」で、実際に置く物ではない。
  // 読ませると量が増えて高くなり、肝心の壁の精度が落ちる。
  for (const t of ['bed-d', 'bed-s', 'sofa', 'dining-table', 'tv', 'desk', 'closet']) {
    assert.ok(!ALLOWED_ITEM_TYPES.includes(t), `家具 "${t}" を読ませようとしている`);
  }
});

test('アプリが作る層はAIに出させない', async () => {
  const { ALLOWED_ITEM_TYPES } = await mod('worker/plan-item-spec.mjs');
  // 基礎・屋根は壁から一意に決まる(assets/js/plan-structure.js)。
  // 敷地は平面図に描かれていない。
  for (const t of ['foundation', 'roof', 'site-rect']) {
    assert.ok(!ALLOWED_ITEM_TYPES.includes(t), `"${t}" はアプリが作る。AIに出させない`);
  }
});

test('種類の表は手で書かず、仕様から作る', async () => {
  const { itemTypeTable, ITEM_SPEC } = await mod('worker/plan-item-spec.mjs');
  const table = itemTypeTable();
  for (const s of ITEM_SPEC) {
    assert.match(table, new RegExp(s.type.replace(/-/g, '\\-')), `${s.type} が表に無い`);
    assert.ok(table.includes(`${s.w}×${s.d}mm`), `${s.type} の既定寸法が表に無い`);
  }
});
