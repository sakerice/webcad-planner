// AI の操作 setAppearance(内観・外観・屋根のカラー設定)と applyBuildingStyle(建物の様式)が、画面で同じことをしたときと
// 同じプランを作るか。Worker(MCP・共同編集)の ctx とも比べる。
//
// なぜ要るか: 2026-11-26、AI から壁の色・建物の様式を変えられるようにした。書き込みは画面と同じ関数
// (PlanCoreOperations.writeAppearance・BuildingStyle.applyPlan)だが、画面は設定欄を押す順に書き、AI は操作で書くので、
// 押す順(外観は「家全体」「階」の印を先に付ける)まで含めて同じ JSON になることを実物の画面で確かめる。
//
// やること(凍結間取り tools/tests/fixtures/house-2f.json):
//   カラー設定: (a) 画面の「内観／外観／屋根カラー設定」の欄を押す (b) チャットの ctx で setAppearance (c) Worker の ctx で同じ操作
//     → (a)(b)(c) のプラン全体の JSON が同じ。知らない素材は候補つきで失敗(Worker も同じ文)。
//   建物の様式: (a) 画面の「建物の仕上げを替える」の確認から「切り替える」(部位を外す場合も) (b) チャットの ctx で applyBuildingStyle
//     → 同じ JSON。(c) Worker は理由つきで断る。ロックした部屋・扉は変えない。知らない様式は候補つきで失敗。
//
// sh tools/run_browser_tests.sh style-appearance-op
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

