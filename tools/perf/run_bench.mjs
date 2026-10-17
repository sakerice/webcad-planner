// 性能の基準を Mac で測り、docs/perf/ に残す。
//
//   APP_URL=http://localhost:8791/ PLAYWRIGHT_MODULE=... node tools/perf/run_bench.mjs [ラベル]
//
// 中身は assets/js/perf-bench.js（?bench=1）。iPad では同じ URL を Safari で開けば、
// 同じ手順が流れて結果が画面に出る。
//
// 画面のあるブラウザで測る（headless だと GPU が使われず、数字が実機とかけ離れる）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = process.env.APP_URL || 'http://localhost:8932/';
const LABEL = process.argv[2] || 'mac';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const browser = await chromium.launch({ headless: false, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
const results = [];
try {
  for (const preset of ['2f', '3f']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on('dialog', (d) => d.accept());
    await page.goto(APP + '?preset=' + preset + '&bench=1');
    await page.waitForFunction(() => window.__benchResult, null, { timeout: 600000 });
    const r = await page.evaluate(() => window.__benchResult);
    if (r.error) throw new Error(preset + ': ' + r.error);
    results.push(r);
    console.log('\n' + preset);
    for (const c of r.cases) console.log(`  ${c.name.padEnd(14)} 入るまで ${String(c.enterMs ?? '').padStart(6)}ms  ${String(c.fps).padStart(5)}fps  1コマ ${c.renderMedianMs}ms (遅い方 ${c.renderP95Ms}ms)  三角形 ${c.triangles}`);
    await page.close();
  }
} finally {
  await browser.close();
}
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const out = join(ROOT, 'docs', 'perf', `${day}-${LABEL}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 1) + '\n');
console.log('\n書き出した:', out);
