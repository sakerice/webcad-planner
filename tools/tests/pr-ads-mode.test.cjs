// 広告の出し分け(assets/js/pr-ads.js の adsMode)の場合分け。
//   - ふつうに開いた Web の画面は 'web'(A8.net の枠を出す)。ふつうの共同編集のリンク(#room=<id>)も 'web'。
//   - 外の AI(Claude・ChatGPT など)が返したリンク(#room=<id>&via=ai。worker/mcp.mjs の roomUrl)で開いた画面は 'off'。
//     そのルームの id をこのブラウザに覚え、印の無いリンクで開き直しても 'off'。共有の URL にも印を残す。
//   - アプリ版(Capacitor。capacitor://localhost)は 'app'。AI のリンクの印があっても 'app'(AdMob は別に出す)。
//   - 印と、worker/mcp.mjs が返すリンクの印が同じであること。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'assets', 'js', 'pr-ads.js'), 'utf8');
const ROOM = 'AiLinkRoomForAdsTest01';
const OTHER = 'OtherRoomForAdsTest002';
const SITE = 'https://cad-planner.srapps.us/';

function storage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, dump: () => Object.fromEntries(m) };
}
// href の場所で pr-ads.js を読む。store を渡すと、同じブラウザで開き直した場面になる
function load(href, { store = storage(), capacitor = false, noStorage = false, framed = false } = {}) {
  const u = new URL(href);
  const root = { navigator: {}, location: { protocol: u.protocol, hash: u.hash, search: u.search, href } };
  if (!noStorage) root.localStorage = store;
  else Object.defineProperty(root, 'localStorage', { get() { throw new Error('denied'); } });
  if (capacitor) root.Capacitor = { isNativePlatform: () => true };
  root.top = framed ? {} : root;
  const sandbox = { window: root, self: root, globalThis: root, module: { exports: {} }, URL, URLSearchParams };
  vm.runInNewContext(`(function(){ ${SRC.replace(/\}\)\((.*?)\);\s*$/s, '})(globalThis);')} })()`, sandbox);
  return { api: sandbox.module.exports, root, store };
}

test('ふつうに開いた画面は web。ふつうの共同編集のリンクも web', () => {
  for (const href of [SITE, SITE + '?preset=2f', 'http://localhost:8932/',
    SITE + '#room=' + ROOM, SITE + '?room=' + ROOM, SITE + '#room=' + ROOM + '&via=someone', SITE + '#via=AI']) {
    const { api, store } = load(href);
    assert.equal(api.adsMode(), 'web', href);
    assert.equal(api.fromAiLink(), false, href);
    assert.deepEqual(store.dump(), {}, href + ' で覚え書きを書いた');
  }
});

test('外の AI が返したリンクで開いた画面は off。ルームを覚え、印の無いリンクで開き直しても off', () => {
  const first = load(SITE + '#room=' + ROOM + '&via=ai');
  assert.equal(first.api.adsMode(), 'off');
  assert.equal(first.api.fromAiLink(), true);
  assert.deepEqual(JSON.parse(first.store.dump()['webcad-ai-rooms']), [ROOM]);
  // 同じブラウザで、印の無いリンクで開き直す(保存一覧・古いブックマーク)
  assert.equal(load(SITE + '#room=' + ROOM, { store: first.store }).api.adsMode(), 'off');
  assert.equal(load(SITE + '?room=' + ROOM, { store: first.store }).api.adsMode(), 'off');
  // 別のルーム・ルームなしは、同じブラウザでも web のまま(ふつうの画面の広告は減らさない)
  assert.equal(load(SITE + '#room=' + OTHER, { store: first.store }).api.adsMode(), 'web');
  assert.equal(load(SITE, { store: first.store }).api.adsMode(), 'web');
  // ? に印がある形でも同じ
  assert.equal(load(SITE + '?room=' + ROOM + '&via=ai').api.adsMode(), 'off');
});

