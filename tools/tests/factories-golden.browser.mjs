// 壁と物を作る関数 mkWall / mkItem が、全種類について今どんな中身を返すかの記録と照合。
//
// なぜ要るか: 段2で mkWall / mkItem を assets/js/plan-core/ へ移す。移したあとも
// 出力が1項目も変わらないことを、全種類ぶんの記録と比べて確かめる。
// 正解は「今の main の関数がそう作った」という事実なので、移したあとの関数が違う物を
// 作った時点で落ちる。
//
// 見るもの(すべてページの中で集める)
//   - 種類の一覧: ISIZES・FMP_ITEMS・LEGACY_FMP_TYPE_MAP のキーの和 + 'no-such-type'(名前順)
//   - 各種類の mkItem(type,100,200,90,2) と mkItem(type,0,0,0,1,1234,567)
//     id は呼ぶ前後の nextId の差だけを記録し、物からは除く。項目の並び(Object.keys)も記録
//   - mkWall(0,0,1000,0) と mkWall(0,0,0,1000,2,90,'#123456')(_texObj は除く)
//   - 引数を省いた呼び出し(omitted): 5種類の mkItem(type,0,0) と mkItem(type,0,0,0,undefined,500)、mkWall の floor・thick・color 省略
//   - 基礎(foundation)を1つ置いた状態の exterior-stair と ramp(targetHeight が基礎の高さを引く)
//   - 階ごとの高さを ON、2階の壁の高さ 2600 での mkWall(0,0,1000,0,2)
//
// 正解を作り直すのは、物の中身を**意図して**変えたときだけ:
//   UPDATE_GOLDEN=1 PLAYWRIGHT_MODULE=… sh tools/run_browser_tests.sh factories-golden
// 「テストが落ちたから合わせた」で作り直してはいけない。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'fixtures', 'factories');
const GOLDEN = join(DIR, 'golden.json');
const APP = process.env.APP_URL || 'http://localhost:8932/';
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const T = { timeout: 60000 };

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// ページの中で集める。JSON にしたとき消える値(undefined・NaN・Infinity)も、消さずに印を付けて残す。
function collect() {
  const mark = (k, v) => {
    if (v === undefined) return '__undefined__';
    if (typeof v === 'number' && !isFinite(v)) return '__' + String(v) + '__';
    return v;
  };
  const clean = (o, skip) => JSON.parse(JSON.stringify(o, (k, v) => (skip && skip.includes(k) ? undefined : mark(k, v))));
  const idDelta = (fn) => {
    const before = nextId;
    const r = fn();
    return { r, delta: nextId - before };
  };

  const types = Array.from(new Set([
    ...Object.keys(ISIZES), ...Object.keys(FMP_ITEMS), ...Object.keys(LEGACY_FMP_TYPE_MAP), 'no-such-type',
  ])).sort();

  const items = {};
  const nextIdDelta = { items: {}, walls: [], foundationItems: {}, perFloorWall: null };
  for (const type of types) {
    const a = idDelta(() => mkItem(type, 100, 200, 90, 2));
    const b = idDelta(() => mkItem(type, 0, 0, 0, 1, 1234, 567));
    const strip = (o) => { const c = Object.assign({}, o); delete c.id; return c; };
    items[type] = {
      a: clean(strip(a.r)), aKeys: Object.keys(strip(a.r)),
      b: clean(strip(b.r)), bKeys: Object.keys(strip(b.r)),
    };
    nextIdDelta.items[type] = [a.delta, b.delta];
  }

  const walls = [];
  const w1 = idDelta(() => mkWall(0, 0, 1000, 0));
  const w2 = idDelta(() => mkWall(0, 0, 0, 1000, 2, 90, '#123456'));
  for (const w of [w1, w2]) {
    const c = Object.assign({}, w.r); delete c.id;
    walls.push({ value: clean(c, ['_texObj']), keys: Object.keys(c) });
    nextIdDelta.walls.push(w.delta);
  }

  // 引数を省いた呼び出し(rot・floor・w・d が undefined のときの既定)。既存の記録の外に足す。
  const omitted = { items: {}, walls: [] };
  const omittedDelta = { items: {}, walls: [] };
  for (const type of ['bed-s', 'window', 'door-swing', 'roof', 'no-such-type']) {
    const c = idDelta(() => mkItem(type, 0, 0));
    const d = idDelta(() => mkItem(type, 0, 0, 0, undefined, 500));
    const strip = (o) => { const x = Object.assign({}, o); delete x.id; return x; };
    omitted.items[type] = {
      c: clean(strip(c.r)), cKeys: Object.keys(strip(c.r)),
      d: clean(strip(d.r)), dKeys: Object.keys(strip(d.r)),
    };
    omittedDelta.items[type] = [c.delta, d.delta];
  }
  for (const o of [idDelta(() => mkWall(0, 0, 1000, 0, undefined, undefined, undefined)), idDelta(() => mkWall(0, 0, 1000, 0, 3))]) {
    const c = Object.assign({}, o.r); delete c.id;
    omitted.walls.push({ value: clean(c, ['_texObj']), keys: Object.keys(c) });
    omittedDelta.walls.push(o.delta);
  }

  // 基礎を1つ置いた状態(targetHeight が基礎の高さを引く)。置いたものは後で外す。
  const foundationItems = {};
  const savedItems = DATA.items;
  DATA.items = savedItems.concat([{ id: -1, type: 'foundation', foundationHeight: 600, x: 0, y: 0, w: 1000, d: 1000, floor: 1 }]);
  try {
    for (const type of ['exterior-stair', 'ramp']) {
      const o = idDelta(() => mkItem(type, 100, 200, 90, 1));
      const c = Object.assign({}, o.r); delete c.id;
      foundationItems[type] = { value: clean(c), keys: Object.keys(c), foundationHeightMm: foundationHeightMm() };
      nextIdDelta.foundationItems[type] = o.delta;
    }
  } finally {
    DATA.items = savedItems;
  }

  // 階ごとの高さを ON、2階の壁の高さ 2600。終わったら戻す。
  let perFloorWall;
  const savedHd = DATA.heightDefaults, savedFloors = DATA.floors;
  DATA.heightDefaults = Object.assign({}, savedHd || {}, { perFloor: true });
  DATA.floors = Object.assign({}, savedFloors || {}, { '2': Object.assign({}, (savedFloors || {})['2'] || {}, { wallHeight: 2600 }) });
  try {
    const o = idDelta(() => mkWall(0, 0, 1000, 0, 2));
    const c = Object.assign({}, o.r); delete c.id;
    perFloorWall = { value: clean(c, ['_texObj']), keys: Object.keys(c) };
    nextIdDelta.perFloorWall = o.delta;
  } finally {
    DATA.heightDefaults = savedHd;
    DATA.floors = savedFloors;
  }

  return {
    counts: { types: types.length, isizes: Object.keys(ISIZES).length, fmpItems: Object.keys(FMP_ITEMS).length, legacy: Object.keys(LEGACY_FMP_TYPE_MAP).length },
    types, walls, items, foundationItems, perFloorWall, nextIdDelta, omitted, omittedDelta,
  };
}

