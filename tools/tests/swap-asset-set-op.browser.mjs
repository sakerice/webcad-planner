// AI の操作 swapAssetSet(家具の一括差し替え)が、画面の「表示するセット」の下の「一括差し替え」と同じプランを作るか。
//
// なぜ要るか: 2026-11-26、利用者に「AI から一括差し替えが使えない」と言われ、AI(チャット・MCP)の操作に足した。
// 決め方は画面と同じ部品(assets/js/asset-swap.js の plan)を使うが、画面は確認の一覧から「差し替える」を押す経路、
// AI は操作の経路で書き込むので、同じ JSON になることを実物の画面で確かめる。
//
// やること(凍結間取り tools/tests/fixtures/house-2f.json。既定プランと同じ形の2階建て):
//   (a) 画面: 一括差し替えを開き(AssetSwap.open)、確認の一覧の「差し替える」を押す
//   (b) チャットの ctx(planChatCtx)で swapAssetSet を写しに当てる
//   (c) Worker の ctx(worker/plan-ctx-factory.mjs。MCP と共同編集が使う)で同じ操作を当てる
//   - (a)(b) のプラン全体の JSON("_" で始まる一時の欄は除く)が同じ。(c) も同じか、断る(断る文で始まる)
//   - ロックした家具は (b)(c) で替わらない。知らないセット名は候補つきで失敗する
//
// sh tools/run_browser_tests.sh swap-asset-set-op
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const T = { timeout: 60000 };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  // セットのカタログ(洋館・古民家の manifest)まで読み終わるのを待つ
  await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items
    && AssetSets.sets().some((s) => s.swap) && Object.keys(FMP_ITEMS).some((k) => k.indexOf('rpg-mansion-') === 0) && Object.keys(FMP_ITEMS).some((k) => k.indexOf('kominka-') === 0), null, T);

  const out = await page.evaluate(async ({ plan, app }) => {
    const F = await import(new URL('worker/plan-ctx-factory.mjs', app).href);
    const get = async (rel) => (await fetch(new URL(rel, app).href)).json();
    const tools = F.createPlanCtxTools({
      catalog: await get('assets/data/worker-catalog.json'), furniture: await get('assets/data/worker-furniture.json'), tags: await get('assets/models/tags.json'),
      AssetSwap, Operations: PlanCoreOperations, Settable: PlanSettable, Knowledge: ObjectKnowledge, FreeApply: PlanFreeApply,
      HeightModel, Summary: ChatPlanSummary, Inspect: PlanCoreInspect, Schema: PlanSchema, Check: PlanCheck, Structure: PlanStructure, SetbackLaw,
    });
    const json = (v) => JSON.stringify(v, (k, x) => (k.charAt(0) === '_' ? undefined : x));
    // 画面でプランを開いた状態(読み込みの片付けを通した後)を土台にする
    ['walls', 'rooms', 'items', 'floorMetadata', 'exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail'].forEach((k) => { if (plan[k] !== undefined) DATA[k] = plan[k]; });
    normalizeLoadedPlan({ resetHeights: false, restoreView: false });
    const baseJson = json(DATA);
    const firstId = F.firstNewId(JSON.parse(baseJson));
    const reset = (p) => { DATA = JSON.parse(p || baseJson); nextId = firstId; ST.selected = null; };
    const res = { sets: [] };
    const diffItems = (a, b) => {
      const A = JSON.parse(a), B = JSON.parse(b), m = new Map(A.items.map((o) => [String(o.id), json(o)])), d = [];
      B.items.forEach((o) => { if (m.get(String(o.id)) !== json(o)) d.push({ id: o.id, screen: m.get(String(o.id)) || null, other: json(o) }); });
      if (A.items.length !== B.items.length) d.push({ count: [A.items.length, B.items.length] });
      Object.keys(Object.assign({}, A, B)).forEach((k) => { if (k !== 'items' && json(A[k]) !== json(B[k])) d.push({ k }); });
      return d.slice(0, 3);
    };
    for (const set of ['rpg-mansion', 'kominka']) {
      // (a) 画面の一括差し替え: 確認の一覧を開き、全部にチェックが付いたまま「差し替える」を押す
      reset();
      AssetSwap.open(set);
      const rows = document.querySelectorAll('#asset-swap-modal input[data-swap-id]').length;
      document.querySelector('#asset-swap-modal .asset-swap-apply').click();
      const screen = json(DATA);
      // (b) チャットの ctx
      reset();
      const c = PlanCoreOperations.applyOperations(DATA, [{ op: 'swapAssetSet', args: { set } }], planChatCtx());
      const chat = json(c.plan);
      // (c) Worker の ctx
      const w = tools.workerApply(JSON.parse(baseJson), [{ op: 'swapAssetSet', args: { set } }]);
      const swapped = JSON.parse(chat).items.filter((it) => it.type.indexOf(set + '-') === 0).length;
      res.sets.push({
        set, rows, swapped, chatErrors: c.errors, warnings: c.warnings,
        screenChanged: screen !== baseJson, sameAsScreen: screen === chat, diff: screen === chat ? [] : diffItems(screen, chat),
        worker: w.errors.length ? { refused: w.errors[0].message } : { same: json(w.plan) === chat && json([w.changedIds, w.removedIds, w.warnings]) === json([c.changedIds, c.removedIds, c.warnings]), diff: json(w.plan) === chat ? [] : diffItems(chat, json(w.plan)) },
      });
    }
    // ロックした家具は替えない(チャット・Worker とも)
    {
      const p = JSON.parse(baseJson);
      const sofa = p.items.find((it) => /Sofa/.test(it.type));
      sofa.locked = true;
      reset(JSON.stringify(p));
      const c = PlanCoreOperations.applyOperations(DATA, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }], planChatCtx());
      const w = tools.workerApply(p, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion' } }]);
      const after = (r) => json(r.plan.items.find((it) => it.id === sofa.id));
      res.locked = { chat: after(c) === json(sofa), worker: after(w) === json(sofa), changed: c.changedIds.length, errors: c.errors.concat(w.errors) };
      const named = PlanCoreOperations.applyOperations(DATA, [{ op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [sofa.id] } }], planChatCtx());
      res.lockedNamed = named.errors.map((e) => e.message);
    }
    // 洗面台だけを選ぶと、上の洗面ボウルも一緒に外す(全部を替えたときと同じ洗面台)。ボウルを除く・ロックすると台ごと残す。
    // チャットと Worker で同じ JSON(2026-11-26 のレビューで、ボウルが浮いたまま二重に残っていた場面)。
    {
      const p = JSON.parse(baseJson);
      const vanity = p.items.find((it) => it.type === 'fmp-BathroomVanity07');
      const bowl = p.items.find((it) => it.type === 'fmp-WashBasin01');
      res.vanity = [];
      for (const [label, args, lock] of [['台だけ', { set: 'rpg-mansion', ids: [String(vanity.id)] }, false],
        ['ボウルを除く', { set: 'rpg-mansion', ids: [String(vanity.id)], except: [String(bowl.id)] }, false],
        ['ボウルをロック', { set: 'rpg-mansion', ids: [String(vanity.id)] }, true],
        ['ボウルだけ', { set: 'rpg-mansion', ids: [String(bowl.id)] }, false]]) {
        const q = JSON.parse(baseJson);
        if (lock) q.items.find((it) => it.id === bowl.id).locked = true;
        reset(JSON.stringify(q));
        const c = PlanCoreOperations.applyOperations(DATA, [{ op: 'swapAssetSet', args }], planChatCtx());
        const w = tools.workerApply(q, [{ op: 'swapAssetSet', args }]);
        const v = c.plan.items.find((it) => it.id === vanity.id), b = c.plan.items.find((it) => it.id === bowl.id);
        res.vanity.push({ label, errors: c.errors, vanitySwapped: /^rpg-mansion-/.test(v.type), bowlLeft: !!b,
          same: json([w.plan, w.changedIds, w.removedIds, w.warnings]) === json([c.plan, c.changedIds, c.removedIds, c.warnings]), warnings: c.warnings.filter((x) => x.includes('id ' + bowl.id) || x.includes('台 id ' + vanity.id)) });
      }
    }
    // 知らないセット名
    {
      reset();
      const c = PlanCoreOperations.applyOperations(DATA, [{ op: 'swapAssetSet', args: { set: 'ゴシック' } }], planChatCtx());
      const w = tools.workerApply(JSON.parse(baseJson), [{ op: 'swapAssetSet', args: { set: 'ゴシック' } }]);
      res.unknown = { chat: c.errors, worker: w.errors, untouched: json(c.plan) === baseJson };
    }
    reset();
    return res;
  }, { plan: PLAN, app: APP });

  for (const s of out.sets) {
    console.log(`${s.set}: 画面の確認の一覧 ${s.rows} 行、替わった物 ${s.swapped}、画面と同じ ${s.sameAsScreen}、Worker ${JSON.stringify(s.worker).slice(0, 300)}`);
    s.warnings.forEach((w) => console.log('   warnings: ' + w.slice(0, 200)));
  }
  console.log('ロック: ' + JSON.stringify(out.locked) + ' 名指し: ' + JSON.stringify(out.lockedNamed));
  console.log('知らないセット: ' + JSON.stringify(out.unknown.chat));
  for (const s of out.sets) {
    assert.deepEqual(s.chatErrors, [], s.set + ' でチャットの操作が失敗した');
    assert.ok(s.rows > 0 && s.swapped > 0 && s.screenChanged, s.set + ' で差し替えが起きていない');
    assert.equal(s.sameAsScreen, true, s.set + ' で画面の一括差し替えと違う: ' + JSON.stringify(s.diff).slice(0, 1500));
    if (s.worker.refused) assert.match(s.worker.refused, /^この操作は house-planner の画面で行ってください/, s.set + ' の Worker の失敗が断る文でない');
    else assert.equal(s.worker.same, true, s.set + ' で Worker が違う: ' + JSON.stringify(s.worker.diff).slice(0, 1500));
  }
  assert.ok(!out.sets.find((s) => s.set === 'rpg-mansion').worker.refused, '洋館への差し替えを Worker が断った');
  assert.deepEqual([out.locked.chat, out.locked.worker], [true, true], 'ロックしたソファが替わった');
  assert.ok(out.locked.changed > 0 && out.locked.errors.length === 0, 'ロックした物のほかは替わる');
  console.log('洗面台: ' + JSON.stringify(out.vanity));
  assert.deepEqual(out.vanity.map((v) => [v.label, v.errors.length, v.vanitySwapped, v.bowlLeft, v.same, v.warnings.length > 0]),
    [['台だけ', 0, true, false, true, true], ['ボウルを除く', 0, false, true, true, true], ['ボウルをロック', 0, false, true, true, true], ['ボウルだけ', 0, false, true, true, true]], '洗面台だけ・ボウルだけを選んだときの扱い');
  assert.equal(out.lockedNamed.length, 1);
  assert.match(out.lockedNamed[0], /ロック/);
  assert.equal(out.unknown.chat.length, 1);
  assert.deepEqual(out.unknown.chat[0].candidates, ['rpg-mansion', 'kominka']);
  assert.equal(JSON.stringify(out.unknown.chat), JSON.stringify(out.unknown.worker), '知らないセットの失敗が Worker とチャットで違う');
  assert.equal(out.unknown.untouched, true);
  assert.deepEqual(errors, []);
  console.log('ok swap-asset-set-op');
} finally {
  await browser.close();
}
