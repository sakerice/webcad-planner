// 起動時に保存されていたプランを開くときの知らせ(PR #129)を、ブラウザの保存に細工して確かめる。
//
//   (a) 開けない部分を含む保存 →「開けない部分が N 個あったため、その部分を除いて開きました。」(N は PlanSchema.tidyPlan の数)
//   (b) 要素が 2000 個を超える保存 →「このプランは大きいため…開きますか？」。はいで開き、いいえで開かず、保存は消さない
//   (c) (a) の知らせが、画面の大きさ(aspect-check.mjs の SIZES)ごとに収まり、切れず、重ならず、押せる大きさ
//
// APP_URL の画面に向く(既定は手元の静的サーバ)。本番に向けるときは、本番への要求を減らすため
//   APP_URL=https://cad-planner.srapps.us/ LIGHT=1 SIZES=390x844
// のように、絵・形・テクスチャの読み込みを止め(知らせの確かめには要らない)、大きさを絞る。送った要求の数を最後に出す。
// 写真は ASPECT_SHOT_DIR(無ければ output/test-shots/aspect)。
//
// sh tools/run_browser_tests.sh plan-load-notices
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SIZES, checkLayout } from './aspect-check.mjs';
import { shotDir } from './shot-dir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const LIGHT = process.env.LIGHT === '1';
const HEAVY = /\.(glb|gltf|ktx2|hdr|jpe?g|png|webp|avif|mp4|webm)(\?|$)/i;
const SHOTS = process.env.ASPECT_SHOT_DIR || shotDir('aspect');
const sizes = process.env.SIZES ? process.env.SIZES.split(',').map((s) => s.split('x').map(Number)) : SIZES;
const Schema = createRequire(import.meta.url)('../../assets/js/plan-schema.js');
const T = { timeout: 90000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const base = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
// (a) 開けない部分: 物でない要素・形の違う欄
const broken = structuredClone(base);
broken.walls.push(null, 'こわれた壁');
broken.items.push(42);
broken.rooms[0].name = { text: '入れ物' };
const brokenText = JSON.stringify(broken);
const expectedLost = Schema.tidyPlan(JSON.parse(brokenText)).lost;
assert.ok(expectedLost > 0);
// (b) 大きいプラン: 壁を足して 2000 個を超える
const big = structuredClone(base);
const extra = Schema.LIMITS.MAX_LOAD_OBJECTS + 10 - (big.walls.length + big.items.length + big.rooms.length);
for (let i = 0; i < extra; i++) big.walls.push({ id: 'bigwall' + i, x1: 30000 + i * 10, y1: 0, x2: 30000 + i * 10, y2: 900, thick: 105, floor: big.walls[0].floor });
const bigText = JSON.stringify(big);
const bigWalls = big.walls.length;

const browser = await chromium.launch();
const errors = [];
let requests = 0;
const putSaved = (page, text) => page.evaluate((text) => new Promise((resolve, reject) => {
  const req = indexedDB.open('webcad', 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('plans')) req.result.createObjectStore('plans'); };
  req.onsuccess = () => { const t = req.result.transaction('plans', 'readwrite'); t.objectStore('plans').put(text, 'webcad-plan-v1'); t.oncomplete = () => { req.result.close(); resolve(); }; t.onerror = () => reject(t.error); };
  req.onerror = () => reject(req.error);
}), text);
const savedLength = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('webcad', 1);
  req.onsuccess = () => { const g = req.result.transaction('plans', 'readonly').objectStore('plans').get('webcad-plan-v1'); g.onsuccess = () => { req.result.close(); resolve(g.result ? JSON.parse(g.result).walls.length : 0); }; };
  req.onerror = () => resolve(-1);
}));

async function openContext(w, h) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  if (LIGHT) await context.route(HEAVY, (route) => route.abort());
  const st = { dialogs: [], answer: () => true };
  context.on('request', (r) => { if (!(LIGHT && HEAVY.test(r.url()))) requests++; }); // 止めた物はサーバーに届かないので数えない
  context.on('page', (page) => {
    page.on('pageerror', (e) => errors.push(`[${w}x${h}] pageerror: ${e.message}`));
    page.on('dialog', (d) => { const m = d.message(); st.dialogs.push(m); (st.answer(m) ? d.accept() : d.dismiss()).catch(() => {}); });
  });
  return { context, st };
}
const started = (page) => page.waitForFunction(() => window.DATA && window.ST && (window._defaultPlanPending === false
  || (document.getElementById('preset-choice-modal') || { classList: { contains: () => false } }).classList.contains('show')), null, T);

