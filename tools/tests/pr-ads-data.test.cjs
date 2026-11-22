// 広告の素材のデータ(assets/js/pr-ads.js の PR_ADS)が、枠の決まりに合っていること。
//   - 入れた素材が1件も検査(a8.net 以外を受け付けない・大きさ)で落とされていない。
//   - 上端には 728×90・高さ 60px 以下で幅 468 の物・320×50 がそろっている(画面の大きさごとに出せる物がある)。
//   - 自動で動かしているブラウザ(navigator.webdriver)では、本物の素材を出さない(表示回数を検査で増やさない)。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const SRC = readFileSync(join(__dirname, '..', '..', 'assets', 'js', 'pr-ads.js'), 'utf8');
function load(navigator, injected) {
  const root = { navigator };
  if (injected) root.__HP_PR_ADS__ = injected;
  const sandbox = { window: root, self: root, globalThis: root, module: { exports: {} }, URL };
  vm.runInNewContext(`(function(){ ${SRC.replace(/\}\)\((.*?)\);\s*$/s, '})(globalThis);')} })()`, sandbox);
  return sandbox.module.exports;
}
// 書かれている件数(検査で落とされる前)
const written = (slot) => {
  const m = SRC.match(new RegExp(`(?:'${slot}'|${slot}): \\[([\\s\\S]*?)\\n    \\]`));
  return m ? (m[1].match(/href:/g) || []).length : 0;
};

test('入れた素材は1件も検査で落とされず、上端に3つの大きさがそろっている', () => {
  const api = load({});
  for (const slot of api.SLOTS) assert.equal(api.creatives(slot).length, written(slot), slot + ' の素材が検査で落ちている');
  const top = api.creatives('top').map((c) => c.w + 'x' + c.h);
  assert.ok(top.includes('728x90') && top.includes('320x50'), top.join(','));
  assert.ok(api.creatives('top').some((c) => c.w === 468 && c.h <= 60), '高さ 800px 未満の画面に出す 468 幅の物が無い');
  for (const slot of api.SLOTS) for (const c of api.creatives(slot)) {
    assert.equal(new URL(c.href).origin, 'https://px.a8.net');
    assert.match(new URL(c.img).hostname, /^www\d+\.a8\.net$/);
    assert.match(c.px, /^https:\/\/www\d+\.a8\.net\/0\.gif\?a8mat=/);
    assert.equal(new URL(c.href).searchParams.get('a8mat'), new URL(c.px).searchParams.get('a8mat'), 'リンクと計測の組が食い違っている');
    assert.ok(c.name);
  }
});

test('自動で動かしているブラウザでは本物の素材を出さず、検査が差し込んだ素材は出す', () => {
  const auto = load({ webdriver: true });
  for (const slot of auto.SLOTS) assert.equal(auto.creatives(slot).length, 0);
  const one = { href: 'https://px.a8.net/svt/ejp?a8mat=X', img: 'https://www10.a8.net/svt/bgt?aid=1', w: 320, h: 50, px: 'https://www10.a8.net/0.gif?a8mat=X', name: 't' };
  const injected = load({ webdriver: true }, { top: [one], library: [], share: [], export: [] });
  assert.equal(injected.creatives('top').length, 1);
});
