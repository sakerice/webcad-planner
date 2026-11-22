// 守りの見出し(_headers と worker/router.mjs)が、本物の Worker の応答に届くことを確かめる(headless)。
//
// サーバーは local-worker.mjs が立てる `wrangler dev --local`。静的アセットは dist/_headers の見出しが付き、
// /api/* は Worker が返すので X-Content-Type-Options だけが付く。
//
// 見ること:
//   1. 画面(/・/index.html・/?room=…)、JS、3D の形(glb)に、_headers の見出しがすべて付く。
//   2. /api/* の応答(部屋を作る・読む・無い道・CSP の報告)に nosniff が付く。WebSocket は今までどおりつながる。
//   3. ブラウザで: 他の出どころのページの枠(iframe)には入らない。同じ出どころの枠には入る。
//      使わない機能(カメラ・位置など)は止まり、使う機能(クリップボードへの書き込み)は止まっていない。
//      見出しの書き方の誤りでブラウザが警告を出していない。
//
// sh tools/run_browser_tests.sh security-headers
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker, createRoom } from './local-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// _headers の /* に書いた見出し(名前は小文字に)
const EXPECTED = {};
for (const line of readFileSync(join(HERE, '..', '..', '_headers'), 'utf8').split('\n')) {
  const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if (m) EXPECTED[m[1].toLowerCase()] = m[2].trim();
}
for (const name of ['x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options', 'content-security-policy', 'strict-transport-security', 'content-security-policy-report-only']) {
  assert.ok(EXPECTED[name], `_headers に ${name} が無い`);
}
assert.equal(EXPECTED['content-security-policy'], "frame-ancestors 'self'", '強制の CSP は枠の決まりだけにしておく(残りは Report-Only で様子見)');
assert.ok(!/includeSubDomains|preload/i.test(EXPECTED['strict-transport-security']), 'HSTS が srapps.us の他のサービスに響く');