test('共有の URL に印を残す。ふつうのルームには付けない', () => {
  const { api } = load(SITE + '#room=' + ROOM + '&via=ai');
  api.adsMode();
  assert.equal(api.roomHash(ROOM), 'room=' + ROOM + '&via=ai');
  assert.equal(api.roomHash(OTHER), 'room=' + OTHER);
  assert.equal(load(SITE + '#room=' + ROOM).api.roomHash(ROOM), 'room=' + ROOM);
});

test('一度 AI のリンクの画面だと分かったら、読み直すまで off。覚えているルームへ入ったら off になる', () => {
  const a = load(SITE + '#room=' + ROOM + '&via=ai');
  assert.equal(a.api.adsMode(), 'off');
  a.root.location.hash = ''; // 共同編集を抜けた
  assert.equal(a.api.adsMode(), 'off');
  // ふつうに開いた画面で、保存一覧から AI のリンクのルームを開く
  const b = load(SITE, { store: a.store });
  assert.equal(b.api.adsMode(), 'web');
  b.api.noteRoom(OTHER);
  assert.equal(b.api.adsMode(), 'web', 'ふつうのルームに入っただけで広告が消えた');
  b.api.noteRoom(ROOM);
  assert.equal(b.api.adsMode(), 'off');
});

test('覚え書きが使えない・壊れていても落ちず、印のあるリンクは off', () => {
  assert.equal(load(SITE + '#room=' + ROOM + '&via=ai', { noStorage: true }).api.adsMode(), 'off');
  assert.equal(load(SITE + '#room=' + ROOM, { noStorage: true }).api.adsMode(), 'web');
  for (const bad of ['{', '"x"', '{"a":1}', '[1,null,"short"]']) {
    const { api } = load(SITE + '#room=' + ROOM, { store: storage({ 'webcad-ai-rooms': bad }) });
    assert.equal(api.adsMode(), 'web', bad);
    assert.equal(api.roomHash(ROOM), 'room=' + ROOM, bad);
  }
  // 覚えるルームは 200 件まで(古い物から落とす)
  const many = Array.from({ length: 200 }, (_, i) => ('R' + String(i).padStart(3, '0') + 'x'.repeat(22)).slice(0, 22));
  const full = load(SITE + '#room=' + ROOM + '&via=ai', { store: storage({ 'webcad-ai-rooms': JSON.stringify(many) }) });
  full.api.adsMode();
  const kept = JSON.parse(full.store.dump()['webcad-ai-rooms']);
  assert.equal(kept.length, 200);
  assert.equal(kept[199], ROOM);
  assert.ok(!kept.includes(many[0]));
});

test('アプリ版は app(AI のリンクの印があっても)。ファイルを直に開いた・埋め込まれた画面は off', () => {
  assert.equal(load('capacitor://localhost/').api.adsMode(), 'app');
  assert.equal(load('capacitor://localhost/#room=' + ROOM + '&via=ai').api.adsMode(), 'app');
  assert.equal(load('https://localhost/', { capacitor: true }).api.adsMode(), 'app');
  assert.equal(load('ionic://localhost/').api.adsMode(), 'app');
  assert.equal(load('file:///Users/x/index.html').api.adsMode(), 'off');
  assert.equal(load(SITE, { framed: true }).api.adsMode(), 'off');
});

test('worker/mcp.mjs が返すリンクの印と、画面が読む印が同じ', () => {
  const mcp = readFileSync(join(ROOT, 'worker', 'mcp.mjs'), 'utf8');
  const m = mcp.match(/url\.hash = `room=\$\{roomId\}&([a-z]+)=([a-z]+)`;/);
  assert.ok(m, 'worker/mcp.mjs の roomUrl に印が無い');
  const key = SRC.match(/AI_MARK_KEY = '([a-z]+)', AI_MARK_VAL = '([a-z]+)'/);
  assert.ok(key);
  assert.deepEqual([m[1], m[2]], [key[1], key[2]]);
  assert.ok(!/made\.url/.test(mcp), 'create_plan が印の無い URL(made.url)を返している');
});
