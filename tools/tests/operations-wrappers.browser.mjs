// 画面の操作の包み(placeItem・delSel・updateSelectedProp)の決まりを、本物の画面で確かめる。
//   1. 今の階が 5 でも物を置ける(変更前の画面は置けた。保存プランが持てる階の上限は PlanSchema の 5)
//   2. 操作が errors を返したら、プランも取り消し・やり直しの履歴も未保存の印も、呼ぶ前のまま
//   3. 操作の途中の例外は、変更前と同じく呼んだ側へ出る(エラーの見張りに出るように)
//
// sh tools/run_browser_tests.sh operations-wrappers
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 30000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const browser = await chromium.launch();
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + '?preset=blank');
  await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
  await page.evaluate(() => { ST.view = '2d'; ST.tool = 'select'; ST.selected = null; clearMultiSelection(); clearEditHistory(); clearDirty(); });

  // 1. 階 5 に置く
  const five = await page.evaluate(() => {
    ST.floor = 5; ST.placingRot = 0;
    const n = DATA.items.length, h = HISTORY.length;
    placeItem('sofa', 2000, 2000);
    const it = DATA.items[DATA.items.length - 1];
    return { added: DATA.items.length - n, floor: it && it.floor, type: it && it.type, selected: ST.selected === it, hist: HISTORY.length - h };
  });
  assert.deepEqual(five, { added: 1, floor: 5, type: 'fmp-Sofa01', selected: true, hist: 1 }, '階 5 に物を置けない');
  console.log('ok   今の階が 5 でも物を置ける');

  // 2. errors のとき、何もしなかったのと同じ
  const failed = await page.evaluate(() => {
    ST.floor = 1;
    placeItem('sofa', 1000, 1000); placeItem('desk', 3000, 1000);
    const real = PlanCoreOperations.applyOperations;
    const out = {};
    const state = () => JSON.stringify({ data: serializeDataSnapshot(), hist: HISTORY.slice(), redo: REDO_HISTORY.slice(), dirty: DIRTY });
    const prep = () => { clearDirty(); REDO_HISTORY.length = 0; REDO_HISTORY.push('{"redo":1}'); };
    PlanCoreOperations.applyOperations = function () { return { plan: DATA, changedIds: [], removedIds: [], warnings: [], errors: [{ index: 0, op: 'x', message: '試しの失敗' }] }; };
    try {
      // 上限まで積んだ履歴でも、押し出した先頭まで戻ること
      while (HISTORY.length < HISTORY_LIMIT) HISTORY.push('{"pad":' + HISTORY.length + '}');
      prep(); let before = state();
      placeItem('sofa', 1500, 1500);
      out.place = state() === before;
      const target = DATA.items[DATA.items.length - 1];
      ST.selected = target; prep(); before = state();
      delSel();
      out.del = state() === before && ST.selected === target && DATA.items.indexOf(target) >= 0;
      ST.selected = target; prep(); before = state();
      updateSelectedProp('w', 1234);
      out.prop = state() === before && target.w !== 1234;
      // 色入力中・noSave は saveState しないので、外す物も無い(履歴を勝手に減らさない)
      prep(); before = state();
      updateSelectedProp('color', '#123456', true);
      out.propNoSave = state() === before;
    } finally {
      PlanCoreOperations.applyOperations = real;
    }
    return out;
  });
  assert.deepEqual(failed, { place: true, del: true, prop: true, propNoSave: true }, 'errors のときに履歴か印かプランが変わった');
  console.log('ok   操作が errors を返したら、プランも履歴も未保存の印も呼ぶ前のまま');

  // 3. 途中の例外は呼んだ側へ出る
  const thrown = await page.evaluate(() => {
    const real = window.applyDefaultPlacementElevation;
    window.applyDefaultPlacementElevation = function () { throw new Error('高さ決めの中の誤り'); };
    try { placeItem('sofa', 1200, 1200); return null; } catch (e) { return e.message; }
    finally { window.applyDefaultPlacementElevation = real; }
  });
  assert.equal(thrown, '高さ決めの中の誤り', '途中の例外が握りつぶされた');
  console.log('ok   操作の途中の例外は、呼んだ側へそのまま出る');
  assert.deepEqual(errors, [], 'ページで例外');
} finally {
  await browser.close();
}
console.log('PASS operations-wrappers');
