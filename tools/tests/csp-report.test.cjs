// CSP の「報告だけ」の見出し(_headers)と、違反の報告を受ける口 POST /api/csp-report(worker/csp-report.mjs)。
//   - _headers は報告だけ(強制の Content-Security-Policy は枠の決まり frame-ancestors だけ)で、外の読み込み先を絞る決まりを持つ。build.sh が dist へ写す。
//   - 受け口は、決まりと先のオリジンだけをログに出す(ページの URL・道・問い合わせ・コードの抜粋を出さない)。
//   - 16KB を超える本文は読まずに捨てる。1分あたりのログの行数に上限があり、超えた数は次の分に1行で出す。
//   - 振り分け(worker/router.mjs)から届く。POST 以外は 405。いつも 204 で返す。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const HOST = 'https://cad-planner.example.test';

function headersFile() {
  const text = readFileSync(join(ROOT, '_headers'), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  return { text, lines };
}

test('_headers は報告だけの CSP を全部の静的アセットに付け、build.sh が dist へ写す', () => {
  const { lines } = headersFile();
  assert.equal(lines[0], '/*');
  const csp = lines.find((l) => /^\s+Content-Security-Policy-Report-Only:/.test(l));
  assert.ok(csp, '報告だけの見出しが無い');
  // 強制の CSP は、他のサイトの枠に入れさせない frame-ancestors だけ(2026-11-20)。読み込み先を絞る決まりは
  // 報告だけで様子を見ている途中なので、強制の側に混ぜてはいけない。
  const enforced = lines.filter((l) => /^\s+Content-Security-Policy:/.test(l));
  assert.deepEqual(enforced.map((l) => l.trim()), ["Content-Security-Policy: frame-ancestors 'self'"], '強制の CSP に枠の決まり以外を入れてはいけない');
  const policy = csp.replace(/^\s+Content-Security-Policy-Report-Only:\s*/, '');
  const d = Object.fromEntries(policy.split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'self'"]);
  assert.deepEqual(d['form-action'], ["'self'"]);
  assert.deepEqual(d['report-uri'], ['/api/csp-report']);
  // 外のホストは、書体と Cloudflare の計測だけ
  const hosts = Object.values(d).flat().filter((v) => /^https?:\/\//.test(v)).sort();
  assert.deepEqual(hosts, ['https://cloudflareinsights.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://static.cloudflareinsights.com']);
  for (const k of ['script-src', 'connect-src', 'frame-src', 'img-src', 'default-src']) {
    assert.ok(d[k], k + ' が無い');
    assert.ok(!d[k].includes('*') && !d[k].includes('https:') && !d[k].includes('http:'), k + ' がどこでも許している');
  }
  assert.match(readFileSync(join(ROOT, 'build.sh'), 'utf8'), /\ncp _headers dist\/\n/);
});

test('報告から決まりとオリジンだけを取り出し、道・問い合わせ・抜粋・ページの URL を出さない', async () => {
  const { handleCspReport, resetCspReportState } = await mod('worker/csp-report.mjs');
  resetCspReportState();
  const logs = [];
  const body = JSON.stringify({ 'csp-report': {
    'document-uri': 'https://cad-planner.srapps.us/?secret=1#room=AAAAAAAAAAAAAAAAAAAAAA',
    'effective-directive': 'script-src-elem', 'violated-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/path/x.js?token=abc', 'script-sample': 'alert(document.cookie)',
    'source-file': 'https://cad-planner.srapps.us/index.html',
  } });
  const res = await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body }), { now: 1e12, log: (s) => logs.push(s) });
  assert.equal(res.status, 204);
  assert.deepEqual(logs, ['[csp-report] script-src-elem https://evil.example']);
  const all = logs.join('\n');
  for (const secret of ['path', 'token', 'secret', 'room', 'cookie', 'index.html']) assert.ok(!all.includes(secret), secret);
});

test('Reporting API の配列の形と、inline・eval・data の語も読む', async () => {
  const { handleCspReport, resetCspReportState } = await mod('worker/csp-report.mjs');
  resetCspReportState();
  const logs = [];
  const body = JSON.stringify([
    { type: 'csp-violation', body: { effectiveDirective: 'script-src-attr', blockedURL: 'inline' } },
    { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'data' } },
    { type: 'other', body: {} },
    'x', null,
  ]);
  await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'POST', body }), { now: 1e12, log: (s) => logs.push(s) });
  assert.deepEqual(logs, ['[csp-report] script-src-attr inline', '[csp-report] img-src data']);
});

test('大きすぎる本文・壊れた本文は読まずに 204、POST 以外は 405', async () => {
  const { handleCspReport, resetCspReportState, MAX_REPORT_BYTES } = await mod('worker/csp-report.mjs');
  resetCspReportState();
  const logs = [];
  const big = JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://a.example/' + 'x'.repeat(MAX_REPORT_BYTES) } });
  let res = await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'POST', body: big }), { now: 1e12, log: (s) => logs.push(s) });
  assert.equal(res.status, 204);
  res = await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'POST', body: '{not json' }), { now: 1e12, log: (s) => logs.push(s) });
  assert.equal(res.status, 204);
  assert.deepEqual(logs, []);
  res = await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'GET' }), { now: 1e12, log: (s) => logs.push(s) });
  assert.equal(res.status, 405);
});

test('1分あたりのログの行数に上限があり、捨てた数を次の分に1行で出す', async () => {
  const { handleCspReport, resetCspReportState, LOG_PER_MINUTE } = await mod('worker/csp-report.mjs');
  resetCspReportState();
  const logs = [];
  const one = JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://b.example/' } });
  for (let i = 0; i < LOG_PER_MINUTE + 5; i++) {
    await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'POST', body: one }), { now: 60000 * 100, log: (s) => logs.push(s) });
  }
  assert.equal(logs.length, LOG_PER_MINUTE);
  await handleCspReport(new Request(HOST + '/api/csp-report', { method: 'POST', body: one }), { now: 60000 * 101, log: (s) => logs.push(s) });
  assert.equal(logs[LOG_PER_MINUTE], '[csp-report] 上限を超えて捨てた報告 5 件');
  assert.equal(logs.length, LOG_PER_MINUTE + 2);
});

test('振り分けから届く', async () => {
  const router = (await mod('worker/router.mjs')).default;
  const env = { ASSETS: { fetch: async () => new Response('static') } };
  const res = await router.fetch(new Request(HOST + '/api/csp-report', { method: 'POST', body: '[]' }), env);
  assert.equal(res.status, 204);
});