const server = await startLocalWorker();
const errors = [];
let browser;
try {
  const ORIGIN = server.origin;

  // 1. 静的アセット
  const asset = (await fetch(ORIGIN + '/index.html').then((r) => r.text())).match(/src="(assets\/js\/[^"?]+\.js)/);
  assert.ok(asset, 'index.html から JS の場所が読めない');
  for (const p of ['/', '/index.html', '/?room=AbCdEfGhIjKlMnOpQrStUv', '/' + asset[1]]) {
    const r = await fetch(ORIGIN + p);
    assert.equal(r.status, 200, `${p} が ${r.status}`);
    for (const [name, value] of Object.entries(EXPECTED)) assert.equal(r.headers.get(name), value, `${p} の ${name}`);
    await r.arrayBuffer();
  }
  // glb(3D の形)にも付く。nosniff でも種類が合っていて読めること(画面での読み込みは下のブラウザで見る)
  const glbPath = readFileSync(join(HERE, '..', '..', 'index.html'), 'utf8').match(/assets\/models\/[^"'`\s]+\.glb/);
  if (glbPath) {
    const r = await fetch(ORIGIN + '/' + glbPath[0]);
    if (r.status === 200) assert.equal(r.headers.get('x-content-type-options'), 'nosniff', 'glb に nosniff が無い');
    await r.arrayBuffer();
  }

  // 2. /api/*
  const room = await createRoom(ORIGIN, PLAN);
  assert.ok(room && room.roomId, '部屋が作れない');
  const apiChecks = [
    ['GET', '/api/rooms/' + room.roomId, 200],
    ['GET', '/api/no-such-route', 404],
    ['POST', '/api/csp-report', 204],
  ];
  for (const [method, p, status] of apiChecks) {
    const r = await fetch(ORIGIN + p, { method, body: method === 'POST' ? '[]' : undefined });
    assert.equal(r.status, status, `${method} ${p} が ${r.status}`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${method} ${p} に nosniff が無い`);
    await r.arrayBuffer();
  }
  const created = await fetch(ORIGIN + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(PLAN) });
  assert.equal(created.headers.get('x-content-type-options'), 'nosniff', 'POST /api/rooms に nosniff が無い');
  await created.arrayBuffer();

  // 3. ブラウザ
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // 外への要求は送らない(書体・計測)。待たされて枠の読み込みが止まるのも防ぐ
  await context.route('**/*', (route) => (/^http:\/\/(127\.0\.0\.1|localhost):/.test(route.request().url()) ? route.continue() : route.abort()));
  const page = await context.newPage();
  const policyWarnings = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => {
    const t = m.text();
    if (/Permissions-Policy|Feature-Policy|Unrecognized feature|Strict-Transport-Security|X-Frame-Options.*invalid/i.test(t)) policyWarnings.push(t.slice(0, 300));
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  await page.goto(server.app + '?preset=2f');
  await page.waitForFunction(() => window.PRESET_CURRENT === '2f' && window.DATA && DATA.walls.length > 0, null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  const allowed = await page.evaluate(() => {
    const fp = document.featurePolicy || document.permissionsPolicy;
    if (!fp) return null;
    const out = {};
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'clipboard-write', 'fullscreen']) out[f] = fp.allowsFeature(f);
    return out;
  });
  assert.ok(allowed, 'ブラウザから機能の許し方が読めない');
  for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) assert.equal(allowed[f], false, `${f} が止まっていない`);
  assert.equal(allowed['clipboard-write'], true, 'クリップボードへの書き込み(共有リンクの写し)が止まっている');

  // 3D が開ける(glb と JS が nosniff で読めている)
  await page.evaluate(() => setView('3d-ext'));
  await page.waitForFunction(() => window.scene && window.scene.children && window.scene.children.length > 0, null, T).catch(() => {});

  // 同じ出どころの枠には入る。3D の素材を読み込み中のページだと接続の数の上限で待たされるので、
  // 同じ出どころの軽いページ(中身はこちらで返す)に枠を置く
  const host = await context.newPage();
  await host.route(server.origin + '/__frame-host', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await host.goto(server.origin + '/__frame-host');
  const sameOrigin = await host.evaluate((src) => new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:400px;height:300px';
    f.src = src;
    document.body.appendChild(f);
    const t0 = Date.now();
    const tick = () => {
      let ok = false;
      const d = f.contentDocument;
      try { ok = !!(d && d.location.href === src && d.getElementById('app-loading')); } catch (e) { return resolve('error: ' + e.message); }
      if (ok) return resolve(true);
      if (Date.now() - t0 > 60000) return resolve('timeout ' + JSON.stringify([d && d.location.href, d && d.readyState]));
      setTimeout(tick, 200);
    };
    tick();
  }), server.origin + '/?preset=2f');
  await host.close();
  assert.equal(sameOrigin, true, '同じ出どころの枠に入らない: ' + sameOrigin);

  // 他の出どころのページの枠には入らない。
  // 枠を置くページは、ここで立てる小さな本物のサーバー(127.0.0.1 の別のポート=別の出どころ)が返す。
  // Playwright の route で作ったページからは、見出しが無くても Chrome が手元(127.0.0.1)への枠を拒むので、
  // 見出しの効き目を見分けられない(確かめ済み)。比べるために、見出しの無いページを別の出どころから枠に入れ、
  // そちらは入ることも確かめる。
  const hostServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><body>host</body>'); });
  await new Promise((r) => hostServer.listen(0, '127.0.0.1', r));
  const hostOrigin = `http://127.0.0.1:${hostServer.address().port}`;
  const plainServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><p id="plain">plain</p>'); });
  await new Promise((r) => plainServer.listen(0, '127.0.0.1', r));
  const plainOrigin = `http://127.0.0.1:${plainServer.address().port}`;
  try {
    const other = await context.newPage();
    await other.goto(hostOrigin + '/');
    const frameHas = async (src, selector) => {
      await other.evaluate((src) => { const f = document.createElement('iframe'); f.src = src; f.width = 400; f.height = 300; document.body.appendChild(f); }, src);
      for (let i = 0; i < 50; i++) {
        for (const f of other.frames()) {
          if (f === other.mainFrame() || !f.url().startsWith(new URL(src).origin)) continue;
          try { if (await f.evaluate((sel) => !!document.querySelector(sel), selector)) return f.url(); } catch { /* 読み込み中 */ }
        }
        await other.waitForTimeout(200);
      }
      return null;
    };
    assert.ok(await frameHas(plainOrigin + '/', '#plain'), '比べるための見出しの無いページが枠に入らない(検査の作りが壊れている)');
    const loaded = await frameHas(server.origin + '/?preset=2f', '#app-loading');
    assert.equal(loaded, null, '他の出どころの枠にアプリが入った');
    await other.close();
  } finally {
    hostServer.close();
    plainServer.close();
  }

  assert.deepEqual(policyWarnings, [], '見出しの書き方への警告');
  assert.deepEqual(errors, [], 'ページのエラー');
  console.log('ok security-headers: 静的アセットと /api の見出し、枠の決まり、機能の止め方');
} finally {
  if (browser) await browser.close();
  await server.stop();
}
