// 本番の利用者が持っている保存データが、今の本番と同じ中身で開けること。
//
// なぜ要るか: PR #76 は新しい保存の仕組みを入れる途中で、それまでの保存を
// 「読み取り専用の原本」として扱い、開くまでに7操作を要求し、最後まで行っても
// 開かない状態だった。テストは全部緑だった — 新しい仕組みのテストしか無く、
// 「今の利用者のデータが今まで通り開くか」を見るものが1つも無かったから。
//
// 見るもの: 本番(main)で作った保存データ(fixtures/compat/)を、本番の3つの入口
//   - IndexedDB の保存（今の「保存」）
//   - localStorage の保存（IndexedDB 導入前の「保存」。消さずに読む約束がある）
//   - 「読込」での JSON
// から開き、開いた間取りの指紋が、本番で記録した正解(golden.json)と一致すること。
// 正解は「本番がそう開いた」という事実なので、本番と違う開き方をした時点で落ちる。
//
// 正解を作り直すのは、保存形式の仕様を**意図して**変えたときだけ:
//   UPDATE_GOLDEN=1 sh tools/run_browser_tests.sh plan-compat
// 「テストが落ちたから合わせた」で作り直してはいけない — 利用者のデータを
// 開けなくした変更を、検査ごと通すことになる。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'fixtures', 'compat');
const GOLDEN = join(DIR, 'golden.json');
const APP = process.env.APP_URL || 'http://localhost:8932/';
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const FIXTURES = ['saved-2f', 'saved-3f', 'legacy-quirks', 'legacy-no-heights'];
const ROUTES = ['idb', 'localStorage', 'json', 'idb-resave', 'library', 'shared-patch', 'shared-patch-fields'];
// 見本の中身に左右されない経路。起動時の選択で出荷物の既定プランを開く。
// 指紋は fixture でなく出荷物(assets/default_plan*.json)の中身になるので、
// golden.json の 'default-plan' に「今の main でそう開いた」記録として残す。
const PRESET_ROUTES = ['preset-2f', 'preset-3f'];
const STARTUP_PROMPT = /前回保存したプランがあります/;

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 開いた間取りの指紋。位置・寸法は mm に丸める（浮動小数の末尾で落ちないため）。
// 並び順に意味は無いので、並べ替えてから比べる。
//
// 天井付けの照明の高さは、利用者が保存した値ではない。開くたびに取付面(部屋の天井・
// 軒下なら屋根の板の下面)から計算し直して上書きする(snapCeilingLightsToAttachSurface)。
// その数値を正解に書くと、屋根や天井の作りを直すたびに「保存データが開けない」と
// 嘘の指摘が出る(2026-11 の軒下ダウンライトの修正で 80mm ずれて落ちた)。
// ここで見るのは「取付面に付いて開いたか」だけにし、高さの値の正しさは寄せる仕組みの
// 検査(skip-floor.test.cjs ほか)に任せる。取付面から外れて開いた照明(吊り下げ・
// 取付面の無い場所)は、保存した値そのものなので数値のまま比べる。
function fingerprint() {
  const r = (v) => Math.round(Number(v) || 0);
  const modal = document.getElementById('preset-choice-modal');
  const elevOf = (i) => {
    const top = isLightItemType(i.type) ? CEILING_FIXTURE_TOP_MM[i.type] : undefined;
    if (top !== undefined) {
      const want = ceilingAttachElevationMm(i);
      if (want !== null && isFinite(want) && Math.abs((Number(i.elev) || 0) - (want - top)) <= 1) return '取付面';
    }
    return r(i.elev);
  };
  // 補完が書き換える先を、値のまま見る。
  function completionFingerprint() {
    const r = (v) => Math.round(Number(v) || 0);
    // キーの並びに依存しない文字列にする（経路ごとに作られる順が違っても、中身が同じなら同じ）
    const stable = (v) => JSON.stringify(v, (k, x) => {
      if (k === '_texObj') return undefined;
      if (x && typeof x === 'object' && !Array.isArray(x)) return Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {});
      return x;
    });
    const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
    const pick = (o, keys) => keys.map((k) => (o[k] === undefined ? '-' : (typeof o[k] === 'number' ? Math.round(o[k] * 100) / 100 : stable(o[k])))).join('|');
    const sorted = (arr, f) => arr.map(f).sort();
    const idCheck = (arr) => {
      const seen = new Set(); let missing = 0, dup = 0;
      arr.forEach((o) => { if (o.id === undefined || o.id === null || o.id === '') missing++; else if (seen.has(String(o.id))) dup++; else seen.add(String(o.id)); });
      return { missing, dup };
    };
    const cam = (c) => (c ? [c.x, c.y, c.z].map((n) => Math.round(n * 100) / 100) : null);
    return {
      // 外壁・内壁・屋根・外構の設定（ensureExteriorWallSettings ほか）
      exteriorWallSettings: stable(DATA.exteriorWallSettings),
      interiorWallSettings: stable(DATA.interiorWallSettings),
      roofAppearance: stable(DATA.roofAppearance),
      exteriorDetail: stable(DATA.exteriorDetail),
      // 階のメタデータの値と、階ごとの高さ設定（ensureFloorMetadata / ensureHeightDefaults）
      floorMetadataValues: stable(DATA.floorMetadata),
      heightFloors: stable(DATA.floors),
      wallHeightGlobal: r(WALL_H),
      // 壁・部屋・家具が補完で受け取る値
      wallFields: sorted(DATA.walls, (w) => [w.floor || 1, r(w.x1), r(w.y1), r(w.x2), r(w.y2), pick(w, ['id', 'wallHeight', 'color', 'texture', 'wallBand', 'wallStyle', 'wallTopShape', 'wallTopSide'])].join(',')),
      roomFields: sorted(DATA.rooms, (m) => [m.floor || 1, m.n || '', pick(m, ['id', 'floorRaiseMm', 'ceilingHeight', 'ceilH'])].join(',')),
      itemFields: sorted(DATA.items, (i) => [i.floor || 1, i.type, r(i.x), r(i.y), pick(i, ['id', 'fmpId', 'openingModel', 'doorHeight', 'doorOpenState', 'windowHeight', 'windowSill', 'color', 'colorCustom', 'modelFacingVersion', 'neighborFacingVersion', 'texture'])].join(',')),
      // 全フィールドを見る網。上で拾えない書き換えがあっても、これが変わる
      wallsHash: hash(sorted(DATA.walls, stable).join('\n')),
      roomsHash: hash(sorted(DATA.rooms, stable).join('\n')),
      itemsHash: hash(sorted(DATA.items, stable).join('\n')),
      // id が全部に振られているか・重複が無いか、次に振る番号（ensureObjectIds）
      ids: { walls: idCheck(DATA.walls), items: idCheck(DATA.items), rooms: idCheck(DATA.rooms) },
      nextId: typeof nextId === 'number' ? nextId : null,
      // 方位（syncNorthFromPlan）
      northDeg: DATA.northDeg === undefined ? null : DATA.northDeg,
      northDegLight: (typeof LIGHT_SETTINGS !== 'undefined' && LIGHT_SETTINGS) ? LIGHT_SETTINGS.northDeg : null,
      // 視点（restoreViewState）。保存された値、取り置きの値、開いた直後の2D・3Dの実際の視点
      viewState: stable(DATA.viewState === undefined ? null : DATA.viewState),
      camStash: stable(ST._camStash === undefined ? null : ST._camStash),
      view2d: [Math.round(ST.zoom * 1000) / 1000, r(ST.panX), r(ST.panY)],
      camera: (typeof camExt !== 'undefined' && camExt && typeof orbit !== 'undefined' && orbit) ? { pos: cam(camExt.position), target: cam(orbit.target) } : null,
    };
  }
  return {
    walls: DATA.walls.map((w) => [w.floor || 1, r(w.x1), r(w.y1), r(w.x2), r(w.y2), r(w.thick)].join(',')).sort(),
    rooms: DATA.rooms.map((m) => [m.floor || 1, m.n || '', r(m.x), r(m.y), r(m.w), r(m.d), (m.pts || []).length].join(',')).sort(),
    items: DATA.items.map((i) => [i.floor || 1, i.type, r(i.x), r(i.y), r(i.w), r(i.d), r(i.rot), elevOf(i)].join(',')).sort(),
    heightDefaults: DATA.heightDefaults || null,
    floors: Object.keys(DATA.floorMetadata || {}).sort(),
    // 開いたあとに間取りの選択画面が残っていないこと（重なって出る不具合の検出）
    presetChoiceShown: !!(modal && modal.classList.contains('show')),
    // ここから下は、開くときの補完(ensure*・normalizeLegacyFurnitureItems・syncNorthFromPlan・
    // restoreViewState)が書き換えた結果そのもの。上の項目は変えず、足すだけにしてある。
    ...completionFingerprint(),
  };
}

