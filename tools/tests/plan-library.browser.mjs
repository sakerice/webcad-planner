// ブラウザに名前付きで残すプランの一覧（plan-library.js）を、実物のページで通す。
//
// 見るもの: 名前を付けて保存すると一覧に出る／一覧から開くと編集中のプランが替わる／
// 一覧から開いたプランを「保存」すると、前回のプランと一覧の両方が更新される／名前を変える・削除できる／
// 別のプランを読み込むと一覧との結び付きが外れる（以後の「保存」で一覧の物を上書きしない）。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + '?preset=2f');
  await page.waitForSelector('#plan-library-btn', { timeout: 60000 });
  await page.waitForTimeout(800);

  // 名前を付けて保存
  await page.click('#plan-library-btn');
  await page.click('.plan-library-save-new');
  await page.fill('.plan-library-name-input', 'A案');
  await page.press('.plan-library-name-input', 'Enter');
  await page.waitForFunction(() => PLAN_LIBRARY_ID);
  const items0 = await page.evaluate(() => DATA.items.length);

  // 変えて「保存」→ 一覧の A案 も更新される
  await page.evaluate(() => { saveState(); DATA.items.pop(); draw2d(); });
  await page.evaluate(() => savePlanToStorage());
  await page.waitForFunction(() => !DIRTY && PLAN_SAVE_INFO && PLAN_SAVE_INFO.alsoLast);
  const saved = await page.evaluate(async () => {
    const [m] = await PlanLibrary.list();
    return { name: m.name, items: (await PlanLibrary.get(m.id)).items.length, last: (await StorageAdapter.load()).items.length, thumb: m.thumb.startsWith('data:image/jpeg') };
  });
  assert.deepEqual(saved, { name: 'A案', items: items0 - 1, last: items0 - 1, thumb: true });

  // 別のプランを読み込むと結び付きが外れる
  await page.evaluate(() => loadPreset(0, '2f'));
  await page.waitForFunction(() => PLAN_LIBRARY_ID === null);
  await page.waitForTimeout(800);
  await page.evaluate(() => savePlanToStorage());
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(async () => (await PlanLibrary.get((await PlanLibrary.list())[0].id)).items.length), items0 - 1, '別のプランの保存で一覧の物が上書きされた');

  // 一覧から開く・名前を変える・削除
  await page.click('#plan-library-btn');
  await page.click('.plan-library-row:has-text("A案") >> button:has-text("開く")');
  await page.waitForFunction(() => PLAN_LIBRARY_ID);
  assert.equal(await page.evaluate(() => DATA.items.length), items0 - 1);
  await page.click('#plan-library-btn');
  await page.click('.plan-library-row:has-text("A案") >> button:has-text("名前を変える")');
  await page.fill('.plan-library-name-input', 'A案（改）');
  await page.press('.plan-library-name-input', 'Enter');
  await page.waitForSelector('.plan-library-row:has-text("A案（改）")');
  assert.equal(await page.evaluate(() => DATA.planName), 'A案（改）');
  await page.click('.plan-library-row:has-text("A案（改）") >> button:has-text("削除")');
  await page.waitForFunction(async () => (await PlanLibrary.list()).length === 0);
  assert.equal(await page.evaluate(() => PLAN_LIBRARY_ID), null);

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('保存の一覧: 名前を付けて保存・一覧から開く・保存で両方更新・名前の変更・削除・結び付きの解除が通った');
} finally {
  await browser.close();
}