// 白紙で起動し、モデルのカタログ(FMP_ITEMS)が読み終わるまで待つ。
// FMP_ITEMS は loadFurnitureMegaLibrary が3つの manifest(と分類・色・セット)を全部読んでから
// applyFurnitureMegaManifest で1回だけ入れ直す。空のうちは種類の一覧が足りないので、
// 件数が0より多くなるのを待ち、さらに件数が一定になったことを見てから集める。
async function openBlankAndCollect(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(APP);
    await page.waitForFunction(() => window.DATA && DATA.walls && window.ST, null, T);
    await page.locator('#preset-choice-modal.show').waitFor(T);
    await page.locator('.preset-blank-btn', { hasText: '白紙から始める' }).click();
    await page.waitForFunction(() => window.PRESET_CURRENT === 'blank' && _defaultPlanPending === false, null, T);
    await page.locator('#preset-choice-modal').waitFor({ state: 'hidden', ...T });
    await page.waitForFunction(() => typeof FMP_ITEMS === 'object' && Object.keys(FMP_ITEMS).length > 0
      && typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_FINISHES !== undefined, null, T);
    // 件数が 1 秒のあいだ変わらなくなるまで待つ
    let last = -1, same = 0;
    for (let i = 0; i < 60 && same < 5; i++) {
      const n = await page.evaluate(() => Object.keys(FMP_ITEMS).length);
      same = n === last ? same + 1 : 0;
      last = n;
      await page.waitForTimeout(200);
    }
    assert.ok(same >= 5, 'FMP_ITEMS の件数が落ち着かない');
    const data = await page.evaluate(collect);
    return { data, errors };
  } finally {
    await context.close();
  }
}

