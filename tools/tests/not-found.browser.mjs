// 無いパスに 404 を返すこと(wrangler.toml の not_found_handling = "404-page" と 404.html)を、本物の Worker で確かめる。
//
// サーバーは local-worker.mjs が立てる `wrangler dev --local`(wrangler.toml の写しを使う)。
//
// 見ること:
//   1. 今までどおり: /・/index.html・/?room=…・/#room=… の画面、/assets/* のファイル、/api/*(部屋を作る・読む、無い API は JSON の 404)。
//   2. 無いパス(/CLAUDE.md・/.git/config・/foo/bar・/assets/無いファイル)は 404 で、短い案内(「ページが見つかりません」と
//      トップへのリンク)だけを返し、アプリの HTML を返さない。
//   3. ブラウザで無いパスを開くと案内が出て、リンクを押すとトップ(アプリ)が開く。共有リンク(/#room=…)で部屋が開く。
//
// sh tools/run_browser_tests.sh not-found
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker, createRoom } from './local-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const T = { timeout: 90000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP_MARK = 'id="app-loading"';

const server = await startLocalWorker();
let browser;
try {
  const O = server.origin;
  const get = async (p, init) => { const r = await fetch(O + p, init); return { status: r.status, type: r.headers.get('content-type') || '', url: r.url, body: await r.text() }; };

  // 1. 今までどおり
  for (const p of ['/', '/index.html', '/?room=AbCdEfGhIjKlMnOpQrStUv', '/?preset=2f']) {
    const r = await get(p);
    assert.equal(r.status, 200, `${p} が ${r.status}`);
    assert.ok(r.body.includes(APP_MARK), `${p} でアプリの HTML が返らない`);
  }
  const js = (await get('/')).body.match(/src="(assets\/js\/[^"?]+\.js)/);
  assert.ok(js, 'index.html から JS の場所が読めない');
  const asset = await get('/' + js[1]);
  assert.equal(asset.status, 200, `/${js[1]} が ${asset.status}`);
  assert.match(asset.type, /javascript/);
  assert.equal((await fetch(O + '/assets/default_plan.json')).status, 200, '既定の間取りが読めない');

  const room = await createRoom(O, PLAN);
  assert.ok(room && room.roomId, '部屋が作れない');
  assert.equal(new URL(room.url).pathname, '/', '共有リンクは / で始まる');
  const roomRes = await get('/api/rooms/' + room.roomId);
  assert.equal(roomRes.status, 200, '部屋が読めない');
  const noApi = await get('/api/no-such-route');
  assert.equal(noApi.status, 404);
  assert.match(noApi.type, /application\/json/, '無い API は今までどおり Worker の JSON で返る');
  assert.equal(JSON.parse(noApi.body).error, 'not_found');

  // 2. 無いパス
  for (const p of ['/CLAUDE.md', '/.git/config', '/foo/bar', '/assets/no-such-file.png', '/wrangler.toml', '/.dev.vars']) {
    const r = await get(p);
    assert.equal(r.status, 404, `${p} が ${r.status}`);
    assert.ok(!r.body.includes(APP_MARK), `${p} でアプリの HTML が返った`);
    assert.ok(r.body.includes('ページが見つかりません'), `${p} の案内が無い`);
    assert.ok(r.body.length < 4000, `${p} の返事が大きい: ${r.body.length}`);
  }

  // 3. ブラウザ
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', (route) => (route.request().url().startsWith(O) ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const res = await page.goto(O + '/foo/bar');
  assert.equal(res.status(), 404);
  await page.getByRole('heading', { name: 'ページが見つかりません' }).waitFor(T);
  await page.getByRole('link', { name: 'トップへ' }).click();
  await page.waitForURL(O + '/', T);
  await page.waitForFunction(() => window.DATA && window.ST, null, T);

  await page.goto('about:blank'); // 同じ / のまま # だけ変えると読み直さないので、一度離れる
  await page.goto(O + '/#room=' + room.roomId);
  await page.waitForFunction((id) => window.SHARED && SHARED.roomId === id && DATA.walls.length > 0, room.roomId, T);
  assert.deepEqual(errors, [], 'ページのエラー');
  console.log('ok not-found: 今までのパスはそのまま、無いパスは 404 と案内');
} finally {
  if (browser) await browser.close();
  await server.stop();
}
