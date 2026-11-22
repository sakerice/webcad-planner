// AI の受付を上限で断ったときの文が、チャットと間取り図の読み取りの両方に出ること（375×667 で切れないこと）。
//
// AI は呼ばない。Worker の返事を差し替える（worker/ai-budget.mjs が返す形と同じ）。
//   - 1日の上限: 「本日ぶんの AI は受付を終えました。（明日の）朝9時から再開します。画面の操作では引き続き作れます。」
//   - 月の上限: 「今月ぶんの AI の受付を終えました。来月1日から再開します。画面の操作では引き続き作れます。」
//   - 数えられない: 「いま AI が混み合っています。少し待ってから、もう一度お試しください。」
// 画面の写真は SHOT_DIR（無ければ撮らない）へ置く。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// APP_URL が無ければ、静的サーバを立てずに、ブラウザの通信を差し替えてこの作業場所のファイルを返す。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = 'http://app.localhost/';
const APP = process.env.APP_URL || LOCAL;
const SHOT_DIR = process.env.SHOT_DIR || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wasm': 'application/wasm' };
async function serveLocal(context) {
  if (APP !== LOCAL) return;
  await context.route(LOCAL + '**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(ROOT)) return route.fulfill({ status: 403, body: '' });
    try {
      route.fulfill({ status: 200, body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' });
    } catch (e) {
      route.fulfill({ status: 404, body: '' });
    }
  });
}

const DAY = /^本日ぶんの AI は受付を終えました。(明日の)?朝9時から再開します。画面の操作では引き続き作れます。$/;
const MONTH = '今月ぶんの AI の受付を終えました。来月1日から再開します。画面の操作では引き続き作れます。';
const BUSY = 'いま AI が混み合っています。少し待ってから、もう一度お試しください。';
const DAY_TEXT = '本日ぶんの AI は受付を終えました。明日の朝9時から再開します。画面の操作では引き続き作れます。';

// 文が切れていないか（横にはみ出していない・画面の外に出ていない・省略されていない）。
const fits = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, why: 'ない' };
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const problems = [];
  if (b.width < 1 || b.height < 1) problems.push('見えない');
  if (b.left < -0.5 || b.right > innerWidth + 0.5) problems.push(`横にはみ出す ${b.left}〜${b.right} / ${innerWidth}`);
  if (el.scrollWidth > el.clientWidth + 1) problems.push(`横に切れる ${el.scrollWidth} > ${el.clientWidth}`);
  if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) problems.push('省略されている');
  if (cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 1) problems.push('縦に切れる');
  return { ok: problems.length === 0, why: problems.join(' / '), text: el.textContent };
}, selector);

const browser = await chromium.launch();
try {
  // ── チャット ─────────────────────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await serveLocal(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.addInitScript(() => {
      window.__replies = [];
      const real = window.fetch.bind(window);
      window.fetch = (url, init) => {
        if (!String(url).includes('/api/ai/chat')) return real(url, init);
        const r = window.__replies.shift();
        return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } }));
      };
    });
    await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
    await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, { timeout: 60000 });
    await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
    await page.locator('#chat-fab').click();
    await page.waitForSelector('#chat-panel:not([hidden])', { timeout: 5000 });
    const cases = [
      ['day', { status: 429, body: { error: 'quota_exceeded', code: 'quota_exceeded', message: DAY_TEXT, scope: 'day' } }, DAY],
      ['month', { status: 429, body: { error: 'month_exceeded', code: 'month_exceeded', message: MONTH } }, MONTH],
      ['busy', { status: 503, body: { error: 'quota_unavailable', code: 'quota_unavailable', message: BUSY } }, BUSY],
    ];
    for (const [name, reply, want] of cases) {
      await page.evaluate((r) => { window.__replies.push(r); }, reply);
      await page.locator('#chat-input').fill('ベッドを置いて');
      await page.locator('#chat-send').click();
      await page.waitForFunction(() => window.ChatUI && !ChatUI.state().busy, null, { timeout: 15000 });
      const sel = '#chat-log .chat-entry:last-child .chat-ai';
      const got = await fits(page, sel);
      const text = (got.text || '').trim();
      if (want instanceof RegExp) assert.match(text, want, `チャット（${name}）の文: ${text}`);
      else assert.ok(text.includes(want), `チャット（${name}）の文: ${text}`);
      assert.ok(got.ok, `チャット（${name}）の文が切れている: ${got.why}`);
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/chat-limit-${name}.png` });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── 間取り図の読み取り ─────────────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await serveLocal(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.addInitScript((month) => {
      window.__quota = { left: 0, counted: true, perUser: 2, total: 11, limit: 'month', message: month };
      window.__read = [];
      const real = window.fetch.bind(window);
      window.fetch = (url, init) => {
        const u = String(url);
        if (u.includes('/api/ai/quota')) return Promise.resolve(new Response(JSON.stringify(window.__quota)));
        if (u.includes('/api/ai/')) {
          const r = window.__read.shift() || { status: 404, body: {} };
          return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } }));
        }
        return real(url, init);
      };
    }, MONTH);
    await page.goto(APP);
    await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
    await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
    await page.locator('#preset-choice-modal .preset-blank-btn', { hasText: '間取り図の画像から下書きを作る' }).click();
    await page.waitForSelector('#plan-import-modal.show', { timeout: 5000 });

    // 開いた時点で、今月の枠が尽きていることが出る（押す前に分かる）。
    await page.waitForFunction(() => document.getElementById('plan-import-quota').style.display !== 'none', null, { timeout: 5000 });
    const q = await fits(page, '#plan-import-quota');
    assert.equal((q.text || '').trim(), MONTH);
    assert.ok(q.ok, `読み取り（今月の枠）の文が切れている: ${q.why}`);
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/import-limit-month.png` });

    // 本日ぶん・数えられない: 押してから断られる。
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300);
      g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(40, 40, 200, 160);
      return c.toDataURL('image/png').split(',')[1];
    });
    const cases = [
      ['day', { status: 429, body: { error: 'ai_quota_exceeded', limit: 'day', scope: 'day', message: DAY_TEXT } }, DAY],
      ['busy', { status: 503, body: { error: 'ai_quota_unavailable', message: BUSY } }, BUSY],
    ];
    for (const [name, reply, want] of cases) {
      await page.evaluate((r) => {
        window.__quota = { left: null, counted: false, perUser: 2, total: 11 };
        window.__read.push(r);
      }, reply);
      await page.evaluate(() => { if (typeof resetPlanImport === 'function') resetPlanImport(); });
      await page.locator('#plan-import-file').setInputFiles({ name: 'madori.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.waitForSelector('#plan-import-step2', { state: 'visible', timeout: 5000 });
      await page.waitForFunction(() => !document.getElementById('plan-import-run').disabled, null, { timeout: 5000 });
      await page.locator('#plan-import-run').click();
      await page.waitForFunction((n) => {
        const t = document.getElementById('plan-import-status').textContent;
        return n === 'day' ? /受付を終えました/.test(t) : /混み合って/.test(t);
      }, name, { timeout: 10000 });
      const got = await fits(page, '#plan-import-status');
      const text = (got.text || '').trim();
      if (want instanceof RegExp) assert.match(text, want, `読み取り（${name}）の文: ${text}`);
      else assert.equal(text, want);
      assert.ok(got.ok, `読み取り（${name}）の文が切れている: ${got.why}`);
      await page.locator('#plan-import-status').scrollIntoViewIfNeeded();
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/import-limit-${name}.png` });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('ok ai-limit-messages');
} finally {
  await browser.close();
}
