// プランを開く経路の、補完(normalizeLoadedPlan)以外の振る舞いを実物のブラウザで見る。
//
// 1. 壊れた保存データ(walls が文字列)を起動時の復元(loadPlanFromStorage)に通すと、
//    空の画面で止まらず既定プランに戻ること。補完の途中で例外が出たときの戻り方の検査。
// 2. 白紙から始めた(chooseBlankPlan)プランをブラウザに保存したときの JSON のキーが、
//    補完を1つにまとめる前と同じであること。chooseBlankPlan は読み込みではないので
//    まとめた補完を通さない。通すようになって保存内容が太ったら、ここで分かる。
//
// sh tools/run_browser_tests.sh plan-load-paths
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 2026-11-11、置き換え前(ef9f8fd7)の画面で白紙から始めて保存した JSON のキー。
// 入れ子のオブジェクトは「親.子」で並べる(配列の中身は見ない)。
// planFixes(天井付け器具の寄せの済み印)は外す。家具カタログの読み込み(applyFurnitureMegaManifest)
// が終わった時刻と白紙を選んだ時刻の前後で、付いたり付かなかったりする。開く経路とは関係が無い。
const BLANK_SAVED_KEYS = [
  'exteriorWallSettings',
  'floorMetadata',
  'floors',
  'heightDefaults',
  'heightDefaults.floorRaise',
  'heightDefaults.floorThickness',
  'heightDefaults.modelVersion',
  'heightDefaults.perFloor',
  'heightDefaults.wallHeight',
  'interiorWallSettings',
  'items',
  'roofAppearance',
  'rooms',
  'startMode',
  'walls',
];

async function waitApp(page) {
  await page.waitForFunction(() => window.DATA && DATA.walls, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
}

const browser = await chromium.launch();
const errors = [];
try {
  // ── 1. 壊れた保存データ → 既定プランに戻る ──
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const dialogs = [], restoreFailures = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /saved plan restore failed/.test(m.text())) restoreFailures.push(m.text()); });
    await page.goto(APP);
    await waitApp(page);
    await page.evaluate(() => StorageAdapter.save({ walls: 'こわれた壁', items: [], rooms: [] }));
    await page.reload();
    await waitApp(page);
    await page.waitForFunction(() => Array.isArray(DATA.walls) && DATA.walls.length > 4 && window.PRESET_CURRENT === '2f',
      null, { timeout: 30000 });
    assert.ok(dialogs.some((m) => /前回保存したプランがあります/.test(m)), '起動時の確認が出ていない: ' + JSON.stringify(dialogs));
    assert.equal(restoreFailures.length, 1, '復元の失敗が記録されていない（壊れたデータが通ってしまった）');
    const state = await page.evaluate(() => ({
      walls: Array.isArray(DATA.walls), items: Array.isArray(DATA.items), rooms: Array.isArray(DATA.rooms),
      pending: _defaultPlanPending,
    }));
    assert.deepEqual(state, { walls: true, items: true, rooms: true, pending: true });
    console.log('ok  壊れた保存データ(walls が文字列)は既定プランに戻った');
    await context.close();
  }

  // ── 2. 白紙から始めたプランの保存 JSON のキー ──
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP + '?preset=blank');
    await waitApp(page);
    await page.waitForFunction(() => window._defaultPlanPending === false && window.PRESET_CURRENT === 'blank', null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const keys = await page.evaluate(async () => {
      await StorageAdapter.save(DATA);
      const raw = await new Promise((resolve, reject) => {
        const req = indexedDB.open('webcad', 1);
        req.onsuccess = () => {
          const r = req.result.transaction('plans', 'readonly').objectStore('plans').get('webcad-plan-v1');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      });
      const out = [];
      const walk = (o, prefix) => Object.keys(o).forEach((k) => {
        out.push(prefix + k);
        const v = o[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix + k + '.');
      });
      walk(JSON.parse(raw), '');
      return out.filter((k) => !/^planFixes(\.|$)/.test(k)).sort();
    });
    if (process.env.PRINT_BLANK_KEYS === '1') console.log(JSON.stringify(keys, null, 2));
    assert.deepEqual(keys, BLANK_SAVED_KEYS);
    console.log('ok  白紙から始めたプランの保存 JSON のキーは置き換え前と同じ');
    await context.close();
  }

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
