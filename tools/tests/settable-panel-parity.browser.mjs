// チャット／外の AI で変えられる項目(assets/js/plan-settable.js の SETTINGS)を、利用者が設定パネルで変えたときと、
// AI に頼んで変えたとき(共通の操作 applyOperations の setProps)で、同じプランになることを実物の画面で確かめる。
//
// なぜ要るか: 2026-11-25、AI に頼んで床材を変えても画面の床が変わらず、AI は変えたと答えていた。床材の欄が2つあり
// (古い形は部屋の texture に床材のキー、新しい形は floorMaterial)、描画は texture を先に読んでいた。検査は
// 「欄に値が入ったか」しか見ておらず、検査の土台も新しい形のプランだけだったので、見落とした。
//
// やること(項目と値の組ごとに、同じ土台から2回):
//   (a) パネル: 物を選んで設定パネルを開き、表の panel に書いた入口の入力欄・選択欄に値を入れて change を起こす。
//   (b) AI: チャットの入口(ChatUI.send)に頼み、偽の AI が setProps {id, set:{項目: 値}} を返す。チャットは写しに当てて、
//       画面のプランに取り込む(applyChatResult)。本物の AI は呼ばない。
//   - 2つのプラン全体(JSON。"_" で始まる一時の欄は除く)が同じであること。
//   - 描画が読む値(床材なら roomFloorMaterialKey と makeRoomFloorMaterial が引く画像)が同じであること。
//     床材は、選んだ値が描画に届いていること(欄に入っただけでなく、画面の床が変わること)も見る。
// 土台: 凍結間取り tools/tests/fixtures/house-2f.json(既定プランと同じ古い形。部屋の texture に床材のキー)を、
// 製品の「読込」(#import-file)で開く。表にある種類のうち間取りに無い物(木のフェンス・スロープ)は、画面の道具(placeItem)で置き足す。
//
// 項目は SETTINGS から機械的に並べる。値の表(NUM_VALUES)に無い数の項目を表に足すと、ここで落ちる(値を決めて足すこと)。
// 比べられない項目は SKIP に理由を書いて外す(黙って外さない)。食い違いは失敗にする。
//
// sh tools/run_browser_tests.sh settable-panel-parity
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { sseFor } = require('./chat-sse-fixtures.cjs');
const PlanSettable = require('../../assets/js/plan-settable.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'house-2f.json');
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 数の項目に入れる値(範囲の中で、土台の値と違うもの)。
const NUM_VALUES = {
  wallHeight: 2000, thick: 150, ceilingHeight: 2300, windowSill: 600, windowHeight: 1000, doorHeight: 2000,
  fenceHeight: 1500, latticeHeight: 1600, targetHeight: 300, accessSteps: 2,
};
const TEXT_VALUES = { name: '駐車スペース' };
// 比べない項目と理由。
const SKIP = {
  // 区画(site-zone)は敷地(site-rect)の中の siteZones の1つで、物ではない。setProps は site-rect を 'site' として引くので、
  // 区画の名前は set で書けない(読み取りの取り込みだけが使う)。書けないことは下で確かめる(書けるようになったら比べる)。
  'object.name': '区画の名前は setProps で書けない(敷地は site として引かれる)',
};

// 分かっている食い違い。直さずに残した理由をここに書き、報告にも載せる。検査は、食い違いの中身がここに書いたとおりで
// あることを確かめる(変われば落ちる。直したらここから消す)。
//   kind 'stored-only': 保存される欄の値だけが違い、描画が読む値は同じ。違いはその項目の欄だけ。
//   kind 'ai-refused' : AI(setProps)では当てられず、道具が失敗を返す(プランは変わらない)。パネルでは変わる。
// 2026-11-25 に、階段の手すり「なし」・形「ひな壇」の書き方の違いと、土間(floorLevel)を AI が当てられないことを直して、
// ここは空になった(operations.js の applyProp で既定の値は欄ごと消す。土間は hooks.set.floorLevel)。
const KNOWN = {};

// 2つのプランの違いを「集まり id 欄: 前→後」の並びにする(物の並び順は見ない。足した・消した物も1行)。
function diffPlans(aJson, bJson) {
  const a = JSON.parse(aJson), b = JSON.parse(bJson), out = [];
  const enc = (v) => (v === undefined ? '-' : JSON.stringify(v));
  ['walls', 'rooms', 'items'].forEach((coll) => {
    const ma = new Map((a[coll] || []).map((o) => [String(o.id), o]));
    const mb = new Map((b[coll] || []).map((o) => [String(o.id), o]));
    new Set([...ma.keys(), ...mb.keys()]).forEach((id) => {
      const x = ma.get(id), y = mb.get(id);
      if (!x || !y) { out.push(`${coll} id ${id}: ${x ? 'あり' : 'なし'}→${y ? 'あり' : 'なし'}`); return; }
      new Set([...Object.keys(x), ...Object.keys(y)]).forEach((k) => {
        if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${coll} id ${id} ${k}: ${enc(x[k])}→${enc(y[k])}`);
      });
    });
  });
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
    if (['walls', 'rooms', 'items'].indexOf(k) >= 0) return;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`plan ${k}: 変わった`);
  });
  return out.sort();
}
const panelOpen = {};
const knownSeen = [];

// 種類 → 土台の物を選ぶ決まり。部位ごと。
function targetsFor(part, def) {
  if (part === 'wall') return [{ coll: 'walls', pick: 'wall' }];
  if (part === 'room') {
    if (def.key === 'floorMaterial') return [{ coll: 'rooms', pick: 'legacy-floor-room' }, { coll: 'rooms', pick: 'image-floor-room' }];
    if (def.key === 'void') return [{ coll: 'rooms', pick: 'void-ok-room' }];
    // 土間の深さは高さモデルで決まる。古い高さモデル(土台。土間は ±0)と、仕上げ基準の高さモデル(土台に
    // modelVersion 2 と階ごとの床厚を足した写し。土間は床厚の中まで下がる)の両方で、1階と2階の部屋に当てる。
    if (def.key === 'floorLevel') return [{ coll: 'rooms', pick: 'floor1-room' }, { coll: 'rooms', pick: 'floor1-room', v2: true }, { coll: 'rooms', pick: 'floor2-room', v2: true }];
    return [{ coll: 'rooms', pick: 'legacy-floor-room' }];
  }
  const kinds = def.for || null;
  if (part === 'opening') return (kinds || []).map((t) => ({ coll: 'items', pick: 'type:' + t }));
  if (part === 'stair') return ['stair', 'stair-corner'].map((t) => ({ coll: 'items', pick: 'type:' + t }));
  if (part === 'object') {
    const types = [];
    (kinds || []).forEach((k) => {
      const ext = PlanSettable.EXTERIOR.concat(PlanSettable.SITE).filter((e) => e.kind === k);
      ext.forEach((e) => { if (types.indexOf(e.type) < 0) types.push(e.type); });
    });
    return types.map((t) => ({ coll: 'items', pick: 'type:' + t }));
  }
  return [];
}

// 項目と値の組を、SETTINGS から機械的に作る。
const cases = [];
const skipped = [];
for (const part of Object.keys(PlanSettable.SETTINGS)) {
  for (const def of PlanSettable.SETTINGS[part]) {
    const label = part + '.' + def.key;
    if (SKIP[label]) { skipped.push({ label, why: SKIP[label], def }); continue; }
    let values;
    if (def.choices) values = def.choices.map((c) => c[0]);
    else if (def.num) {
      assert.ok(Object.prototype.hasOwnProperty.call(NUM_VALUES, def.key), label + ' に入れる値を NUM_VALUES に足すこと');
      values = [NUM_VALUES[def.key]];
    } else {
      assert.ok(Object.prototype.hasOwnProperty.call(TEXT_VALUES, def.key), label + ' に入れる値を TEXT_VALUES に足すこと');
      values = [TEXT_VALUES[def.key]];
    }
    const targets = targetsFor(part, def);
    assert.ok(targets.length, label + ' の対象の物の決まりが無い');
    for (const target of targets) for (const value of values) cases.push({ part, key: def.key, panel: def.panel, value, target, label });
  }
}

// 偽の AI(/api/ai/chat)。台本は window.__chat.queue に積む。
function installFakeChat() {
  window.__chat = { queue: [], calls: 0 };
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    if (!String(url).includes('/api/ai/chat')) return realFetch(url, init);
    window.__chat.calls++;
    try { window.__chat.lastBody = JSON.parse(init.body); } catch (e) { window.__chat.lastBody = null; }
    const step = window.__chat.queue.shift();
    if (!step) return Promise.resolve(new Response(JSON.stringify({ error: 'bad_request', code: 'bad_request' }), { status: 400 }));
    return Promise.resolve(new Response(step, { status: 200, headers: {
      'content-type': 'text/event-stream', 'x-chat-ticket': 'tk-' + Math.random().toString(36).slice(2), 'x-chat-rounds-left': '5',
    } }));
  };
}

const browser = await chromium.launch();
const failures = [];
let compared = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(installFakeChat);
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=2f');
  await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4, null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  // 製品の「読込」で凍結間取りを開く
  await page.evaluate(() => { window.__beforeImport = DATA; });
  await page.setInputFiles('#import-file', FIXTURE);
  await page.waitForFunction(() => window.DATA !== window.__beforeImport && DATA.rooms.length > 10, null, T);
  await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items, null, T);
  await page.waitForTimeout(300);

  // 土台を作る: 間取りに無い種類を画面の道具で置き足し、その状態を土台として写す
  const base = await page.evaluate(() => {
    const site = DATA.items.find((it) => it.type === 'site-rect');
    const free = { x: site.x + 400, y: site.y + 400 };
    onFloorChange(1);
    ['wood-fence', 'ramp'].forEach((t, i) => { if (!DATA.items.some((it) => it.type === t)) placeItem(t, free.x + i * 1500, free.y); });
    // 間取りに無い建具は、壁の中ほど(近くに建具の無い所)に画面の道具で置く
    const used = [];
    const placed = {};
    ['door-slide', 'door-pocket', 'door-opening-arch'].forEach((t) => {
      if (DATA.items.some((it) => it.type === t)) return;
      for (const fl of [1, 2]) {
        onFloorChange(fl);
        const near = DATA.items.filter((it) => /^(door-|window)/.test(it.type) && (it.floor || 1) === fl);
        const w = DATA.walls.find((w) => {
          const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
          return (w.floor || 1) === fl && used.indexOf(w) < 0 && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 1500
            && !near.some((it) => Math.hypot(it.x + (it.w || 0) / 2 - mx, it.y + (it.d || 0) / 2 - my) < 1000);
        });
        if (!w) continue;
        used.push(w);
        const n = DATA.items.length;
        placeItem(t, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2);
        placed[t] = DATA.items.length > n ? 'placed' : 'refused';
        if (DATA.items.length > n) break;
      }
    });
    onFloorChange(1);
    clearEditHistory();
    ST.selected = null;
    const json = JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v));
    return { json, nextId, placed };
  });
  console.log('土台に置き足した建具: ' + JSON.stringify(base.placed));

  const legacyRoomsBefore = JSON.parse(readFileSync(FIXTURE, 'utf8')).rooms;
  // 仕上げ基準の高さモデルの土台(土間の深さが床厚で決まる)。1階は全体の床厚 220、2階は階ごとの床厚 260。
  const baseV2 = (() => {
    const p = JSON.parse(base.json);
    p.heightDefaults = Object.assign({}, p.heightDefaults || {}, { modelVersion: 2, perFloor: true, floorThickness: 220 });
    p.floors = Object.assign({}, p.floors || {}, { 2: { floorThickness: 260 } });
    return JSON.stringify(p);
  })();
  const DOMA_MM = { 'floor1-room': -200, 'floor2-room': -240 };

  // 区画の名前が setProps で書けないこと(書けるようになったら SKIP を外して比べる)
  const zoneProbe = await page.evaluate(() => {
    const site = DATA.items.find((it) => it.type === 'site-rect');
    const r = PlanCoreOperations.applyOperations(DATA, [{ op: 'setProps', args: { id: site.id, set: { name: '駐車スペース' } } }], planChatCtx());
    return r.errors.length ? r.errors[0].message : null;
  });
  assert.ok(zoneProbe, '区画の名前が setProps で書けるようになった。SKIP から外して比べること');

  for (const c of cases) {
    const baseJson = c.target.v2 ? baseV2 : base.json;
    // 対象の物を土台から選ぶ(土台は毎回同じなので、2回とも同じ物になる)
    const pickId = await page.evaluate(({ baseJson, target, legacyIds }) => {
      const plan = JSON.parse(baseJson);
      const list = plan[target.coll];
      let o = null;
      if (target.pick === 'wall') o = list.find((w) => (w.floor || 1) === 1);
      else if (target.pick === 'legacy-floor-room') o = list.find((r) => legacyIds.wood.indexOf(r.id) >= 0 && !(r.ceiling) && (r.floor || 1) === 1);
      else if (target.pick === 'image-floor-room') o = list.find((r) => legacyIds.image.indexOf(r.id) >= 0);
      else if (target.pick === 'floor1-room') o = list.find((r) => (r.floor || 1) === 1 && legacyIds.wood.indexOf(r.id) >= 0);
      else if (target.pick === 'floor2-room') o = list.find((r) => r.floor === 2 && legacyIds.wood.indexOf(r.id) >= 0);
      else if (target.pick === 'void-ok-room') {
        DATA = plan; o = list.find((r) => !r.ceiling && !roomVoidBlockReason(r)) || null;
      } else if (target.pick.indexOf('type:') === 0) o = list.find((it) => it.type === target.pick.slice(5));
      return o ? o.id : null;
    }, {
      baseJson, target: c.target,
      legacyIds: {
        wood: legacyRoomsBefore.filter((r) => r.texture === 'wood_floor').map((r) => r.id),
        image: legacyRoomsBefore.filter((r) => r.texture && !/^(wood_floor|tile_floor)$/.test(r.texture)).map((r) => r.id),
      },
    });
    const name = `${c.label}=${c.value} (${c.target.pick}${c.target.v2 ? ' 仕上げ基準の高さ' : ''}${pickId !== null ? ' id ' + pickId : ''})`;
    if (pickId === null) { failures.push(`${name}: 土台に対象の物が無い`); continue; }

    const reset = () => page.evaluate(({ json, id }) => {
      DATA = JSON.parse(json);
      nextId = id;
      _defaultPlanPending = false;
      normalizeLoadedPlan({ resetHeights: false, restoreView: false });
      clearEditHistory();
      ST.selected = null;
      document.getElementById('props').classList.remove('show');
    }, { json: baseJson, id: base.nextId });

    // 描画が読む値と、プラン全体
    const observe = (coll, id, key) => page.evaluate(({ coll, id, key }) => {
      const o = DATA[coll].find((x) => String(x.id) === String(id));
      const log = [];
      const names = ['pbrTex', 'pbrTexLinear', 'getTexture3D', 'getTextureNormal3D'];
      const saved = names.map((n) => window[n]);
      names.forEach((n, i) => { window[n] = function (k) { log.push(n + ':' + String(k).slice(0, 60)); return saved[i].apply(this, arguments); }; });
      let render;
      try {
        const R = {
          wallHeight: () => wallHeightMm(o), thick: () => o.thick,
          floorMaterial: () => { log.length = 0; const m = makeRoomFloorMaterial(o); return [roomFloorMaterialKey(o), m.type, m.color.getHexString(), log.join(',')]; },
          ceilingHeight: () => [roomCeilingTypeValue(o), roomRenderedCeilingMm(o)],
          void: () => [roomCeilingTypeValue(o), roomRenderedCeilingMm(o)],
          floorLevel: () => roomFloorOffsetMm(o),
          windowKind: () => o.windowKind, windowSill: () => windowSillMm(o), windowHeight: () => windowHeightMm(o), doorHeight: () => doorHeightMm(o),
          stairRail: () => stairRailSides(o), stairStyle: () => stairStyleOf(o),
          fenceHeight: () => o.fenceHeight, fencePattern: () => o.fencePattern, latticeHeight: () => o.latticeHeight,
          targetHeight: () => o.targetHeight, accessSteps: () => o.accessSteps, surface: () => siteSurfaceType(o),
        };
        render = R[key] ? R[key]() : '(描画の読み方を決めていない)';
      } finally { names.forEach((n, i) => { window[n] = saved[i]; }); }
      return { render, plan: JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v)), obj: JSON.stringify(o, (k, v) => (k.charAt(0) === '_' ? undefined : v)) };
    }, { coll, id, key });

    // (a) 設定パネル。物を選んでパネルを開いただけで足される欄(sScale・elev などの既定)は項目の変更ではないので、
    //     開いた直後(A0)からの差分で比べる。開いただけで変わった欄は panelOpen に記録して最後に出す。
    await reset();
    const before = await observe(c.target.coll, pickId, c.key);
    const opened = await page.evaluate(({ coll, id }) => {
      const o = DATA[coll].find((x) => String(x.id) === String(id));
      ST.selected = o;
      updateProps();
      return true;
    }, { coll: c.target.coll, id: pickId });
    assert.ok(opened);
    const A0 = await observe(c.target.coll, pickId, c.key);
    diffPlans(before.plan, A0.plan).forEach((d) => { panelOpen[d.replace(/: .*/, '').replace(/ id \S+/, '')] = true; });
    const panelRes = await page.evaluate(({ panel, key, value }) => {
      const props = document.getElementById('props');
      const els = Array.from(props.querySelectorAll('[onchange],[onclick]'));
      const needle = /^[a-z]/.test(panel) && !/^update|^set|^apply/.test(panel) ? "updateSelectedProp('" + panel + "'" : panel + '(';
      const hits = els.filter((e) => (e.getAttribute('onchange') || e.getAttribute('onclick') || '').indexOf(needle) >= 0);
      if (!hits.length) return { error: 'パネルに入口 ' + needle + ' が無い' };
      // 選択欄を先に探し、選択肢に値があるものを使う。無ければ入力欄。
      let el = null, set = null;
      const wantText = key === 'floorLevel' ? /玄関土間/ : null;
      const want = key === 'void' ? 'void' : String(value);
      for (const e of hits) {
        if (e.tagName === 'SELECT') {
          const opt = Array.from(e.options).find((op) => (wantText ? wantText.test(op.textContent) : op.value === want) && !op.disabled);
          if (opt) { el = e; set = opt.value; break; }
        }
      }
      if (!el) el = hits.find((e) => e.tagName === 'INPUT' && e.type !== 'file' && e.type !== 'checkbox');
      if (!el) return { error: 'パネルの入口 ' + needle + ' に、値 ' + want + ' を入れる欄・選択肢が無い' };
      el.value = set !== null ? set : String(value);
      if (el.value !== (set !== null ? set : String(value))) return { error: 'パネルの欄に値 ' + value + ' が入らない' };
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }, { panel: c.panel, key: c.key, value: c.value });
    if (panelRes.error) { failures.push(`${name}: ${panelRes.error}`); continue; }
    const A = await observe(c.target.coll, pickId, c.key);

    // (b) AI に頼む(チャットの入口から。偽の AI が setProps を返す)
    await reset();
    const chatRes = await page.evaluate(async ({ steps }) => {
      window.__chat.queue.push(...steps);
      const calls0 = window.__chat.calls;
      ChatUI.send('設定を変えて');
      const t0 = Date.now();
      while ((window.__chat.calls < calls0 + 2 || ChatUI.state().busy) && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 30));
      return { busy: ChatUI.state().busy, calls: window.__chat.calls - calls0 };
    }, {
      steps: [
        sseFor([{ type: 'tool_use', id: 'tu1', name: 'setProps', input: { id: pickId, set: { [c.key]: c.value } } }], { stop: 'tool_use' }),
        sseFor([{ type: 'text', text: '変えました。' }], { stop: 'end_turn' }),
      ],
    });
    if (chatRes.busy || chatRes.calls !== 2) { failures.push(`${name}: AI の依頼が終わらない ${JSON.stringify(chatRes)}`); continue; }
    const B = await observe(c.target.coll, pickId, c.key);
    // 偽の AI に返った道具の結果(2回めの呼び出しの最後の user の中身)
    const toolResult = await page.evaluate(() => {
      const last = window.__chat.lastBody && window.__chat.lastBody.messages;
      const m = last && last[last.length - 1];
      const r = m && Array.isArray(m.content) && m.content.find((b) => b.type === 'tool_result');
      return r ? { isError: !!r.is_error, text: String(r.content).slice(0, 300) } : null;
    });

    compared++;
    const panelDelta = diffPlans(A0.plan, A.plan);
    const aiDelta = diffPlans(before.plan, B.plan);
    const sameDelta = JSON.stringify(panelDelta) === JSON.stringify(aiDelta);
    const sameRender = JSON.stringify(A.render) === JSON.stringify(B.render);
    const known = KNOWN[c.label + '=' + c.value] || KNOWN[c.label];
    const problems = [];
    if (known) {
      // 分かっている食い違い。中身が書いたとおりであることを確かめる(変わったら知らせる)
      const got = known.kind === 'ai-refused'
        ? (aiDelta.length === 0 && panelDelta.length > 0 && toolResult && toolResult.isError)
        : (!sameDelta && sameRender && panelDelta.concat(aiDelta).every((d) => d.indexOf(' ' + c.key + ': ') >= 0));
      if (!got) problems.push(`分かっている食い違い(${known.why})と中身が違う: パネル ${JSON.stringify(panelDelta)} / AI ${JSON.stringify(aiDelta)} / 描画 ${JSON.stringify([A.render, B.render])} / 道具の結果 ${JSON.stringify(toolResult)}`);
      else knownSeen.push({ name, why: known.why, panel: panelDelta, ai: aiDelta, tool: toolResult });
    } else {
      if (!sameDelta) problems.push(`変わり方が違う\n      パネル ${JSON.stringify(panelDelta)}\n      AI     ${JSON.stringify(aiDelta)}`);
      if (!sameRender) problems.push(`描画が読む値が違う: パネル ${JSON.stringify(A.render)} / AI ${JSON.stringify(B.render)}`);
      if (toolResult && toolResult.isError) problems.push('AI の道具が失敗した: ' + toolResult.text);
    }
    if (c.key === 'floorLevel') {
      // 描画が読む床の上下(roomFloorOffsetMm)が、土間の深さになっていること(欄に入っただけでなく、床が下がる)。
      const want = c.target.v2 ? DOMA_MM[c.target.pick] : 0;
      if (A.render !== want) problems.push(`パネルの土間で床の上下が ${want} にならない(${A.render})`);
      if (B.render !== want) problems.push(`AI の土間で床の上下が ${want} にならない(${B.render})`);
      if (c.target.v2 && before.render === B.render) problems.push('AI で土間にしても床の高さが変わらない');
    }
    if (c.key === 'floorMaterial') {
      // 選んだ床材が描画に届いていること(欄に入っただけでなく、画面の床が変わる)
      if (A.render[0] !== c.value) problems.push(`パネルで選んだ床材 ${c.value} が描画に届かない(${A.render[0]})`);
      if (B.render[0] !== c.value) problems.push(`AI で変えた床材 ${c.value} が描画に届かない(${B.render[0]})`);
      const image = c.target.pick === 'image-floor-room';
      if (!image && before.render[0] !== c.value && JSON.stringify(before.render) === JSON.stringify(B.render)) problems.push('AI で床材を変えても描く床が変わらない');
      if (image && !/getTexture3D:/.test(B.render[3])) problems.push('床の画像がある部屋で、画像が描かれなくなった');
      // 床の画像がある部屋では、床材は画面に出ない。AI には、そのことを警告で返す(「変えた」と答えないように)
      if (image && !(toolResult && /床の画像/.test(toolResult.text))) problems.push('床の画像がある部屋で、AI に警告が返らない: ' + JSON.stringify(toolResult));
    }
    if (problems.length) failures.push(`${name}: ${problems.join('\n    ')}`);
    else console.log(`ok  ${name}`);
  }
  if (errors.length) failures.push('ページで例外: ' + errors.slice(0, 5).join(' / '));
} finally {
  await browser.close();
}

const labels = [...new Set(cases.map((c) => c.label))];
console.log(`比べた項目 ${labels.length}(${labels.join(', ')})、組 ${compared}/${cases.length}`);
skipped.forEach((s) => console.log(`比べなかった項目 ${s.label}: ${s.why}`));
knownSeen.forEach((k) => console.log(`分かっている食い違い ${k.name}: ${k.why}\n    パネル ${JSON.stringify(k.panel)}\n    AI     ${JSON.stringify(k.ai)}${k.tool && k.tool.isError ? '\n    道具の結果 ' + k.tool.text : ''}`));
console.log('パネルで物を選んだだけで足される欄(比べる前の土台に含めた): ' + Object.keys(panelOpen).sort().join(', '));
assert.equal(failures.length, 0, '\n' + failures.join('\n'));
