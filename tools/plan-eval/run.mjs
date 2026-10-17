// 実際のアプリの画面で図面を読ませ、取り込んだ間取りを正解と比べる（計画の 0-3）。
//
// なぜ画面を通すのか
// ------------------
// 本番の読み取りは Worker だけでは完結しない。紙面のどこに図面があるかを探して
// 切り出す・読み取る・描き直した絵で見直させる・設備を選ぶ・アプリの形に直す、
// のうち半分はブラウザ側の仕事である。Worker を直接叩いて測ると、利用者が実際に
// 受け取る下書きとは別のものを採点することになる。
//
// 使い方（ふつうは tools/plan-eval/measure.sh から呼ぶ）
//   APP_URL=http://localhost:8787/ node tools/plan-eval/run.mjs madori-3f <名前> [--provider openai --model gpt-6-astra]
//
// 出力: tools/plan-eval/out/<図面>/<名前>.json（取り込んだ間取り・使用量・時間）と
//       同じ名前の .txt（点数の内訳）。out/ はコミットしない。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { scorePlan, formatReport } = require('./score.cjs');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const [fixtureName, label] = args.filter((a, i) => !a.startsWith('--') && !String(args[i - 1] || '').startsWith('--'));
if (!fixtureName || !label) {
  console.error('使い方: node tools/plan-eval/run.mjs <図面の名前> <この測定の名前> [--provider p --model m]');
  process.exit(1);
}
const provider = opt('provider', 'openai');
const model = opt('model', '');
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures.json'), 'utf8'))[fixtureName];
const truth = JSON.parse(readFileSync(join(ROOT, fixture.truth), 'utf8'));

// 1回あたりの費用の目安（米ドル / 100万トークン）。請求額が出たらそちらを正とする。
//   Claude: 公式の料金表（2026-10 時点）。使い回しの書き込みは入力の1.25倍、読み出しは model ごと。
//   OpenAI: tools/probe_openai.cjs と同じ値（公式の表では確かめていない）。
const RATES = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'gpt-6-astra': { in: 10, out: 50 },
};
const JPY_PER_USD = Number(opt('jpy', 150));