// 設定欄で押す手順と、同じことを頼む操作の引数。step は [欄の onchange/oninput に含まれる文字, 入れる値]。
const APPEARANCE = [
  { mode: 'interior', args: { part: 'interior', color: '#336699' }, steps: [["updateInteriorSetting('whole','color'", '#336699']] },
  { mode: 'interior', args: { part: 'interior', texture: 'mansion_damask_wallpaper' }, steps: [["updateInteriorSetting('whole','texture'", 'mansion_damask_wallpaper']] },
  { mode: 'interior', args: { part: 'interior', floor: 2, color: '#aa8866', texture: 'kominka_juraku' }, steps: [["updateInteriorSetting('floor','color',this.value,2", '#aa8866'], ["updateInteriorSetting('floor','texture',this.value||null,2)", 'kominka_juraku']] },
  { mode: 'interior', args: { part: 'interior', floor: 1, texture: '' }, steps: [["updateInteriorSetting('floor','texture',this.value||null,1)", '']] },
  { mode: 'exterior', args: { part: 'exterior', color: '#334455' }, steps: [["updateExteriorSetting('whole','linked'", true], ["updateExteriorSetting('whole','color'", '#334455']] },
  { mode: 'exterior', args: { part: 'exterior', texture: 'mansion_brick_red' }, steps: [["updateExteriorSetting('whole','linked'", true], ["updateExteriorSetting('whole','texture'", 'mansion_brick_red']] },
  { mode: 'exterior', args: { part: 'exterior', floor: 2, color: '#223344', texture: 'siding' }, steps: [["updateExteriorSetting('whole','linked'", false], ["updateExteriorSetting('floor','linked',this.checked,2)", true], ["updateExteriorSetting('floor','color',this.value,2", '#223344'], ["updateExteriorSetting('floor','texture',this.value||null,2)", 'siding']] },
  { mode: 'roof', args: { part: 'roof', color: '#5a2e1e' }, steps: [["updateRoofAppearance('whole','color'", '#5a2e1e']] },
  { mode: 'roof', args: { part: 'roof', texture: 'roof_copper_patina', sheen: 'metal' }, steps: [["updateRoofAppearance('whole','texture'", 'roof_copper_patina'], ["updateRoofAppearance('whole','sheen'", 'metal']] },
  { mode: 'roof', args: { part: 'roof', floor: 2, sheen: 'satin' }, steps: [["updateRoofAppearance('floor','sheen',this.value||null,2)", 'satin']] },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items
    && AssetSets.sets().some((s) => s.style) && Object.keys(FMP_ITEMS).some((k) => k.indexOf('kominka-') === 0), null, T);

  const out = await page.evaluate(async ({ plan, app, cases }) => {
    const F = await import(new URL('worker/plan-ctx-factory.mjs', app).href);
    const get = async (rel) => (await fetch(new URL(rel, app).href)).json();
    const tools = F.createPlanCtxTools({
      catalog: await get('assets/data/worker-catalog.json'), furniture: await get('assets/data/worker-furniture.json'), tags: await get('assets/models/tags.json'),
      AssetSwap, Operations: PlanCoreOperations, Settable: PlanSettable, Knowledge: ObjectKnowledge, FreeApply: PlanFreeApply,
      HeightModel, Summary: ChatPlanSummary, Inspect: PlanCoreInspect, Schema: PlanSchema, Check: PlanCheck, Structure: PlanStructure, SetbackLaw,
    });
    const json = (v) => JSON.stringify(v, (k, x) => (k.charAt(0) === '_' ? undefined : x));
    ['walls', 'rooms', 'items', 'floorMetadata', 'exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail'].forEach((k) => { if (plan[k] !== undefined) DATA[k] = plan[k]; });
    normalizeLoadedPlan({ resetHeights: false, restoreView: false });
    // 画面で3つのカラー設定の欄を一度開いた状態(ensure* で欄がそろった状態)を土台にする
    ['interior', 'roof', 'exterior'].forEach((m) => renderExteriorWallPanel(m));
    const baseJson = json(DATA);
    const reset = (p) => { DATA = JSON.parse(p || baseJson); nextId = F.firstNewId(DATA); ST.selected = null; };
    const diff = (a, b) => {
      const A = JSON.parse(a), B = JSON.parse(b), d = [];
      Object.keys(Object.assign({}, A, B)).forEach((k) => {
        if (json(A[k]) === json(B[k])) return;
        if (Array.isArray(A[k])) {
          const m = new Map(A[k].map((o) => [String(o.id), json(o)]));
          (B[k] || []).forEach((o) => { if (m.get(String(o.id)) !== json(o)) d.push({ k, id: o.id, a: m.get(String(o.id)), b: json(o) }); });
        } else d.push({ k, a: json(A[k]).slice(0, 600), b: json(B[k]).slice(0, 600) });
      });
      return d.slice(0, 3);
    };
    const res = { appearance: [], style: [] };

    // ── カラー設定 ──
    for (const c of cases) {
      reset();
      // 設定欄は書き込みのあと、今開いている種類(APPEARANCE_PANEL_MODE)で描き直す
      APPEARANCE_PANEL_MODE = c.mode;
      renderExteriorWallPanel(c.mode);
      const body = document.getElementById('exterior-wall-panel-body');
      let panelError = null;
      for (const [needle, value] of c.steps) {
        const el = Array.from(body.querySelectorAll('[onchange],[oninput]')).find((e) => ((e.getAttribute('onchange') || '') + (e.getAttribute('oninput') || '')).indexOf(needle) >= 0);
        if (!el) { panelError = '欄が無い: ' + needle; break; }
        if (el.disabled) { panelError = '欄が押せない: ' + needle; break; }
        if (el.type === 'checkbox') { if (el.checked === value) continue; el.checked = value; }
        else {
          if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === value)) { panelError = '選択肢が無い: ' + needle + ' ' + value; break; }
          el.value = value;
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const panel = json(DATA);
      reset();
      const ch = PlanCoreOperations.applyOperations(DATA, [{ op: 'setAppearance', args: c.args }], planChatCtx());
      const chat = json(ch.plan);
      const w = tools.workerApply(JSON.parse(baseJson), [{ op: 'setAppearance', args: c.args }]);
      res.appearance.push({ args: c.args, panelError, chatErrors: ch.errors, workerErrors: w.errors, changed: panel !== baseJson,
        samePanel: panel === chat, sameWorker: json(w.plan) === chat, diffPanel: panel === chat ? [] : diff(panel, chat), diffWorker: json(w.plan) === chat ? [] : diff(chat, json(w.plan)) });
    }
    {
      reset();
      const ch = PlanCoreOperations.applyOperations(DATA, [{ op: 'setAppearance', args: { part: 'roof', texture: 'siding' } }], planChatCtx());
      const w = tools.workerApply(JSON.parse(baseJson), [{ op: 'setAppearance', args: { part: 'roof', texture: 'siding' } }]);
      res.badTexture = { chat: ch.errors, same: json(ch.errors) === json(w.errors) };
    }

    // ── 建物の様式 ──
    const styleCase = async (set, uncheck, args, label, prep) => {
      const base = prep ? prep(JSON.parse(baseJson)) : JSON.parse(baseJson);
      const b = json(base);
      reset(b);
      BuildingStyle.open(set);
      document.querySelectorAll('#asset-swap-modal input[data-style-part]').forEach((x) => { if (uncheck.indexOf(x.dataset.stylePart) >= 0) x.checked = false; });
      document.querySelector('#asset-swap-modal .asset-swap-apply').click();
      const screen = json(DATA);
      reset(b);
      const ch = PlanCoreOperations.applyOperations(DATA, [{ op: 'applyBuildingStyle', args }], planChatCtx());
      const chat = json(ch.plan);
      const w = tools.workerApply(JSON.parse(b), [{ op: 'applyBuildingStyle', args }]);
      res.style.push({ label, chatErrors: ch.errors, changed: screen !== b, same: screen === chat, diff: screen === chat ? [] : diff(screen, chat),
        worker: w.errors.map((e) => e.message), changedIds: ch.changedIds.length, plan: label === 'ロック' ? chat : null, base: label === 'ロック' ? b : null });
    };
    await styleCase('rpg-mansion', [], { set: 'rpg-mansion' }, '洋館');
    await styleCase('kominka', [], { set: '日本古民家' }, '古民家(名前)');
    await styleCase('kominka', ['doors', 'windows', 'exterior'], { set: 'kominka', parts: ['roof', 'interior', 'floor'] }, '古民家(部位を選ぶ)');
    // ロック: 部屋1つと開き戸1つをロックすると、様式でも変わらない(画面の一括の切り替えはロックを見ないので、ここは画面と比べない)
    {
      const p = JSON.parse(baseJson);
      const room = p.rooms.find((r) => r.floor === 1 && /洋室|寝室|LDK|リビング/.test(r.n || '')) || p.rooms[0];
      const door = p.items.find((it) => it.type === 'door-swing');
      room.locked = true; door.locked = true;
      reset(JSON.stringify(p));
      const ch = PlanCoreOperations.applyOperations(DATA, [{ op: 'applyBuildingStyle', args: { set: 'rpg-mansion' } }], planChatCtx());
      const after = ch.plan;
      res.locked = { errors: ch.errors, room: json(after.rooms.find((r) => r.id === room.id)) === json(room), door: json(after.items.find((it) => it.id === door.id)) === json(door),
        others: after.items.filter((it) => it.openingModel && /^rpg-mansion-/.test(it.openingModel)).length };
    }
    {
      reset();
      const ch = PlanCoreOperations.applyOperations(DATA, [{ op: 'applyBuildingStyle', args: { set: 'ゴシック' } }], planChatCtx());
      const w = tools.workerApply(JSON.parse(baseJson), [{ op: 'applyBuildingStyle', args: { set: 'ゴシック' } }]);
      res.unknownStyle = { chat: ch.errors, same: json(ch.errors) === json(w.errors), untouched: json(ch.plan) === baseJson };
    }
    reset();
    return res;
  }, { plan: PLAN, app: APP, cases: APPEARANCE });

  out.appearance.forEach((a) => console.log(`setAppearance ${JSON.stringify(a.args)}: 画面と同じ ${a.samePanel}、Worker と同じ ${a.sameWorker}${a.panelError ? ' 欄: ' + a.panelError : ''}`));
  out.style.forEach((s) => console.log(`applyBuildingStyle ${s.label}: 画面と同じ ${s.same}、変わった物 ${s.changedIds}、Worker ${JSON.stringify(s.worker)}`));
  console.log('ロック: ' + JSON.stringify(out.locked) + ' 知らない様式: ' + JSON.stringify(out.unknownStyle.chat));
  for (const a of out.appearance) {
    assert.equal(a.panelError, null, JSON.stringify(a.args) + ' ' + a.panelError);
    assert.deepEqual(a.chatErrors, [], JSON.stringify(a.args));
    assert.deepEqual(a.workerErrors, [], JSON.stringify(a.args));
    assert.ok(a.changed, JSON.stringify(a.args) + ' で画面の欄を押してもプランが変わらない');
    assert.equal(a.samePanel, true, JSON.stringify(a.args) + ' で画面の欄と違う: ' + JSON.stringify(a.diffPanel));
    assert.equal(a.sameWorker, true, JSON.stringify(a.args) + ' で Worker と違う: ' + JSON.stringify(a.diffWorker));
  }
  assert.equal(out.badTexture.chat.length, 1);
  assert.ok(out.badTexture.chat[0].candidates.includes('roof_tile'));
  assert.equal(out.badTexture.same, true, '知らない素材の失敗が Worker とチャットで違う');
  for (const s of out.style) {
    assert.deepEqual(s.chatErrors, [], s.label);
    assert.ok(s.changed && s.changedIds > 0, s.label + ' で切り替わっていない');
    assert.equal(s.same, true, s.label + ' で画面の様式の切り替えと違う: ' + JSON.stringify(s.diff).slice(0, 1500));
    assert.equal(s.worker.length, 1, s.label + ' で Worker が断っていない');
    assert.match(s.worker[0], /^この操作は house-planner の画面で行ってください\(建物の様式/, s.label);
  }
  assert.deepEqual(out.locked.errors, []);
  assert.deepEqual([out.locked.room, out.locked.door], [true, true], 'ロックした部屋・扉が変わった');
  assert.ok(out.locked.others > 0, 'ロックしていない扉・窓は替わる');
  assert.deepEqual(out.unknownStyle.chat[0].candidates, ['rpg-mansion', 'kominka']);
  assert.equal(out.unknownStyle.same, true);
  assert.equal(out.unknownStyle.untouched, true);
  assert.deepEqual(errors, []);
  console.log('ok style-appearance-op');
} finally {
  await browser.close();
}
