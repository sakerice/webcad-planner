// CSP の「報告だけ」(_headers の Content-Security-Policy-Report-Only)を付けた画面で、主要な操作をしても
// 違反が出ないことを確かめる(headless)。
//
// 検査用の静的サーバは見出しを付けないので、HTML の返事に _headers の決まりをそのまま足す(本番では
// Workers の静的アセットが付ける)。違反は securitypolicyviolation の出来事・コンソール・/api/csp-report への
// 報告のどれかに出るので、3つとも見る。
// 操作: 起動(既定プラン)・外観3D・内観3D・共有のダイアログと部屋への参加(本物の WebSocket で同じオリジンへ)・
//       チャットを開く・図面と印刷の枠・間取り図の読み取りの画面・画像の書き出し(blob:)。
// 外への要求は送らない(書体と計測は止める。止めても CSP の判定は先に行われる)。
//
// sh tools/run_browser_tests.sh csp-report-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const ORIGIN = new URL(APP).origin;
const T = { timeout: 90000 };
const ROOM = 'CspReportOnlyRoom00001';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// _headers の /* に書いた見出しを読む
const headerLines = readFileSync(join(HERE, '..', '..', '_headers'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
const POLICY = headerLines.find((l) => /^\s+Content-Security-Policy-Report-Only:/.test(l)).replace(/^\s+Content-Security-Policy-Report-Only:\s*/, '').trim();
assert.ok(POLICY.includes('report-uri'), '決まりが読めない');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const violations = [];
const reports = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
page.on('console', (m) => { if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push('console: ' + m.text().slice(0, 300)); });
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await context.route('**/*', async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.origin !== ORIGIN) return route.abort();
  if (u.pathname === '/api/csp-report') { reports.push(req.postData() || ''); return route.fulfill({ status: 204, body: '' }); }
  if (u.pathname === '/api/rooms/' + ROOM) {
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8') });
  }
  if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  if (req.resourceType() === 'document') {
    const res = await route.fetch();
    const headers = { ...res.headers(), 'content-security-policy-report-only': POLICY };
    return route.fulfill({ response: res, headers });
  }
  return route.continue();
});
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile || ''}:${e.lineNumber || ''} ${e.disposition}`);
  });
});

const steps = [];
const stepReports = [];
async function step(name, fn) {
  try { await fn(); } catch (e) { errors.push(name + ': ' + String(e && e.message || e).slice(0, 200)); }
  await page.waitForTimeout(400);
  steps.push(name);
  // どの操作で出たかを分かるように、操作ごとの報告の数を残す
  stepReports.push(`${name}: ${reports.length}`);
}

await step('起動(既定プラン)', async () => {
  const res = await page.goto(APP + '?preset=2f');
  assert.ok(res.headers()['content-security-policy-report-only'], '見出しが付いていない');
  await page.waitForFunction(() => window.PRESET_CURRENT === '2f' && window.DATA && window.DATA.walls.length > 0, null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
});
await step('外観3D', async () => {
  await page.evaluate(() => setView('3d-ext'));
  await page.waitForFunction(() => window.THREE && window.ren, null, T);
  await page.waitForTimeout(3000);
});
await step('内観3D', async () => { await page.evaluate(() => setView('3d-int')); await page.waitForTimeout(2000); });
await step('平面図に戻す', async () => { await page.evaluate(() => setView('2d')); });
await step('共有のダイアログ', async () => { await page.evaluate(() => { openShareDialog(); renderSharedUi(); }); });
await step('チャットを開く', async () => { await page.evaluate(() => openChat()); await page.waitForTimeout(500); await page.evaluate(() => closeChat()); });
await step('図面と印刷の枠', async () => {
  await page.evaluate(() => { openJisDrawingDialog(); jisPrint(); });
  await page.waitForTimeout(1500);
});
await step('図面の画像(blob:)', async () => {
  await page.evaluate(() => jisDownloadPng());
  await page.waitForTimeout(800);
});
await step('間取り図の読み取りの画面', async () => { await page.evaluate(() => openPlanImport()); await page.waitForTimeout(800); });
await step('共有の部屋に入る(同じオリジンの WebSocket)', async () => {
  await page.goto(APP + '#room=' + ROOM);
  await page.waitForFunction(() => window.SHARED && SHARED.roomId, null, T);
  await page.waitForTimeout(1500);
});

const inPage = await page.evaluate(() => window.__csp.slice());
await browser.close();

// 報告は、決まり・先・出どころ・抜粋だけを出す(決まりの全文は長いので出さない)
const brief = (r) => {
  try {
    const x = JSON.parse(r)['csp-report'];
    return `report: ${x['effective-directive']} ${x['blocked-uri']} doc=${x['document-uri']} ${x['source-file'] || ''}:${x['line-number'] || ''}:${x['column-number'] || ''} ${x['script-sample'] || ''}`;
  } catch (e) { return 'report: ' + r.slice(0, 200); }
};
const all = inPage.map((v) => 'event: ' + v).concat(violations, reports.map(brief));
console.log('操作: ' + steps.join(' / '));
if (errors.length) console.log('ページの例外(違反とは別。参考): ' + errors.slice(0, 5).join(' | '));
if (all.length) {
  console.error('報告だけの CSP の違反 ' + all.length + ' 件(操作ごとの報告の累計: ' + stepReports.join(' / ') + '):\n' + all.slice(0, 40).join('\n'));
  assert.fail('CSP の違反が出た');
}
console.log('csp-report-only: 違反 0 件');