function costJpy(m, u) {
  const r = RATES[m];
  if (!r || !u) return null;
  const write = Number(u.cacheWriteTokens || 0), read = Number(u.cacheReadTokens || 0);
  const plain = Number(u.inputTokens || 0) - write - read;
  const usd = (plain * r.in + write * r.in * 1.25 + read * (r.cacheRead ?? r.in) + Number(u.outputTokens || 0) * r.out) / 1e6;
  return Math.round(usd * JPY_PER_USD * 10) / 10;
}

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
// 画面の無いブラウザで回す。画面のある Chrome は利用者の操作を奪う。
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const calls = [];
let result = null;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', (d) => d.accept());   // 取り込みの確認（いまの間取りを外す）に「はい」
  const started = new Map();
  // 送った入力と、ページごとの答えを残す。エージェントに同じ入力を渡したり、
  // 見直しの前後を AI を呼ばずに採点し直したりするため（--inputs / --pages）。
  const capture = { boxes: [], images: null, hint: '', pagesRead: null, pagesRevised: null };
  const findIndex = new Map();
  page.on('request', (req) => {
    const p = new URL(req.url()).pathname;
    if (!p.startsWith('/api/ai/')) return;
    started.set(req, Date.now());
    if (p.endsWith('/find-plan')) findIndex.set(req, findIndex.size);
    if (p.endsWith('/import-plan')) {
      try { const b = JSON.parse(req.postData() || '{}'); capture.images = b.images || [b.image]; capture.hint = b.hint || ''; } catch (e) { /* 残せなくても測定は続ける */ }
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (!started.has(req)) return;
    const path = new URL(req.url()).pathname;
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (path.endsWith('/find-plan') && findIndex.has(req)) capture.boxes[findIndex.get(req)] = body ? body.box : null;
    if (body && Array.isArray(body.pages) && body.plan) {
      if (body.revised) capture.pagesRevised = body.pages; else capture.pagesRead = body.pages;
    }
    calls.push({
      path, status: res.status(), ms: Date.now() - started.get(req),
      usage: body && body.usage || null, pending: Boolean(body && body.pending),
      hasPlan: Boolean(body && body.plan), error: body && body.error || null, message: body && body.message || null,
    });
  });

  // 空回し（--fake）: AI を呼ばず、正解をそのまま「読み取り結果」として返す。
  // 費用をかけずに、画面の操作・取り込み・採点までの配線を確かめるため。満点に近くなるはず。
  if (args.includes('--fake')) await fakeAi(page, truth);
  // 再生（--pages <ページごとの答え.json>）: AI を呼ばず、残しておいた答え（またはエージェントの
  // 答え）を Worker と同じ処理で間取りに組み立てて返す。図面の切り出し位置は --inputs の
  // 測定で残したものを使い、同じ画像から読んだことにする。
  if (opt('pages')) await replayAi(page, readPages(opt('pages')), opt('inputs'));

  await page.goto(process.env.APP_URL || 'http://localhost:8787/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.locator('#preset-choice-modal .preset-blank-btn', { hasText: '間取り図の画像から下書きを作る' }).click();
  await page.waitForSelector('#plan-import-modal.show', { timeout: 10000 });

  const t0 = Date.now();
  await page.locator('#plan-import-file').setInputFiles(join(ROOT, fixture.pdf));
  // PDF はページごとに図面の位置を探して切り出す（ここで find-plan が呼ばれる）。
  await page.waitForFunction(() => window.PlanImport && PlanImport.state && PlanImport.state.pages
    && !PlanImport.state.busy && document.getElementById('plan-import-run') && !document.getElementById('plan-import-run').disabled,
  null, { polling: 500, timeout: 5 * 60 * 1000 });
  const tRead = Date.now();
  await page.locator('#plan-import-run').click();
  await page.waitForFunction(() => !PlanImport.state.busy, null, { polling: 1000, timeout: 30 * 60 * 1000 });
  const tDone = Date.now();
  const got = await page.evaluate(() => {
    const r = PlanImport.state.result;
    return {
      ok: Boolean(r && r.plan),
      status: document.getElementById('plan-import-status').textContent,
      reviewSkipped: Boolean(r && r.reviewSkipped),
      reviewNote: (r && r.reviewNote) || '',
      revised: Boolean(r && r.revised),
      notes: (r && r.notes) || [],
      warnings: (r && r.warnings) || [],
    };
  });
  if (!got.ok) throw new Error('読み取りに失敗: ' + got.status);
  await page.locator('#plan-import-apply').click();
  await page.waitForFunction(() => !document.querySelector('#plan-import-modal.show'), null, { timeout: 30000 });
  const plan = await page.evaluate(() => JSON.parse(JSON.stringify({
    walls: DATA.walls, rooms: DATA.rooms,
    items: DATA.items.filter((it) => it && it.type !== 'foundation' && it.type !== 'roof'),
  })));

  // 費用は読み取りと見直しの合計。図面の位置探し（Gemini Flash、1回 ¥0.2）は別に数える。
  const reads = calls.filter((c) => c.hasPlan && c.usage);
  const usage = {};
  for (const c of reads) for (const [k, v] of Object.entries(c.usage)) usage[k] = (usage[k] || 0) + Number(v || 0);
  const score = scorePlan(truth, plan);
  result = {
    fixture: fixtureName, label, provider, model, at: new Date().toISOString(),
    seconds: { locate: Math.round((tRead - t0) / 1000), read: Math.round((tDone - tRead) / 1000) },
    usage, costJpy: costJpy(model, usage),
    review: got.reviewSkipped ? 'skipped' : (got.reviewNote ? 'failed' : 'done'),
    calls: calls.map(({ path, status, ms, pending, error }) => ({ path, status, ms, pending, error })).filter((c) => !c.pending),
    notes: got.notes, warnings: got.warnings,
    score: { total: score.total, walls: score.walls, rooms: score.rooms, openings: score.openings },
    plan,
  };
  const dir = join(HERE, 'out', fixtureName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, label + '.json'), JSON.stringify(result, null, 1));
  if (capture.images && !opt('pages') && !args.includes('--fake')) {
    const inDir = join(dir, label + '-inputs');
    mkdirSync(inDir, { recursive: true });
    capture.images.forEach((url, i) => {
      const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
      if (m) writeFileSync(join(inDir, `page-${i + 1}.${m[1].split('/')[1].replace('jpeg', 'jpg')}`), Buffer.from(m[2], 'base64'));
    });
    writeFileSync(join(inDir, 'inputs.json'), JSON.stringify({ boxes: capture.boxes, hint: capture.hint }, null, 1));
    if (capture.pagesRead) writeFileSync(join(inDir, 'pages-read.json'), JSON.stringify(capture.pagesRead));
    if (capture.pagesRevised) writeFileSync(join(inDir, 'pages-revised.json'), JSON.stringify(capture.pagesRevised));
  }
  const head = `${label}  ${provider} ${model}  読み取り ${result.seconds.read}秒  費用の目安 ${result.costJpy == null ? '-' : '¥' + result.costJpy}`
    + `  見直し ${result.review}  入力 ${usage.inputTokens || 0} / 出力 ${usage.outputTokens || 0} トークン`;
  writeFileSync(join(dir, label + '.txt'), head + '\n' + formatReport(score) + '\n');
  console.log(head);
  console.log(formatReport(score));
} catch (e) {
  console.error(String(e && e.stack || e));
  console.error(JSON.stringify(calls, null, 1));
  process.exitCode = 1;
} finally {
  await browser.close();
}