function describeDiff(want, got) {
  const out = [];
  const typeList = (o) => Object.keys(o);
  const cmp = (label, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label}: 期待 ${JSON.stringify(a)} / 実際 ${JSON.stringify(b)}`);
  };
  cmp('counts', want.counts, got.counts);
  const wt = typeList(want.items), gt = typeList(got.items);
  const missing = wt.filter((t) => !gt.includes(t)), extra = gt.filter((t) => !wt.includes(t));
  if (missing.length || extra.length) out.push(`種類: 足りない ${JSON.stringify(missing)} / 余分 ${JSON.stringify(extra)}`);
  for (const t of wt.filter((x) => gt.includes(x))) {
    for (const k of ['a', 'aKeys', 'b', 'bKeys']) {
      if (JSON.stringify(want.items[t][k]) === JSON.stringify(got.items[t][k])) continue;
      if (k.endsWith('Keys')) { out.push(`${t}.${k}: 項目の並び 期待 ${JSON.stringify(want.items[t][k])} / 実際 ${JSON.stringify(got.items[t][k])}`); continue; }
      const w = want.items[t][k], g = got.items[t][k];
      const keys = Array.from(new Set([...Object.keys(w), ...Object.keys(g)]));
      for (const f of keys) cmp(`${t}.${k}.${f}`, w[f], g[f]);
    }
  }
  cmp('walls', want.walls, got.walls);
  cmp('foundationItems', want.foundationItems, got.foundationItems);
  cmp('perFloorWall', want.perFloorWall, got.perFloorWall);
  cmp('nextIdDelta', want.nextIdDelta, got.nextIdDelta);
  cmp('omitted', want.omitted, got.omitted);
  cmp('omittedDelta', want.omittedDelta, got.omittedDelta);
  return out.join('\n    ');
}

const browser = await chromium.launch();
try {
  const { data, errors } = await openBlankAndCollect(browser);
  assert.equal(errors.length, 0, 'ページで例外: ' + errors.join(' / '));
  // どの種類も、呼ぶたびに id は 1 だけ進む(物を作る側の約束)
  for (const [t, d] of Object.entries(data.nextIdDelta.items)) assert.deepEqual(d, [1, 1], `${t}: nextId の進み方が 1 でない: ${d}`);
  assert.deepEqual(data.nextIdDelta.walls, [1, 1]);
  assert.ok(data.counts.fmpItems > 0 && data.counts.types > data.counts.fmpItems, '種類の数が少なすぎる');
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify(data, null, 1) + '\n');
    console.log(`正解を書き出した: ${GOLDEN} (種類 ${data.counts.types}、うち FMP ${data.counts.fmpItems})`);
  } else {
    assert.ok(existsSync(GOLDEN), 'golden.json が無い');
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const diff = describeDiff(want, data);
    assert.equal(diff, '', '今の出力が正解と違う:\n    ' + diff);
    console.log(`mkWall / mkItem: ${data.counts.types} 種類 × 2通りと、壁・基礎つき・階ごとの高さの出力が、記録と一致した`);
  }
} finally {
  await browser.close();
}