async function waitApp(page) {
  await page.waitForFunction(() => window.DATA && DATA.walls, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
}

// 保存の復元が終わるまで待つ。復元されない（＝既定間取りの選択待ちのまま）なら
// 時間切れで null を返し、呼び出し側が「開けなかった」として扱う。
async function waitRestored(page) {
  try {
    await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4 && window._defaultPlanPending === false,
      null, { timeout: 20000 });
    await page.waitForTimeout(500);
    return await page.evaluate(fingerprint);
  } catch (_) {
    return null;
  }
}

// 保存の復元を、既定プランの取得が終わるまで遅らせる。
// 今の本番では、起動時の復元が壁の高さ(WALL_H)を引き継ぐ先は、既定プランの取得と復元の
// どちらが先に終わるかで変わる(取得が先なら 2688、復元が先なら 2400)。見本の正解は
// 取得が先の場合を記録しているので、順番を固定する。復元は起動処理の最初の
// indexedDB.open(StorageAdapter.hasData)から始まるので、そこだけを保留する。
// 保留するのは読み込みごとの最初の1回だけ。保存し直しなど、あとの open は止めない。
// 製品のコードには触らない。保留は、既定プランの壁が入る(loadPreset の取得後の処理が
// 終わる)か、15秒たつまで。
async function holdRestoreUntilPresetFetched(page) {
  await page.addInitScript(() => {
    const orig = IDBFactory.prototype.open;
    let held = false;
    IDBFactory.prototype.open = function (...args) {
      if (held) return orig.apply(this, args);
      held = true;
      const self = this;
      let real = null;
      const fake = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      Object.defineProperty(fake, 'result', { get: () => (real ? real.result : undefined) });
      Object.defineProperty(fake, 'error', { get: () => (real ? real.error : null) });
      const started = Date.now();
      const go = () => {
        const ready = window.DATA && DATA.walls && DATA.walls.length > 4 && window._defaultPlanPending === true;
        if (!ready && Date.now() - started < 15000) { setTimeout(go, 20); return; }
        real = orig.apply(self, args);
        ['onsuccess', 'onerror', 'onupgradeneeded', 'onblocked'].forEach((k) => {
          real[k] = (e) => { if (fake[k]) fake[k].call(fake, e); };
        });
      };
      setTimeout(go, 0);
      return fake;
    };
  });
}