// Worker が返すのと同じ形で、正解を読み取り結果として返す。
// 物の位置は「中心」で返す決まり（画面側が角へ直す）なので、ここで中心へ直す。
async function fakeAi(page, plan) {
  const center = {
    walls: plan.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, floor: w.floor, thick: w.thick })),
    rooms: plan.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, d: r.d, floor: r.floor, n: r.n })),
    items: plan.items.map((it) => ({ type: it.type, x: it.x + it.w / 2, y: it.y + it.d / 2, w: it.w, d: it.d, rot: it.rot || 0, floor: it.floor })),
  };
  const reply = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/ai/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/quota')) return route.fulfill(reply({ left: null, counted: false }));
    if (p.endsWith('/find-plan')) return route.fulfill(reply({ box: null }));
    if (p.endsWith('/finish-plan')) return route.fulfill(reply({ rooms: [], picks: [], missing: [], reads: [] }));
    if (p.endsWith('/import-plan')) {
      return route.fulfill(reply({
        plan: center, summary: {}, marks: [], warnings: [], notes: [], pages: [],
        revise: { skipAll: true }, usage: { calls: 3, inputTokens: 0, outputTokens: 0 },
      }));
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

// 残しておいた（またはエージェントが書いた）ページごとの答えを、Worker と同じ関数で
// 間取りに組み立てて返す。見直しは行わない（見直しの有無で比べ方がずれないよう、
// 比べるときは API 側も見直し前の答え pages-read.json で採点し直す）。
async function replayAi(page, pages, inputsDir) {
  const { finishImportedPlan, mergeFloors } = await import(new URL('../../worker/routes-ai.mjs', import.meta.url).href);
  const boxes = inputsDir ? JSON.parse(readFileSync(join(inputsDir, 'inputs.json'), 'utf8')).boxes : [];
  let nth = 0;
  const reply = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/ai/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/quota')) return route.fulfill(reply({ left: null, counted: false }));
    if (p.endsWith('/find-plan')) return route.fulfill(reply({ box: boxes[nth++] || null }));
    if (p.endsWith('/finish-plan')) return route.fulfill(reply({ rooms: [], picks: [], missing: [], reads: [] }));
    if (p.endsWith('/import-plan')) {
      const res = finishImportedPlan(pages.length === 1 ? pages[0] : { floors: mergeFloors(pages) },
        { calls: pages.length }, { pages, revise: { skipAll: true } });
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

// ページごとの答え。1つの JSON（配列）か、エージェントが書いた answer-N.json の入ったフォルダ。
function readPages(path) {
  if (!statSync(path).isDirectory()) return JSON.parse(readFileSync(path, 'utf8'));
  return readdirSync(path).filter((f) => /^answer-\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((f) => JSON.parse(readFileSync(join(path, f), 'utf8')));
}
