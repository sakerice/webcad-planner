// プライバシーポリシー・利用規約・サポートのページと、ドメインの確認用のファイルが、本物の Worker から配られること(headless)。
//
// サーバーは local-worker.mjs が立てる `wrangler dev --local`(本番と同じ静的アセットの配り方)。
// 運営者の値は見本(tools/tests/fixtures/legal-site.json)に差し替えて配信物を作る(LEGAL_SITE_CONFIG)。
// 終わったら、配信物(dist)のページを本物の設定で作り直し、見本の確認用のファイルを消す。
//
// 見ること:
//   1. /privacy・/terms・/support と /en/… が 200 の HTML で返り、守りの見出し(_headers の /*)が付く。
//      /privacy.html のような拡張子つきの道も、同じページに行き着く。
//   2. /.well-known/openai-apps-challenge と /.well-known/mcp-registry-auth が、値だけを文字として返す。
//   3. 今までどおり: / はアプリ、無い道は 404 の案内。
//   4. ブラウザで: パソコン(1440×900)とスマートフォン(393×852)で横にはみ出さない。外への通信が無い。
//      コンソールにエラー(CSP の違反を含む)が出ない。ページどうし・言語の切り替え・アプリへ戻るリンクが働く。
//   5. アプリのサイドバーのリンクから3つのページが開く。
//
// LEGAL_SHOTS_DIR にフォルダを入れると、そこへ画面の絵を書き出す。
// sh tools/run_browser_tests.sh legal-pages
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker, ROOT } from './local-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'legal-site.json');
const CFG = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const T = { timeout: 60000 };
const SHOTS = process.env.LEGAL_SHOTS_DIR || '';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const PAGES = [
  ['/privacy', 'プライバシーポリシー'], ['/terms', '利用規約'], ['/support', 'サポート'],
  ['/en/privacy', 'Privacy Policy'], ['/en/terms', 'Terms of Use'], ['/en/support', 'Support'],
];
const SIZES = [['pc', 1440, 900], ['phone', 393, 852]];