let passed = 0;
const table = [];
try {
  for (const [i, [w, h]] of sizes.entries()) {
    const tag = `${w}x${h}`;
    const { context, st } = await openContext(w, h);
    const page = await context.newPage();
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.PRESET_CURRENT === 'blank' && window._defaultPlanPending === false, null, T);

    // (a)
    await putSaved(page, brokenText);
    await page.goto(APP);
    await page.waitForFunction(() => window.DATA && window._defaultPlanPending === false && !document.getElementById('plan-notice').hidden, null, T);
    const text = await page.evaluate(() => document.getElementById('plan-notice-text').textContent);
    assert.equal(text, `開けない部分が ${expectedLost} 個あったため、その部分を除いて開きました。`);
    assert.equal(await page.evaluate(() => DATA.walls.length), base.walls.length, '除いたあとの壁の数が違う');
    await page.waitForTimeout(400);
    const m = await checkLayout(page, ['#plan-notice']);
    await page.screenshot({ path: join(SHOTS, `tidy-notice-${tag}.png`) });
    table.push([tag, '除いて開いた知らせ', m.problems]);
    if (i === 0) { passed++; console.log(`ok a 開けない部分を除いて開き、知らせが出た(${expectedLost} 個)`); }

    // (b) は最初の大きさだけ(確認は端末の標準の窓で、画面の大きさに左右されない)
    if (i === 0) {
      await putSaved(page, bigText);
      st.dialogs.length = 0;
      await page.reload();
      await page.waitForFunction((n) => window.DATA && window._defaultPlanPending === false && DATA.walls.length === n, bigWalls, T);
      const ask = st.dialogs.find((d) => /大きいため/.test(d));
      assert.equal(ask, `このプランは大きいため(壁・部屋・物が ${Schema.LIMITS.MAX_LOAD_OBJECTS + 10} 個)、開くのに時間がかかります。開きますか？`);
      passed++; console.log('ok b1 大きいプランは確かめてから開く(はい → 開いた)');

      await putSaved(page, bigText);
      st.dialogs.length = 0;
      st.answer = (msg) => !/大きいため/.test(msg);
      await page.reload();
      await started(page);
      await page.waitForTimeout(800);
      assert.ok(st.dialogs.some((d) => /大きいため/.test(d)), '確認が出ていない');
      assert.notEqual(await page.evaluate(() => DATA.walls.length), bigWalls, '「いいえ」なのに開いた');
      assert.equal(await savedLength(page), bigWalls, '「いいえ」で保存が消えた・変わった');
      await page.screenshot({ path: join(SHOTS, `big-plan-no-${tag}.png`) });
      st.answer = () => true;
      passed++; console.log('ok b2 「いいえ」なら開かず、保存はそのまま');
    }
    await context.close();
  }
  let bad = 0;
  for (const [tag, what, problems] of table) {
    console.log(`${problems.length ? '問題あり' : '問題なし'}  ${tag}  ${what}${problems.length ? '\n    ' + problems.join('\n    ') : ''}`);
    bad += problems.length;
  }
  assert.equal(bad, 0, `画面の比率で ${bad} 件の問題`);
  passed++; console.log(`ok c ${sizes.length} つの大きさで、知らせが収まる`);
  // LIGHT では絵を止めるので、読めなかった絵を 2D に描く所の例外は検査の作りから来る(数えない)
  assert.deepEqual(errors.filter((e) => !(LIGHT && /drawImage.*'broken' state/.test(e))), []);
  console.log(`plan-load-notices: ${passed} 件 ok(${APP}、要求 ${requests} 回${LIGHT ? '、絵と形は止めた' : ''})`);
} finally {
  console.log(`要求: ${requests} 回`);
  await browser.close();
}