async function seed(page, route, raw) {
  await page.evaluate(({ route, raw }) => new Promise((resolve, reject) => {
    if (route === 'localStorage') { localStorage.setItem('webcad-plan-v1', raw); resolve(); return; }
    const r = indexedDB.open('webcad', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('plans')) r.result.createObjectStore('plans'); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('plans', 'readwrite');
      tx.objectStore('plans').put(raw, 'webcad-plan-v1');
      tx.oncomplete = () => { r.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { route, raw });
}

// 起動時の間取り選択の画面で、既定プランを選んで開く（choosePresetPlan を本物のボタンから通す）
async function openPresetThrough(browser, route) {
  const key = route.replace('preset-', '');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const dialogs = [], errors = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(APP);
    await waitApp(page);
    await page.waitForSelector('#preset-choice-modal.show', { timeout: 20000 });
    await page.click(`.preset-choice-btn[onclick*="'${key}'"]`);
    let fp = null;
    try {
      await page.waitForFunction((k) => window.DATA && DATA.walls && DATA.walls.length > 4 && window.PRESET_CURRENT === k,
        key, { timeout: 20000 });
      await page.waitForTimeout(500);
      fp = await page.evaluate(fingerprint);
    } catch (_) { fp = null; }
    return { fp, dialogs, errors };
  } finally {
    await context.close();
  }
}

async function openThrough(browser, name, route) {
  const raw = readFileSync(join(DIR, name + '.json'), 'utf8');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const dialogs = [], errors = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    if (route === 'json') {
      await page.goto(APP + '?preset=2f');
      await waitApp(page);
      await page.evaluate(() => { window.__beforeImport = DATA; });
      await page.setInputFiles('#import-file', join(DIR, name + '.json'));
      await page.waitForFunction(() => window.DATA !== window.__beforeImport, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      const fp = await page.evaluate(() => (window.DATA !== window.__beforeImport ? null : 'unchanged'));
      return { fp: fp === 'unchanged' ? null : await page.evaluate(fingerprint), dialogs, errors };
    }
    if (route === 'library') {
      // PlanLibrary.put で一覧に保存し、開き直した画面で一覧(openList)の「開く」を押す
      await page.goto(APP + '?preset=2f');
      await waitApp(page);
      await page.evaluate((raw) => PlanLibrary.put({ id: null, name: '互換テスト', plan: JSON.parse(raw), thumb: '' }), raw);
      await page.reload();
      await waitApp(page);
      await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4, null, { timeout: 20000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => PlanLibrary.openList());
      await page.waitForSelector('.plan-library-row', { timeout: 10000 });
      await page.evaluate(() => window.__beforeLibrary = DATA);
      await page.click('.plan-library-row:has(.plan-library-name:text-is("互換テスト")) .plan-library-btn.primary');
      await page.waitForFunction(() => window.DATA !== window.__beforeLibrary, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      const opened = await page.evaluate(() => window.DATA !== window.__beforeLibrary);
      return { fp: opened ? await page.evaluate(fingerprint) : null, dialogs, errors };
    }
    if (route === 'shared-patch' || route === 'shared-patch-fields') {
      // 空のプランに、見本の壁・家具・部屋を丸ごと upserts にした patch を applySharedPatch で当てる
      await page.goto(APP + '?preset=blank');
      await waitApp(page);
      await page.waitForFunction(() => window._defaultPlanPending === false, null, { timeout: 20000 });
      const applied = await page.evaluate(({ raw, withFields }) => {
        const plan = JSON.parse(raw);
        // shared-patch-fields: 送信側の buildSharedPatch がそのまま作る patch（fields は SHARED_FIELDS の全部）
        const patch = withFields ? buildSharedPatch(plan, null) : { collections: {}, fields: {} };
        if (!withFields) ['walls', 'items', 'rooms'].forEach((n) => { patch.collections[n] = { upserts: plan[n] || [], removes: [] }; });
        applySharedPatch(patch, false);
        return DATA.walls.length;
      }, { raw, withFields: route === 'shared-patch-fields' });
      await page.waitForTimeout(800);
      return { fp: applied > 0 ? await page.evaluate(fingerprint) : null, dialogs, errors };
    }
    await page.goto(APP);
    await waitApp(page);
    await seed(page, route === 'localStorage' ? 'localStorage' : 'idb', raw);
    await holdRestoreUntilPresetFetched(page);
    await page.reload();
    await waitApp(page);
    let fp = await waitRestored(page);
    if (route === 'idb-resave' && fp) {
      // 読んで、保存して、もう一度開く。保存し直しで中身が変わらないこと。
      await page.evaluate(() => savePlanToStorage());
      dialogs.length = 0;
      await page.reload();
      await waitApp(page);
      fp = await waitRestored(page);
    }
    return { fp, dialogs, errors };
  } finally {
    await context.close();
  }
}

function describeDiff(want, got) {
  const out = [];
  // 実際の指紋にあって正解に無い項目も差とする（指紋に項目を足して正解を取り直し忘れたとき、比べられないまま通さない）
  for (const key of Object.keys(got)) {
    // 値が undefined の項目は、正解(JSON)に書くと消えるので、無いものとして扱う
    if (!(key in want) && got[key] !== undefined) out.push(`${key}: 正解に無い項目 実際 ${JSON.stringify(got[key])}`);
  }
  for (const key of Object.keys(want)) {
    const a = want[key], b = got[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      const missing = a.filter((x) => !b.includes(x)), extra = b.filter((x) => !a.includes(x));
      if (missing.length || extra.length) out.push(`${key}: 足りない ${missing.length}件 ${JSON.stringify(missing.slice(0, 3))} / 余分 ${extra.length}件 ${JSON.stringify(extra.slice(0, 3))}`);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(`${key}: 期待 ${JSON.stringify(a)} / 実際 ${JSON.stringify(b)}`);
    }
  }
  return out.join('\n    ');
}

const golden = UPDATE ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
const failures = [];
const browser = await chromium.launch();
try {
  for (const name of FIXTURES) {
    for (const route of ROUTES) {
      const label = `${name} を ${route} から`;
      const { fp, dialogs, errors } = await openThrough(browser, name, route);
      const problems = [];
      if (!fp) problems.push('開けなかった（既定の間取りのまま）');
      if (route === 'library' || route === 'shared-patch' || route === 'shared-patch-fields') {
        // 起動時の確認は出ない経路。確認・警告が出たら、それ自体を問題にする
        if (dialogs.length) problems.push('確認・警告が出た: ' + dialogs.join(' / '));
      } else if (route !== 'json') {
        const prompts = dialogs.filter((m) => STARTUP_PROMPT.test(m));
        if (prompts.length !== 1) problems.push(`起動時の確認「前回保存したプランがあります」が ${prompts.length} 回`);
        const others = dialogs.filter((m) => !STARTUP_PROMPT.test(m));
        if (others.length) problems.push('ほかの確認・警告が出た: ' + others.join(' / '));
      } else if (dialogs.length) {
        problems.push('読込で確認・警告が出た: ' + dialogs.join(' / '));
      }
      if (errors.length) problems.push('ページで例外: ' + errors.join(' / '));
      if (UPDATE) {
        if (problems.length) throw new Error(`正解を作れない: ${label}: ${problems.join(' / ')}`);
        (golden[name] ||= {})[route] = fp;
        continue;
      }
      if (fp) {
        const want = golden[name] && golden[name][route];
        assert.ok(want, `golden.json に ${label} の正解が無い`);
        const diff = describeDiff(want, fp);
        if (diff) problems.push('開いた中身が本番と違う:\n    ' + diff);
      }
      if (problems.length) failures.push(`${label}: ${problems.join('\n  ')}`);
      else console.log(`ok  ${label}`);
    }
  }
  for (const route of PRESET_ROUTES) {
    const label = `出荷物の既定プランを ${route} で`;
    const { fp, dialogs, errors } = await openPresetThrough(browser, route);
    const problems = [];
    if (!fp) problems.push('開けなかった');
    if (dialogs.length) problems.push('確認・警告が出た: ' + dialogs.join(' / '));
    if (errors.length) problems.push('ページで例外: ' + errors.join(' / '));
    if (UPDATE) {
      if (problems.length) throw new Error(`正解を作れない: ${label}: ${problems.join(' / ')}`);
      (golden['default-plan'] ||= {})[route] = fp;
      continue;
    }
    if (fp) {
      const want = golden['default-plan'] && golden['default-plan'][route];
      assert.ok(want, `golden.json に ${label} の正解が無い`);
      const diff = describeDiff(want, fp);
      if (diff) problems.push('開いた中身が本番と違う:\n    ' + diff);
    }
    if (problems.length) failures.push(`${label}: ${problems.join('\n  ')}`);
    else console.log(`ok  ${label}`);
  }
} finally {
  await browser.close();
}

if (UPDATE) {
  writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
  console.log('正解を書き出した:', GOLDEN);
} else {
  assert.ok(existsSync(GOLDEN));
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
  console.log('既存の保存データ: ' + FIXTURES.length + '種類 × 7通りの開き方と、既定プラン2通りで、本番と同じ中身に開けた');
}