process.env.LEGAL_SITE_CONFIG = FIXTURE;
const server = await startLocalWorker();
delete process.env.LEGAL_SITE_CONFIG;
let browser;
try {
  const O = server.origin;
  const get = async (p) => { const r = await fetch(O + p); return { status: r.status, type: r.headers.get('content-type') || '', headers: r.headers, url: r.url, body: await r.text() }; };

  // 1. ページ
  for (const [p, title] of PAGES) {
    const r = await get(p);
    assert.equal(r.status, 200, `${p} が ${r.status}`);
    assert.match(r.type, /text\/html/, `${p} の種類が ${r.type}`);
    assert.equal(new URL(r.url).pathname, p, `${p} が別の道へ移った: ${r.url}`);
    assert.ok(r.body.includes(`<h1>${title}</h1>`), `${p} の見出しが無い`);
    assert.ok(r.body.includes('mailto:' + CFG.contactEmail), `${p} に問い合わせ先が無い`);
    assert.ok(!r.body.includes('id="app-loading"'), `${p} でアプリの HTML が返った`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${p} に守りの見出しが付かない`);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    const ext = await get(p + '.html');
    assert.equal(ext.status, 200, `${p}.html が ${ext.status}`);
    assert.ok(ext.body.includes(`<h1>${title}</h1>`), `${p}.html が同じページに行き着かない`);
  }

  // 2. ドメインの確認用のファイル
  for (const [p, value] of [['/.well-known/openai-apps-challenge', CFG.openaiAppsChallenge], ['/.well-known/mcp-registry-auth', CFG.mcpRegistryAuth]]) {
    const r = await get(p);
    assert.equal(r.status, 200, `${p} が ${r.status}`);
    assert.equal(r.body, value, `${p} の中身が値だけでない`);
    assert.match(r.type, /^text\/plain/, `${p} の種類が ${r.type}`);
    assert.equal(new URL(r.url).pathname, p, `${p} が別の道へ移った`);
  }
  assert.equal((await get('/.well-known/no-such-file')).status, 404);

  // 3. 今までどおり
  const top = await get('/');
  assert.equal(top.status, 200);
  assert.ok(top.body.includes('id="app-loading"'), '/ でアプリが返らない');
  const none = await get('/privacy/extra');
  assert.equal(none.status, 404);
  assert.ok(none.body.includes('ページが見つかりません'));
  assert.equal((await get('/legal/site.json')).status, 404, '設定のファイルが配られている');

  // 4. ブラウザで
  browser = await chromium.launch({ headless: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const [label, width, height] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: label === 'phone' ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    const outside = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (q) => { if (new URL(q.url()).origin !== O && !q.url().startsWith('data:')) outside.push(q.url()); });
    for (const [p, title] of PAGES) {
      await page.goto(O + p, { ...T, waitUntil: 'load' });
      assert.equal(await page.locator('h1').innerText(), title);
      assert.equal(await page.locator('.draft').count(), 0, `${p} に下書きの帯が出ている`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${p} が ${label} で横に ${over}px はみ出す`);
      const font = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('article p')).fontSize));
      assert.ok(font >= 14, `${p} の本文の字が小さい(${font}px)`);
      assert.equal(await page.locator('.nav a[aria-current="page"]').count(), 1);
      if (SHOTS) {
        const name = p.replace(/^\//, '').replace(/\//g, '-');
        await page.screenshot({ path: join(SHOTS, `${name}-${label}.png`) });
        await page.screenshot({ path: join(SHOTS, `${name}-${label}-full.png`), fullPage: true });
      }
    }
    // リンク: ページどうし → 言語の切り替え → アプリへ戻る
    await page.goto(O + '/privacy', T);
    await page.locator('.nav a', { hasText: '利用規約' }).click();
    await page.waitForURL(O + '/terms', T);
    await page.locator('.nav a.lang').click();
    await page.waitForURL(O + '/en/terms', T);
    await page.locator('.nav a', { hasText: 'Support' }).click();
    await page.waitForURL(O + '/en/support', T);
    await page.locator('.nav a.lang').click();
    await page.waitForURL(O + '/support', T);
    assert.deepEqual(outside, [], `${label}: 外への通信がある`);
    assert.deepEqual(errors, [], `${label}: コンソールにエラーが出た`);
    await page.locator('.foot a.open').click();
    await page.waitForURL(O + '/', T);
    await page.waitForSelector('#toolbar', T);
    await ctx.close();
  }

  // 5. アプリのサイドバーのリンク
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(O + '/', T);
    await page.waitForSelector('.sidebar-legal a', { ...T, state: 'attached' });
    await page.evaluate(() => { const m = document.getElementById('preset-choice-modal'); if (m) m.classList.remove('show'); });
    const links = await page.locator('.sidebar-legal a').evaluateAll((as) => as.map((a) => [a.textContent, new URL(a.href).pathname]));
    assert.deepEqual(links, [['プライバシーポリシー', '/privacy'], ['利用規約', '/terms'], ['サポート', '/support']]);
    const link = page.locator('.sidebar-legal a').first();
    await link.scrollIntoViewIfNeeded();
    assert.ok(await link.isVisible(), 'サイドバーのリンクが見えない');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'app-sidebar-links-pc.png') });
    const [opened] = await Promise.all([ctx.waitForEvent('page', T), link.click()]);
    await opened.waitForLoadState('load', T);
    assert.equal(new URL(opened.url()).pathname, '/privacy');
    assert.equal(await opened.locator('h1').innerText(), 'プライバシーポリシー');
    await ctx.close();
  }
  console.log('legal-pages: ok');
} finally {
  if (browser) await browser.close();
  await server.stop();
  // 配信物を本物の設定に戻す(見本の値と確認用のファイルを残さない)
  rmSync(join(ROOT, 'dist', '.well-known'), { recursive: true, force: true });
  try { execFileSync(process.execPath, [join(ROOT, 'legal', 'build.cjs'), join(ROOT, 'dist')], { stdio: 'ignore' }); } catch { /* 次のビルドで作り直される */ }
}
