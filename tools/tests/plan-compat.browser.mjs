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
const FIXTURES = ['saved-2f', 'saved-3f', 'legacy-quirks'];
const ROUTES = ['idb', 'localStorage', 'json', 'idb-resave'];
const STARTUP_PROMPT = /前回保存したプランがあります/;

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 開いた間取りの指紋。位置・寸法は mm に丸める（浮動小数の末尾で落ちないため）。
// 並び順に意味は無いので、並べ替えてから比べる。
function fingerprint() {
  const r = (v) => Math.round(Number(v) || 0);
  const modal = document.getElementById('preset-choice-modal');
  return {
    walls: DATA.walls.map((w) => [w.floor || 1, r(w.x1), r(w.y1), r(w.x2), r(w.y2), r(w.thick)].join(',')).sort(),
    rooms: DATA.rooms.map((m) => [m.floor || 1, m.n || '', r(m.x), r(m.y), r(m.w), r(m.d), (m.pts || []).length].join(',')).sort(),
    items: DATA.items.map((i) => [i.floor || 1, i.type, r(i.x), r(i.y), r(i.w), r(i.d), r(i.rot), r(i.elev)].join(',')).sort(),
    heightDefaults: DATA.heightDefaults || null,
    floors: Object.keys(DATA.floorMetadata || {}).sort(),
    // 開いたあとに間取りの選択画面が残っていないこと（重なって出る不具合の検出）
    presetChoiceShown: !!(modal && modal.classList.contains('show')),
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
    await page.goto(APP);
    await waitApp(page);
    await seed(page, route === 'localStorage' ? 'localStorage' : 'idb', raw);
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
      if (route !== 'json') {
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
} finally {
  await browser.close();
}

if (UPDATE) {
  writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
  console.log('正解を書き出した:', GOLDEN);
} else {
  assert.ok(existsSync(GOLDEN));
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
  console.log('既存の保存データ: 3種類 × 4通りの開き方で、本番と同じ中身に開けた');
}
