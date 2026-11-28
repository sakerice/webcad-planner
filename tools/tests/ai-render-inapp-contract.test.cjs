// AIレンダーの画面(assets/js/ai-render-inapp.js)と Worker(worker/routes-render.mjs まわり)の取り決めが食い違っていないこと。
//
// 画面が送る preset は index.html の AI_IMAGE_PRESETS の id、縦横比は ai-render-inapp.js の ASPECTS。
// Worker はどちらも決まった一覧にないと 400 で断る。片方だけ足すと、押しても必ず失敗する画面になる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const html = require('./app-source.cjs').appSource();
const inapp = readFileSync(join(ROOT, 'assets/js/ai-render-inapp.js'), 'utf8');

function appPresetIds() {
  const at = html.indexOf('\nvar AI_IMAGE_PRESETS=[');
  assert.notEqual(at, -1, 'AI_IMAGE_PRESETS が index.html に無い');
  const end = html.indexOf('\n];', at);
  return [...html.slice(at, end).matchAll(/\bid:'([^']+)'/g)].map((m) => m[1]);
}
function appAspects() {
  const m = inapp.match(/var ASPECTS = \[([^\]]*)\]/);
  assert.ok(m, 'ai-render-inapp.js に ASPECTS が無い');
  return [...m[1].matchAll(/'([0-9]+:[0-9]+)'/g)].map((x) => x[1]);
}

test('画面の表現(preset)は、どれも Worker が受ける', async () => {
  const { RENDER_PRESET_IDS } = await import(pathToFileURL(join(ROOT, 'worker/render-prompt.mjs')).href);
  const ids = appPresetIds();
  assert.ok(ids.length >= 1);
  assert.deepEqual(ids.filter((id) => !RENDER_PRESET_IDS.includes(id)), [], 'Worker が知らない preset');
  assert.deepEqual([...RENDER_PRESET_IDS].sort(), [...ids].sort(), '画面と Worker の preset の顔ぶれが違う');
});

test('画面が選ぶ縦横比は、どれも Worker が受ける', async () => {
  const { RENDER_ASPECTS } = await import(pathToFileURL(join(ROOT, 'worker/vertex-render.mjs')).href);
  const aspects = appAspects();
  assert.ok(aspects.length >= 5);
  assert.deepEqual(aspects.filter((a) => !RENDER_ASPECTS.includes(a)), [], 'Worker が受けない縦横比');
});

test('送る絵の大きさの上限が Worker と同じ', async () => {
  const { MAX_RENDER_IMAGE_CHARS } = await import(pathToFileURL(join(ROOT, 'worker/routes-render.mjs')).href);
  const m = inapp.match(/var MAX_RENDER_IMAGE_CHARS = ([0-9* ]+);/);
  assert.ok(m);
  assert.equal(Function('return ' + m[1])(), MAX_RENDER_IMAGE_CHARS);
});

test('画面が送る絵の欄(base・depth・edge と任意の normal)を、Worker が受ける', async () => {
  const { IMAGE_KEYS, IMAGE_KEYS_WITH_NORMAL } = await import(pathToFileURL(join(ROOT, 'worker/routes-render.mjs')).href);
  const m = inapp.match(/var images = \{([^}]*)\};/);
  assert.ok(m, 'ai-render-inapp.js に送る絵の組み立て(var images = {...})が無い');
  const required = [...m[1].matchAll(/\b([a-z]+):/g)].map((x) => x[1]).sort();
  assert.deepEqual(required, [...IMAGE_KEYS].sort(), '必ず送る絵の欄が Worker と違う');
  const optional = [...inapp.matchAll(/\bimages\.([a-z]+) = /g)].map((x) => x[1]);
  assert.deepEqual(optional, ['normal'], '任意で足す絵の欄');
  assert.deepEqual([...IMAGE_KEYS_WITH_NORMAL].sort(), [...required, ...optional].sort(), '法線ありの欄が Worker と違う');
});

test('結果の絵の長押しメニュー(-webkit-touch-callout)を消していない(iPhone で長押しから「写真に追加」できるように)', () => {
  const css = readFileSync(join(ROOT, 'assets/app.css'), 'utf8');
  for (const [name, src] of [['assets/app.css', css], ['index.html', html], ['ai-render-inapp.js', inapp]]) {
    assert.doesNotMatch(src, /touch-callout\s*:\s*none/i, name + ' で長押しメニューを消している');
  }
  assert.match(html, /<img id="ai-render-result-img"/, '結果の絵が <img> でない');
});
