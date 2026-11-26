// Worker 用の ctx(worker/plan-ctx-factory.mjs)が、画面のチャット(assets/js/plan-data.js の planChatCtx)と
// 同じ結果を出すかを、実物の画面の上で照らし合わせる。
//
// ページの中で、画面の部品(PlanCoreOperations など)と fetch した表(worker-catalog.json・tags.json)を
// 工場 createPlanCtxTools に渡して Worker と同じ ctx を作り、同じプラン・同じ操作を両方に当てる。
//   - Worker が当てられた操作は、チャットでも当たり、結果(プラン全体の JSON・changedIds・removedIds・warnings)が
//     1文字も違わないこと。違えば失敗。
//   - Worker が断った操作(「この操作は house-planner の画面で行ってください」)は一覧にして出す。
//     断る文でない誤りで Worker だけが失敗したら失敗。
//   - 両方が失敗した操作は、誤りの文と候補が同じであること。
// プランは凍結間取り tools/tests/fixtures/house-2f.json と、それを書き換えた変種(高さの設定・段差・天井高の指定・
// 面ごとの外壁設定)。変種の壁の高さの既定は、画面の WALL_H をその値にしてから当てる(画面でそのプランを開いた状態)。
//
// sh tools/run_browser_tests.sh worker-ctx-parity
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
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  await page.evaluate((plan) => {
    ['walls', 'rooms', 'items', 'floorMetadata', 'exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail'].forEach((k) => {
      if (plan[k] !== undefined) DATA[k] = plan[k];
    });
    let maxId = 0;
    DATA.items.concat(DATA.walls).forEach((o) => { const n = Number(o.id); if (isFinite(n) && n > maxId) maxId = n; });
    nextId = Math.max(nextId || 1, Math.floor(maxId) + 1);
    normalizeLoadedPlan({ resetHeights: false, restoreView: false });
    draw2d();
  }, PLAN);
  await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items, null, T);

  const out = await page.evaluate(async (app) => {
    const F = await import(new URL('worker/plan-ctx-factory.mjs', app).href);
    const catalog = await (await fetch(new URL('assets/data/worker-catalog.json', app).href)).json();
    const tags = await (await fetch(new URL('assets/models/tags.json', app).href)).json();
    const furniture = await (await fetch(new URL('assets/data/worker-furniture.json', app).href)).json();
    const tools = F.createPlanCtxTools({
      catalog, furniture, AssetSwap, tags, Operations: PlanCoreOperations, Settable: PlanSettable, Knowledge: ObjectKnowledge, FreeApply: PlanFreeApply,
      HeightModel, Summary: ChatPlanSummary, Inspect: PlanCoreInspect, Schema: PlanSchema, Check: PlanCheck, Structure: PlanStructure, SetbackLaw,
    });
    const Ops = PlanCoreOperations;
    const json = (v) => JSON.stringify(v, (k, x) => (k.charAt(0) === '_' ? undefined : x));
    const clone = (v) => JSON.parse(json(v));
    const realData = DATA, realJson = json(DATA), wallHSaved = WALL_H;
    const res = { total: 0, same: 0, bothFailed: 0, refused: [], failures: [], byVariant: {}, deadFaces: [], floorSame: [] };

    // ── 照らし合わせの1件 ──
    // op は操作1つか、続けて当てる操作の並び(土間にしてから戻す、など)。
    function check(variant, plan, op, label) {
      res.total++;
      const ops = Array.isArray(op) ? op : [op];
      const before = json(plan);
      const w = tools.workerApply(plan, ops);
      if (json(plan) !== before) { res.failures.push({ variant, label, why: 'Worker がプランを書き換えた' }); return; }
      nextId = F.firstNewId(plan);
      let c;
      try { c = Ops.applyOperations(plan, ops, planChatCtx()); } catch (e) { c = { errors: [{ message: '例外: ' + e.message }] }; }
      const v = res.byVariant[variant] = res.byVariant[variant] || { total: 0, same: 0, bothFailed: 0, refused: 0 };
      v.total++;
      if (w.errors.length && c.errors.length) {
        const a = json(w.errors.map((e) => [e.message, e.candidates || null]));
        const b = json(c.errors.map((e) => [e.message, e.candidates || null]));
        if (a !== b) res.failures.push({ variant, label, why: '両方失敗したが文が違う', worker: a, chat: b });
        else { res.bothFailed++; v.bothFailed++; }
        return;
      }
      if (w.errors.length) {
        const msg = w.errors[0].message;
        if (msg.indexOf(F.REFUSAL) === 0) { res.refused.push({ variant, label, message: msg }); v.refused++; }
        else res.failures.push({ variant, label, why: 'Worker だけが失敗', worker: msg });
        return;
      }
      if (c.errors.length) { res.failures.push({ variant, label, why: 'チャットだけが失敗', chat: c.errors[0].message }); return; }
      const a = json([w.plan, w.changedIds, w.removedIds, w.warnings]);
      const b = json([c.plan, c.changedIds, c.removedIds, c.warnings]);
      if (a === b) { res.same++; v.same++; if (/土間|normal/.test(label)) res.floorSame.push({ variant, label, changedIds: w.changedIds, plan: w.plan }); return; }
      // 決めて受け入れている違いは1つだけ: 消したあとの面ごとの外壁設定(exteriorWallSettings.faces)の片付け。
      // 画面は今の外面を幾何で求め直して当たらない行を消すが、Worker は消えた壁の行だけを消す
      // (求め直しは 1 階あたり数 ms〜十数 ms かかり、Worker の計算時間に収まらない)。
      // 残るのは画面が消した行=今のどの外面にも当たらない行だけで、見た目は変わらず、画面で開くと片付く。
      // ここでは「違いがそれだけで、画面の残した行は Worker にも同じ値で残っている」ことを確かめる。
      const ws = w.plan.exteriorWallSettings, cs = c.plan.exteriorWallSettings;
      if (ws && cs && ws.faces && cs.faces) {
        const wNoFaces = Object.assign({}, w.plan, { exteriorWallSettings: Object.assign({}, ws, { faces: null }) });
        const cNoFaces = Object.assign({}, c.plan, { exteriorWallSettings: Object.assign({}, cs, { faces: null }) });
        const kept = Object.keys(cs.faces).every((k) => json(ws.faces[k]) === json(cs.faces[k]));
        const order = Object.keys(ws.faces).filter((k) => k in cs.faces).join('|') === Object.keys(cs.faces).join('|');
        if (kept && order && json([wNoFaces, w.changedIds, w.removedIds, w.warnings]) === json([cNoFaces, c.changedIds, c.removedIds, c.warnings])) {
          res.same++; v.same++;
          res.deadFaces.push({ variant, label, left: Object.keys(ws.faces).filter((k) => !(k in cs.faces)).length });
          return;
        }
      }
      // どこが違うか(物・部屋・壁は id ごと、ほかは欄ごと)
      const diff = [];
      ['items', 'rooms', 'walls'].forEach((k) => {
        const wm = new Map((w.plan[k] || []).map((o) => [String(o.id), json(o)]));
        (c.plan[k] || []).forEach((o) => { const s = json(o); if (wm.get(String(o.id)) !== s) diff.push({ k, worker: wm.get(String(o.id)) || null, chat: s }); });
        if ((w.plan[k] || []).length !== (c.plan[k] || []).length) diff.push({ k, count: [(w.plan[k] || []).length, (c.plan[k] || []).length] });
      });
      Object.keys(Object.assign({}, w.plan, c.plan)).forEach((k) => {
        if (['items', 'rooms', 'walls'].includes(k)) return;
        if (json(w.plan[k]) !== json(c.plan[k])) diff.push({ k, worker: json(w.plan[k]), chat: json(c.plan[k]) });
      });
      ['changedIds', 'removedIds', 'warnings'].forEach((k) => { if (json(w[k]) !== json(c[k])) diff.push({ k, worker: json(w[k]), chat: json(c[k]) }); });
      res.failures.push({ variant, label, why: '結果が違う', diff: diff.slice(0, 4) });
    }

    // ── 場所選び ──
    function inside(it, px, py) {
      const cx = it.x + it.w / 2, cy = it.y + it.d / 2, rad = -(it.rot || 0) * Math.PI / 180;
      const dx = px - cx, dy = py - cy;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad), ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      return Math.abs(lx) <= it.w / 2 + 50 && Math.abs(ly) <= it.d / 2 + 50;
    }
    // 床の空いた場所を探すときに避ける物: 台になる物(基礎は除く)と階段。照明・敷物・カーテンなどは避けない。
    const blocks = (it) => (it.type !== 'foundation' && isPlacementSurfaceItem(it)) || isStairPartType(it.type);
    function freeIn(plan, room) {
      for (let fy = 0.5; fy < 0.95; fy += 0.07) for (let fx = 0.5; fx < 0.95; fx += 0.07) {
        for (const sx of [1, -1]) for (const sy of [1, -1]) {
          const x = Math.round(room.x + room.w * (0.5 + sx * (fx - 0.5))), y = Math.round(room.y + room.d * (0.5 + sy * (fy - 0.5)));
          if (!plan.items.some((it) => (it.floor || 1) === room.floor && blocks(it) && inside(it, x, y))) return { x, y };
        }
      }
      return null;
    }
    function outdoor(plan) {
      for (let y = -6000; y < 20000; y += 500) for (let x = -6000; x < 20000; x += 500) {
        if (plan.rooms.some((r) => r.floor === 1 && x >= r.x - 200 && x <= r.x + r.w + 200 && y >= r.y - 200 && y <= r.y + r.d + 200)) continue;
        if (!plan.items.some((it) => (it.floor || 1) === 1 && inside(it, x, y))) return { x, y };
      }
      return null;
    }
    const flatRooms = (plan, floor) => plan.rooms.filter((r) => r.floor === floor && r.w >= 2000 && r.d >= 2000 && !(r.ceiling && (r.ceiling.type === 'void' || r.ceiling.type === 'sloped')))
      .sort((a, b) => b.w * b.d - a.w * a.d);
    // その階で、物の無い場所がある一番大きい部屋と、その場所
    function spotRoom(plan, floor, skip) {
      for (const r of flatRooms(plan, floor)) { if (skip && skip.includes(r.id)) continue; const pt = freeIn(plan, r); if (pt) return { room: r, pt }; }
      return null;
    }
    const bigRoom = (plan, floor) => (spotRoom(plan, floor) || {}).room;

    // ── 変種のプラン ──
    const base = clone(DATA);
    const variants = [];
    {
      const bal = base.items.find((it) => it.type === 'balcony');
      variants.push({ name: 'house-2f', plan: base, extra: [
        ['2階のバルコニー', 2, { x: Math.round(bal.x + bal.w / 2), y: Math.round(bal.y + bal.d / 2) }],
        ['3階(部屋なし)', 3, { x: 4000, y: 4000 }],
      ] });
    }
    {
      // 高さの設定: 仕上げ基準の高さ(modelVersion 2)・階ごとの高さ・床の上げ・天井高の指定
      const p = clone(base);
      p.heightDefaults = Object.assign({}, p.heightDefaults || {}, { modelVersion: 2, perFloor: true, wallHeight: 2500, floorRaise: 30, floorThickness: 220 });
      p.floors = { 1: { wallHeight: 2600, floorRaise: 120, floorThickness: 240 }, 2: { wallHeight: 2350, storyHeight: 2900 } };
      const r1 = bigRoom(p, 1), r2 = bigRoom(p, 2);
      r1.ceiling = { type: 'flat', heightMm: 2300 };
      r2.floorRaiseMm = 60;
      variants.push({ name: '高さの設定', plan: p, wallH: 2500 });
    }
    {
      // 段差の部屋(柱・照明)と、階高を超える天井高の指定、天井の範囲
      const p = clone(base);
      const r1 = bigRoom(p, 1);
      r1.skipLevelMm = 600;
      const r2 = bigRoom(p, 2);
      r2.ceiling = { type: 'flat', heightMm: 3400 };
      const s3 = spotRoom(p, 2, [r2.id]);
      p.items.push({ id: 99001, type: 'ceiling-area', floor: 2, x: s3.pt.x - 450, y: s3.pt.y - 450, w: 900, d: 900, rot: 0, offset: 150, color: '#e4ddd1' });
      variants.push({ name: '段差と天井', plan: p, extra: [['天井の範囲のある2階の部屋', 2, s3.pt]] });
    }
    {
      // 面ごとの外壁設定がある(画面で3Dを描いたプランと同じに、画面の関数で今の外面の行を作る)。
      // 加えて、壁を動かしたあと片付けていない古い面の行(今の外面に当たらない)を2つ置く。
      const p = clone(base);
      p.items = p.items.filter((it) => it.type !== 'foundation');  // 基礎の無いプラン
      planChatCtx().withPlan(p, () => {
        p.walls.forEach((wl) => getWallExteriorSpans(wl).forEach((face, i) => { const fs = getExteriorFaceSetting(wl, face); if (i === 0 && wl.floor === 2) { fs.mode = 'custom'; fs.color = '#334455'; } }));
      });
      const s = p.exteriorWallSettings;
      s.faces[String(p.walls[0].id) + '_1_0_999'] = { mode: 'custom', color: '#aa0000', texture: null, textureFlipX: false, textureFlipY: false };
      s.faces[String(p.walls[7].id) + '_-1_5_77'] = { mode: 'inherit', color: null, texture: null, textureFlipX: false, textureFlipY: false };
      res.facesInVariant = Object.keys(s.faces).length;
      variants.push({ name: '外壁の面・基礎なし', plan: p });
    }
    {
      // 高さの既定(heightDefaults・floors)の無いプランに、3階の部屋を足す(2階の部屋を写して階だけ3に)。
      // 置く場所は、3階の部屋の中・3階の部屋の外・2階のバルコニーの上も加える。
      const p = clone(base);
      delete p.heightDefaults; delete p.floors;
      const src = flatRooms(p, 2).slice(0, 2);
      src.forEach((r, i) => p.rooms.push(Object.assign(clone(r), { id: 'rm_3f_' + i, floor: 3, n: '3階の部屋' + i })));
      const s3 = spotRoom(p, 3);
      const bal = p.items.find((it) => it.type === 'balcony');
      variants.push({ name: '高さの既定なし・3階', plan: p, extra: [
        ['3階の部屋', 3, s3.pt], ['3階の部屋の外', 3, { x: -3000, y: 3000 }],
        ['2階のバルコニー', 2, { x: Math.round(bal.x + bal.w / 2), y: Math.round(bal.y + bal.d / 2) }],
      ] });
    }
    {
      // 入れ子の部屋(1階の大きい部屋の中に、天井高の違う小さい部屋)、回転した台、古い種類名の物
      const p = clone(base);
      const outer = bigRoom(p, 1);
      const nested = { id: 'rm_nested_1', n: '入れ子', floor: 1, x: outer.x + 200, y: outer.y + 200, w: 1200, d: 1100, ceiling: { type: 'flat', heightMm: 2200 } };
      p.rooms.push(nested);
      // 回転した台(2階の部屋の空いた所に、30度回した机)
      const s2 = spotRoom(p, 2);
      const table = { id: 99101, type: 'fmp-Table44', floor: 2, x: s2.pt.x - 500, y: s2.pt.y - 250, w: 1000, d: 500, rot: 30 };
      p.items.push(table);
      // 古い種類名の物(読み込みの直しを通していない保存プランの形)
      const s1 = spotRoom(p, 1, [outer.id]);
      const legacy = ['kitchen', 'desk', 'sofa', 'bed-s', 'tv'];
      legacy.forEach((t, i) => p.items.push({ id: 99201 + i, type: t, floor: 1, x: s1.pt.x - 300 + i * 40, y: s1.pt.y - 300 + i * 40, w: 600, d: 600, rot: 0 }));
      // 回した台の、回した後の矩形の中で、回す前の矩形の外の点(と、その逆)
      const c = { x: table.x + table.w / 2, y: table.y + table.d / 2 };
      const rad = 30 * Math.PI / 180;
      const rotPt = (lx, ly) => ({ x: Math.round(c.x + lx * Math.cos(rad) - ly * Math.sin(rad)), y: Math.round(c.y + lx * Math.sin(rad) + ly * Math.cos(rad)) });
      variants.push({ name: '入れ子・回転した台・古い種類', plan: p, legacy: legacy.map((t, i) => 99201 + i), extra: [
        ['入れ子の部屋', 1, { x: nested.x + 600, y: nested.y + 550 }],
        ['回転した台の上(回す前の矩形の外)', 2, rotPt(420, 200)],
        ['回転した台の外(回す前の矩形の中)', 2, { x: Math.round(c.x + 480), y: Math.round(c.y - 230) }],
        ['古い種類の物の上', 1, { x: s1.pt.x, y: s1.pt.y }],
      ] });
    }
    {
      // 敷地に斜線制限の欄はあるが、効かない(道路も北側も切ってある・北側斜線の無い用途地域・用途地域が無い)
      const p = clone(base);
      const sites = p.items.filter((it) => it.type === 'site-rect');
      sites[0].setback = { zone: 'low1', road: false, north: false };
      sites[1].setback = { zone: 'res-other', road: false, north: true };
      sites[2].setback = { road: true, north: true };
      variants.push({ name: '斜線の欄あり・効かない', plan: p });
    }
    {
      // 斜線制限が効く敷地(照明は断る側。断っていることを確かめる)
      const p = clone(base);
      p.items.find((it) => it.type === 'site-rect' && it.y === 0).setback = { zone: 'low1', road: false, north: true };
      variants.push({ name: '斜線が効く', plan: p });
    }

    // 床の上下(土間・土間をやめる normal)と、天井に付いた器具。画面は器具を床の上下ぶん動かす(followRoomCeiling)。
    // 天井の形がいろいろな部屋(平天井・天井高の指定・勾配(上に部屋があり手書きの勾配/屋根の下で屋根から)・
    // 吹き抜け・段差・2階・階高を超える天井高の指定)と、elev の無い器具、整数でない床の上下(Worker は断る)を作る。
    const floorCases = [];   // [変種の名前, 部屋の id, 断るなら true]
    const fixtureType = (t) => /^light-(ceiling|down|spot)$/.test(t) || t === 'fmp-CeilingFan01' || t === 'original-laundry-rail';
    const inRoom = (r, it) => (it.floor || 1) === r.floor && it.x + it.w / 2 >= r.x && it.x + it.w / 2 <= r.x + r.w && it.y + it.d / 2 >= r.y && it.y + it.d / 2 <= r.y + r.d;
    const v2 = (p) => { p.heightDefaults = Object.assign({}, p.heightDefaults || {}, { modelVersion: 2, perFloor: true, floorThickness: 220 }); p.floors = Object.assign({}, p.floors || {}, { 2: { floorThickness: 260 } }); return p; };
    const room = (p, id) => p.rooms.find((r) => r.id === id);
    {
      const p = v2(clone(base));
      room(p, 'r1022').ceiling = { type: 'flat', heightMm: 2300 };
      room(p, 'r1025').ceiling = { type: 'sloped', lowMm: 2200, highMm: 3000, direction: 90 };
      room(p, 'r1028').skipLevelMm = 400;
      room(p, 'r1081').ceiling = { type: 'sloped', lowMm: 2200, highMm: 3200, direction: 0 };
      room(p, 'r1086').ceiling = { type: 'flat', heightMm: 3400 };
      room(p, 'r1030').floorRaiseMm = 60;
      room(p, 'r1029').floorRaiseMm = 30.5;
      const noElev = p.items.find((it) => fixtureType(it.type) && inRoom(room(p, 'r1084'), it));
      delete noElev.elev;
      variants.push({ name: '床の上下と器具', plan: p });
      ['r1024', 'r1022', 'r1025', 'r1027', 'r1028', 'r1080', 'r1081', 'r1086', 'r1084', 'r1030'].forEach((id) => floorCases.push(['床の上下と器具', id, false]));
      floorCases.push(['床の上下と器具', 'r1029', true]);
    }
    {
      // 下の階の折り上げ天井(段差が上向きの天井の範囲)と重なる2階の部屋。床を下げられる下限が上がる。
      // 天井の範囲の物(ceiling-area)と、古い形の部屋の ceilingAreas。下げ天井(offset が負)は効かない。
      const p = v2(clone(base));
      const area = (rid, x, y, w, d, offset, id) => { const r = room(p, rid); p.items.push({ id, type: 'ceiling-area', floor: 1, x: r.x + x, y: r.y + y, w, d, rot: 0, offset, color: '#e4ddd1' }); };
      area('r1024', 765, 1220, 1200, 1200, 400, 99301);     // 主寝室 r1086 の下。天端が2階の床より上 → 下限が正
      area('r1022', 765, 765, 1200, 1200, 150, 99302);      // 洋室B r1081 の下。下限が床厚の中
      room(p, 'r1020').ceilingAreas = [{ id: 'ca1', x: 200, y: 200, w: 1000, d: 1000, offset: 300 }];   // 洋室A r1080 の下(古い形)
      area('r1028', 100, 100, 600, 600, -200, 99303);       // ホール r1082 の下。下げ天井なので効かない
      // 断る: 下の階の部屋が勾配天井(天井面が屋根・勾配から決まる)
      room(p, 'r1025').ceiling = { type: 'sloped', lowMm: 2200, highMm: 3000, direction: 90 };
      area('r1025', 100, 100, 600, 600, 200, 99304);        // 廊下 r1084 の下
      // 断る: 重なりの帯が細い(60mm 以下。画面は帯に沿う壁を測って重なりから外すことがある)
      p.items.push({ id: 99305, type: 'ceiling-area', floor: 1, x: 7240, y: 4600, w: 60, d: 800, rot: 0, offset: 300 });
      variants.push({ name: '折り上げ天井の上', plan: p });
      [['r1086', false], ['r1081', false], ['r1080', false], ['r1082', false], ['r1084', true], ['r1089', true], ['r1090', true]].forEach(([id, no]) => floorCases.push(['折り上げ天井の上', id, no]));
    }
    {
      // 断る: 下の階に既定より高い壁がある(上の階の床が壁の天端まで持ち上がりうる。持ち上がるかは壁の位置で決まる)
      const p = v2(clone(base));
      const r = room(p, 'r1024');
      p.items.push({ id: 99311, type: 'ceiling-area', floor: 1, x: r.x + 765, y: r.y + 1220, w: 1200, d: 1200, rot: 0, offset: 400 });
      p.walls.find((w) => (w.floor || 1) === 1).wallHeight = 3000;
      variants.push({ name: '折り上げ天井の上・高い壁', plan: p });
      floorCases.push(['折り上げ天井の上・高い壁', 'r1086', true]);
    }

    const kinds = Object.keys(ObjectKnowledge.KNOWLEDGE);
    const isizes = Object.keys(ISIZES);
    for (const V of variants) {
      const p = V.plan;
      WALL_H = V.wallH || wallHSaved;
      const s1 = spotRoom(p, 1), s2 = spotRoom(p, 2);
      const r1 = s1.room;
      const spots = [['1階の部屋', 1, s1.pt], ['屋外', 1, outdoor(p)], ['2階の部屋', 2, s2.pt]].concat(V.extra || []).filter((s) => s[2]);
      res.spots = res.spots || {};
      res.spots[V.name] = spots.map((s) => s[0] + '(' + s[2].x + ',' + s[2].y + ')').concat([s1.room.n + ' ' + JSON.stringify(s1.room.ceiling || null) + ' skip=' + (s1.room.skipLevelMm || 0), s2.room.n + ' ' + JSON.stringify(s2.room.ceiling || null)]);
      // 置く: 全分類と寸法の表の全種類を、3か所に
      for (const [where, floor, pt] of spots) {
        for (const t of kinds.concat(isizes)) check(V.name, p, { op: 'placeItem', args: { type: t, x: pt.x, y: pt.y, floor } }, '置く ' + t + ' ' + where);
      }
      if (V.name !== 'house-2f') continue;
      const [, , pt1] = spots[0];
      // 回転・寸法・設定つきで置く
      check(V.name, p, { op: 'placeItem', args: { type: 'bed', x: pt1.x, y: pt1.y, rot: -90 } }, '置く bed 回転-90');
      check(V.name, p, { op: 'placeItem', args: { type: 'sofa', x: pt1.x, y: pt1.y, rot: 450, w: 1800, d: 800 } }, '置く sofa 回転450 寸法');
      check(V.name, p, { op: 'placeItem', args: { type: 'window', x: 1500, y: 0, set: { windowSill: 1000, windowHeight: 900 } } }, '置く 窓 設定つき');
      check(V.name, p, { op: 'placeItem', args: { type: 'wood-fence', x: -1500, y: 3000, set: { fenceHeight: 1200 } } }, '置く 木のフェンス 設定つき');
      check(V.name, p, { op: 'placeItem', args: { type: 'opening-door-model:default', x: 1500, y: 0 } }, '置く 建具のモデル');
      check(V.name, p, { op: 'placeItem', args: { type: 'no-such-thing', x: 0, y: 0 } }, '置く 知らない種類');
      check(V.name, p, { op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, floor: 5 } }, '置く 5階');
      // 吹き抜けの部屋と、台の上・基礎の上
      const voidRoom = p.rooms.find((r) => r.ceiling && r.ceiling.type === 'void');
      if (voidRoom) for (const t of ['light-ceiling', 'light-down', 'fmp-CeilingFan01', 'sofa']) check(V.name, p, { op: 'placeItem', args: { type: t, x: voidRoom.x + voidRoom.w / 2, y: voidRoom.y + voidRoom.d / 2 } }, '置く ' + t + ' 吹き抜け');
      const table = p.items.find((it) => /Table/.test(it.type) && (it.floor || 1) === 1);
      if (table) for (const t of ['plant', 'decor', 'light-down', 'tv']) check(V.name, p, { op: 'placeItem', args: { type: t, x: table.x + table.w / 2, y: table.y + table.d / 2 } }, '置く ' + t + ' 台の上');
      // 取付の高さの表にある分類(レンジフード)を、台になる物(調理台・机・棚など)の中に置く。台に載せず表の高さ。
      const seenCat = {};
      for (const sf of p.items) {
        if (!sf || sf.type === 'foundation' || !isPlacementSurfaceItem(sf)) continue;
        const cat = (getFmpItem(sf.type) || {}).category || sf.type;
        if (seenCat[cat]) continue; seenCat[cat] = 1;
        for (const t of Object.keys(PlanFreeApply.MOUNT_ELEV_MM).concat(['fmp-KitchenExhaust07'])) {
          check(V.name, p, { op: 'placeItem', args: { type: t, x: sf.x + sf.w / 2, y: sf.y + sf.d / 2, floor: sf.floor || 1 } }, '置く ' + t + ' 台(' + cat + ')の上');
        }
      }
      const fnd = p.items.find((it) => it.type === 'foundation');
      if (fnd) for (const t of ['car', 'tree', 'ac-outdoor', 'chair']) check(V.name, p, { op: 'placeItem', args: { type: t, x: fnd.x + 300, y: fnd.y + 300 } }, '置く ' + t + ' 基礎の上');
      // 部屋・壁
      check(V.name, p, { op: 'addRoom', args: { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 } }, '部屋を足す 1階');
      check(V.name, p, { op: 'addRoom', args: { x: 3000, y: 3000, w: 2000, d: 2000, floor: 2 } }, '部屋を足す 2階');
      check(V.name, p, { op: 'addRoom', args: { name: '屋根裏', x: 3000, y: 3000, w: 2000, d: 2000, floor: 3 } }, '部屋を足す 3階');
      check(V.name, p, { op: 'addWall', args: { x1: 0, y1: 9000, x2: 3640, y2: 9000 } }, '壁を足す 1階');
      check(V.name, p, { op: 'addWall', args: { x1: 0, y1: 1000, x2: 0, y2: 4000, floor: 2, thick: 150 } }, '壁を足す 2階');
      check(V.name, p, { op: 'resizeRoom', args: { id: r1.id, w: r1.w + 910 } }, '部屋の大きさ');
      check(V.name, p, { op: 'renameRoom', args: { id: r1.id, name: '和室' } }, '部屋の名前');
      // 動かす・回す
      const movers = p.items.filter((it) => !it.locked && ['fmp-Sofa16', 'stair', 'stair-corner', 'light-down', 'window', 'car', 'tree', 'memo'].includes(it.type));
      const seenTypes = {};
      for (const it of movers) {
        if (seenTypes[it.type]) continue; seenTypes[it.type] = 1;
        check(V.name, p, { op: 'moveObject', args: { id: it.id, dx: 120, dy: -60 } }, '動かす ' + it.type + ' dx');
        check(V.name, p, { op: 'moveObject', args: { id: it.id, x: it.x + it.w / 2 + 300, y: it.y + it.d / 2 } }, '動かす ' + it.type + ' 中心');
        check(V.name, p, { op: 'rotateObject', args: { id: it.id, by: 90 } }, '回す ' + it.type);
        check(V.name, p, { op: 'rotateObject', args: { id: it.id, rot: -45 } }, '回す ' + it.type + ' -45');
      }
      const wall = p.walls.find((x) => !x.locked);
      check(V.name, p, { op: 'moveObject', args: { id: wall.id, dx: 0, dy: 455 } }, '動かす 壁');
      check(V.name, p, { op: 'moveObject', args: { id: r1.id, x: r1.x + r1.w / 2 + 100, y: r1.y + r1.d / 2 } }, '動かす 部屋');
      check(V.name, p, { op: 'rotateObject', args: { id: wall.id, by: 90 } }, '回す 壁');
      // 消す
      check(V.name, p, { op: 'deleteObjects', args: { ids: [p.items.find((it) => /Sofa/.test(it.type)).id] } }, '消す ソファ');
      check(V.name, p, { op: 'deleteObjects', args: { ids: [wall.id] } }, '消す 壁');
      check(V.name, p, { op: 'deleteObjects', args: { ids: [r1.id, p.items[0].id, p.walls[3].id] } }, '消す 部屋と物と壁');
      check(V.name, p, { op: 'removeWall', args: { id: p.walls[5].id } }, '壁を消す');
      check(V.name, p, { op: 'deleteObjects', args: { ids: [999999] } }, '消す 無い id');
      // 設定を変える(PlanSettable の対象ごとに)
      const fixtureRoom = p.rooms.find((r) => r.floor === 1 && p.items.some((it) => /^light-/.test(it.type) && it.floor === 1 && it.x + it.w / 2 >= r.x && it.x + it.w / 2 <= r.x + r.w && it.y + it.d / 2 >= r.y && it.y + it.d / 2 <= r.y + r.d));
      const plainRoom = p.rooms.find((r) => !p.items.some((it) => (/^light-/.test(it.type) || it.type === 'fmp-CeilingFan01' || it.type === 'original-laundry-rail') && it.floor === r.floor && it.x + it.w / 2 >= r.x && it.x + it.w / 2 <= r.x + r.w && it.y + it.d / 2 >= r.y && it.y + it.d / 2 <= r.y + r.d));
      const sets = [
        [wall.id, { wallHeight: 2600 }], [wall.id, { thick: 150 }], [wall.id, { wallHeight: 9000 }],
        [r1.id, { floorMaterial: 'tile_floor' }], [r1.id, { floorLevel: 'doma' }], [r1.id, { floorLevel: 'normal' }],
        [fixtureRoom && fixtureRoom.id, { floorLevel: 'doma' }],
        [plainRoom && plainRoom.id, { ceilingHeight: 2600 }], [plainRoom && plainRoom.id, { void: 'yes' }],
        [fixtureRoom && fixtureRoom.id, { ceilingHeight: 2200 }], [fixtureRoom && fixtureRoom.id, { floorMaterial: 'wood_oak' }],
      ];
      const byType = (t) => p.items.find((it) => it.type === t);
      [['window', { windowKind: 'casement' }], ['window', { windowSill: 300 }], ['window', { windowHeight: 2400 }], ['window-door', { windowHeight: 1900 }],
        ['door-swing', { doorHeight: 2200 }], ['door-front', { doorHeight: 9999 }],
        ['stair', { stairRail: 'both' }], ['stair-corner', { stairStyle: 'open' }],
        ['lattice-screen', { latticeHeight: 1200 }], ['exterior-stair', { targetHeight: 600 }], ['exterior-stair', { accessSteps: 4 }],
        ['site-rect', { surface: 'gravel' }], ['fence', { fenceHeight: 1000 }], ['car', { fenceHeight: 1000 }], ['fmp-Sofa16', { color: 'red' }],
        ['window', { windowKind: 'round' }],
        // 色・仕上げ(編集だけの項目)
        ['window', { sashColor: '#22252a' }], ['window-door', { sashColor: '' }], ['window', { sashColor: '#123456' }],
        ['door-swing', { doorFinish: 'bath-clear' }], ['door-fold', { doorFinish: '' }], ['door-swing-s', { doorFinish: 'bath-clear' }], ['door-slide', { doorFinish: 'bath-clear' }],
        ['fmp-Sofa16', { finishColors: { body: '#AA3300' } }], ['fmp-Sofa16', { finishTextures: { body: 'wood_oak' } }], ['fmp-Sofa16', { finishRoughness: { body: '0.48' } }],
        ['fmp-Sofa16', { finishColors: { zzz: '#000000' } }], ['fmp-Sofa16', { finishTextures: { body: 'roof_tile' } }],
      ].forEach(([t, set]) => { const it = byType(t); if (it) sets.push([it.id, set]); });
      sets.push([r1.id, { floorColor: '#336699' }], [r1.id, { ceilingColor: '#EEEEEE' }], [r1.id, { floorColor: '' }], [r1.id, { floorColor: 'red' }], [wall.id, { floorColor: '#336699' }]);
      for (const [id, set] of sets) if (id !== undefined && id !== null) check(V.name, p, { op: 'setProps', args: { id, set } }, '設定 ' + id + ' ' + JSON.stringify(set));
      check(V.name, p, { op: 'setProps', args: { id: wall.id, props: { color: '#fff' } } }, '設定 props');
      // 家具の一括差し替え(画面の一括差し替えと同じ決め方)。古民家は、吹き抜けの部屋の壁掛けの物を壁掛けの物へ替えるので
      // 天井の高さが要り、Worker は断る(下の「吹き抜けなし」の写しでは当たる)。
      const sofa = p.items.find((it) => /Sofa/.test(it.type));
      const tv = p.items.find((it) => (CATALOGUE_TAGS.items[it.type] || {}).kind === 'tv');
      for (const args of [{ set: 'rpg-mansion' }, { set: '洋館' }, { set: 'kominka' }, { set: 'gothic' }, { set: 'rpg-mansion', ids: [sofa.id] },
        { set: 'rpg-mansion', except: [sofa.id].concat(tv ? [tv.id] : []) }, { set: 'rpg-mansion', ids: [999999] }]) {
        check(V.name, p, { op: 'swapAssetSet', args }, '差し替え ' + JSON.stringify(args));
      }
      {
        const q = clone(p);
        q.rooms.forEach((r) => { if (r.ceiling && r.ceiling.type === 'void') delete r.ceiling; });
        check('吹き抜けなし', q, { op: 'swapAssetSet', args: { set: 'kominka' } }, '差し替え 古民家');
        check('吹き抜けなし', q, [{ op: 'swapAssetSet', args: { set: 'kominka' } }, { op: 'swapAssetSet', args: { set: 'rpg-mansion' } }], '差し替え 古民家→洋館');
        const l = clone(p);
        l.items.find((it) => it.id === sofa.id).locked = true;
        check('ソファをロック', l, { op: 'swapAssetSet', args: { set: 'rpg-mansion' } }, '差し替え 洋館');
        check('ソファをロック', l, { op: 'swapAssetSet', args: { set: 'rpg-mansion', ids: [sofa.id] } }, '差し替え 洋館 ロックした物を名指し');
      }
    }
    // 変種でも、部屋・壁・設定の代表を当てる
    for (const V of variants.slice(1)) {
      const p = V.plan;
      WALL_H = V.wallH || wallHSaved;
      const r1 = bigRoom(p, 1) || p.rooms[0];
      check(V.name, p, { op: 'addRoom', args: { name: '書庫', x: 20000, y: 20000, w: 2730, d: 3640 } }, '部屋を足す 1階');
      check(V.name, p, { op: 'addRoom', args: { x: 3000, y: 3000, w: 2000, d: 2000, floor: 2 } }, '部屋を足す 2階');
      check(V.name, p, { op: 'addWall', args: { x1: 0, y1: 9000, x2: 3640, y2: 9000, floor: 2 } }, '壁を足す 2階');
      check(V.name, p, { op: 'deleteObjects', args: { ids: [p.walls[0].id] } }, '消す 壁');
      check(V.name, p, { op: 'deleteObjects', args: { ids: [p.items.find((it) => /Sofa/.test(it.type)).id] } }, '消す ソファ');
      const balcony = p.items.find((it) => it.type === 'balcony');
      if (balcony) check(V.name, p, { op: 'deleteObjects', args: { ids: [balcony.id] } }, '消す バルコニー');
      const w2 = p.walls.find((x) => x.floor === 2);
      check(V.name, p, { op: 'removeWall', args: { id: w2.id } }, '壁を消す 2階');
      check(V.name, p, { op: 'setProps', args: { id: r1.id, set: { ceilingHeight: 2500 } } }, '設定 天井高');
      // 土間: 深さは高さモデル・床の厚みで変わる。天井に付いた器具の無い部屋(1階・2階)と、大きい部屋(器具があれば Worker は断る)
      const hasFixture = (r) => p.items.some((it) => (/^light-/.test(it.type) || it.type === 'fmp-CeilingFan01' || it.type === 'original-laundry-rail') && it.floor === r.floor && it.x + it.w / 2 >= r.x && it.x + it.w / 2 <= r.x + r.w && it.y + it.d / 2 >= r.y && it.y + it.d / 2 <= r.y + r.d);
      // 器具のある部屋(1階・2階)も当てる。土間にしてから normal で戻す並びも当てる。
      [r1].concat([1, 2, 3].map((fl) => p.rooms.find((r) => r.floor === fl && !hasFixture(r))), [1, 2].map((fl) => p.rooms.find((r) => r.floor === fl && hasFixture(r)))).forEach((r) => {
        if (!r) return;
        const doma = { op: 'setProps', args: { id: r.id, set: { floorLevel: 'doma' } } };
        const normal = { op: 'setProps', args: { id: r.id, set: { floorLevel: 'normal' } } };
        check(V.name, p, doma, '設定 土間 ' + r.floor + '階 ' + r.id);
        check(V.name, p, [doma, normal], '設定 土間→normal ' + r.floor + '階 ' + r.id);
      });
      check(V.name, p, { op: 'setProps', args: { id: p.walls[1].id, set: { wallHeight: 2700 } } }, '設定 壁の高さ');
      const win = p.items.find((it) => it.type === 'window');
      check(V.name, p, { op: 'setProps', args: { id: win.id, set: { windowHeight: 2600 } } }, '設定 窓の高さ');
      // 古い種類名の物を動かす・回す・設定する・消す
      for (const id of V.legacy || []) {
        const it = p.items.find((x) => x.id === id);
        check(V.name, p, { op: 'moveObject', args: { id, dx: 100, dy: 50 } }, '動かす 古い種類 ' + it.type);
        check(V.name, p, { op: 'rotateObject', args: { id, by: 90 } }, '回す 古い種類 ' + it.type);
        check(V.name, p, { op: 'setProps', args: { id, set: { color: '#336699' } } }, '設定 古い種類 ' + it.type);
        check(V.name, p, { op: 'deleteObjects', args: { ids: [id] } }, '消す 古い種類 ' + it.type);
      }
    }
    // 床の上下と器具・折り上げ天井の上の部屋に、土間・normal・土間→normal を当てる。断るはずの部屋はラベルに [断る]。
    for (const [vname, id, refuse] of floorCases) {
      const V = variants.find((x) => x.name === vname);
      WALL_H = V.wallH || wallHSaved;
      const r = V.plan.rooms.find((x) => x.id === id);
      const tag = (refuse ? '[断る] ' : '') + id + ' ' + r.n + (V.plan.items.some((it) => fixtureType(it.type) && inRoom(r, it)) ? ' 器具あり' : '');
      const doma = { op: 'setProps', args: { id, set: { floorLevel: 'doma' } } };
      const normal = { op: 'setProps', args: { id, set: { floorLevel: 'normal' } } };
      check(vname, V.plan, doma, '設定 土間 ' + tag);
      check(vname, V.plan, normal, '設定 normal ' + tag);
      if (!refuse) check(vname, V.plan, [doma, normal], '設定 土間→normal ' + tag);
    }
    WALL_H = wallHSaved;
    // 照らし合わせが「どちらも何もしない」で一致していないことの確かめ(式で決める値が実際に入っている)
    {
      const placed = (V, type, where) => {
        const p = variants.find((x) => x.name === V).plan;
        const s = where === 2 ? spotRoom(p, 2) : spotRoom(p, 1);
        WALL_H = (variants.find((x) => x.name === V).wallH) || wallHSaved;
        const r = tools.workerApply(p, [{ op: 'placeItem', args: { type, x: s.pt.x, y: s.pt.y, floor: where } }]);
        WALL_H = wallHSaved;
        return r.errors.length ? r.errors[0].message : r.plan.items[r.plan.items.length - 1];
      };
      const placedAt = (V, type, floor, where) => {
        const p = variants.find((x) => x.name === V).plan;
        const pt = where(p);
        const r = tools.workerApply(p, [{ op: 'placeItem', args: { type, x: pt.x, y: pt.y, floor } }]);
        return r.errors.length ? { elev: r.errors[0].message } : r.plan.items[r.plan.items.length - 1];
      };
      const col = placed('段差と天井', 'column', 1);
      const light1 = placed('house-2f', 'light-ceiling', 1), light2 = placed('高さの設定', 'light-down', 2);
      const hood = placed('house-2f', 'range-hood', 1);
      const washer = placed('house-2f', 'laundry', 2);
      const counter = base.items.find((it) => it.type === 'fmp-CabinetD01');
      const onCounter = tools.workerApply(base, [{ op: 'placeItem', args: { type: 'range-hood', x: counter.x + counter.w / 2, y: counter.y + counter.d / 2 } }]);
      const nestedLight = placedAt('入れ子・回転した台・古い種類', 'light-ceiling', 1, (p) => { const r = p.rooms.find((x) => x.id === 'rm_nested_1'); return { x: r.x + 600, y: r.y + 550 }; });
      const outerLight = placedAt('入れ子・回転した台・古い種類', 'light-ceiling', 1, (p) => { const r = p.rooms.find((x) => x.id === 'rm_nested_1'); return { x: r.x + r.w + 300, y: r.y + 550 }; });
      res.formula = { column: [col.baseLevel, col.columnHeight], light1: light1.elev, light2: light2.elev, hood: hood.elev, washer: [washer.type, washer.floor, washer.indoor],
        hoodOnCounter: onCounter.errors.length ? onCounter.errors[0].message : onCounter.plan.items[onCounter.plan.items.length - 1].elev,
        nestedLight: [nestedLight.elev, outerLight.elev],
        // 土間: 仕上げ基準の高さの変種(1階の床厚 240)で、器具の無い1階の部屋の床の上下
        doma: (() => {
          const p = variants.find((x) => x.name === '高さの設定').plan;
          const r = p.rooms.find((x) => x.floor === 1 && !p.items.some((it) => /^light-/.test(it.type) && it.floor === 1 && it.x + it.w / 2 >= x.x && it.x + it.w / 2 <= x.x + x.w && it.y + it.d / 2 >= x.y && it.y + it.d / 2 <= x.y + x.d));
          const w = tools.workerApply(p, [{ op: 'setProps', args: { id: r.id, set: { floorLevel: 'doma' } } }]);
          return w.errors.length ? w.errors[0].message : w.plan.rooms.find((x) => x.id === r.id).floorRaiseMm;
        })(),
        // 折り上げ天井の上の部屋を土間にしたときの床の上下(下限で戻る)
        recess: ['r1086', 'r1081', 'r1080', 'r1082'].map((id) => {
          const p = variants.find((x) => x.name === '折り上げ天井の上').plan;
          const w = tools.workerApply(p, [{ op: 'setProps', args: { id, set: { floorLevel: 'doma' } } }]);
          return w.errors.length ? w.errors[0].message : w.plan.rooms.find((x) => x.id === id).floorRaiseMm;
        }),
        // 器具のある部屋を土間にしたとき、Worker が器具を動かして id を返すこと(洋室 r1024。床厚 220 → 器具は +200)
        fixtureMove: (() => {
          const p = variants.find((x) => x.name === '床の上下と器具').plan;
          const r = p.rooms.find((x) => x.id === 'r1024');
          const fx = p.items.filter((it) => fixtureType(it.type) && inRoom(r, it));
          const w = tools.workerApply(p, [{ op: 'setProps', args: { id: 'r1024', set: { floorLevel: 'doma' } } }]);
          if (w.errors.length) return w.errors[0].message;
          return { changedIds: w.changedIds, elev: fx.map((it) => [it.elev, w.plan.items.find((x) => x.id === it.id).elev]) };
        })() };
    }

    // 外壁の色・素材の受け口(props からしか呼ばれないので、applyProp を直接当てて比べる)
    {
      const p = clone(base), q = clone(base);
      const w0 = p.walls[2], q0 = q.walls[2];
      Ops.applyProp(w0, 'exteriorColor', '#123456', p, tools.workerOpsCtx(p));
      Ops.applyProp(w0, 'exteriorTexture', 'brick_red', p, tools.workerOpsCtx(p));
      const cctx = planChatCtx();
      cctx.withPlan(q, () => { Ops.applyProp(q0, 'exteriorColor', '#123456', q, cctx); Ops.applyProp(q0, 'exteriorTexture', 'brick_red', q, cctx); });
      res.exterior = json(p) === json(q);
    }
    // 要約と検査
    {
      const want = '<plan_summary>\n' + ChatPlanSummary.summarize(base, { labelOf: (t) => itemTypeLabel(t), kindOf: (t) => (CATALOGUE_TAGS.items[t] ? CATALOGUE_TAGS.items[t].kind : null) }) + '\n</plan_summary>';
      res.summary = tools.workerSummarize(base) === want;
      res.inspect = json(tools.workerInspect(base)) === json(PlanCoreInspect.inspectPlan(base, { defaults: ISIZES }));
      const broken = clone(base); broken.items.push({ id: broken.items[0].id, type: 'sofa', x: 0, y: 0, w: 100, d: 100, floor: 1 });
      res.inspectBroken = json(tools.workerInspect(broken)) === json(PlanCoreInspect.inspectPlan(broken, { defaults: ISIZES }));
    }
    res.dataUntouched = DATA === realData && json(DATA) === realJson;
    res.floorExpected = [];
    floorCases.filter((c) => c[2]).forEach(([vname, id]) => {
      const r = variants.find((x) => x.name === vname).plan.rooms.find((x) => x.id === id);
      const lbl = (k) => vname + ': 設定 ' + k + ' [断る] ' + id + ' ' + r.n + (variants.find((x) => x.name === vname).plan.items.some((it) => fixtureType(it.type) && inRoom(r, it)) ? ' 器具あり' : '');
      res.floorExpected.push(lbl('土間'));
    });
    res.floorRefusedExpected = res.floorExpected.length;
    res.floorSameCount = res.floorSame.length;
    res.floorSameIds = res.floorSame.filter((x) => x.changedIds.length > 1).length;
    delete res.floorSame;
    return res;
  }, APP);

  const groups = {};
  out.refused.forEach((r) => { const k = r.message.replace(/^[^(]*\(/, '').replace(/\)$/, ''); (groups[k] = groups[k] || []).push(r.variant + ': ' + r.label); });
  console.log(JSON.stringify({ total: out.total, same: out.same, bothFailed: out.bothFailed, refused: out.refused.length, byVariant: out.byVariant, facesInVariant: out.facesInVariant, spots: out.spots }, null, 1));
  console.log('一致(面ごとの外壁設定に、どの外面にも当たらない行が残る): ' + out.deadFaces.map((d) => d.variant + ': ' + d.label + ' 残り' + d.left).join(' / '));
  console.log('断った操作:');
  Object.keys(groups).forEach((k) => { console.log('  [' + groups[k].length + '] ' + k); groups[k].forEach((l) => console.log('     ' + l)); });
  if (out.failures.length) {
    console.log('食い違い ' + out.failures.length + ' 件:');
    out.failures.slice(0, 40).forEach((f) => console.log(JSON.stringify(f).slice(0, 1500)));
  }
  console.log('式で決めた値: ' + JSON.stringify(out.formula));
  console.log('床の上下: 一致 ' + out.floorSameCount + '(うち器具も動いた ' + out.floorSameIds + ')、断るはずの組 ' + out.floorRefusedExpected);
  assert.deepEqual(out.failures, [], 'Worker と画面のチャットの結果が食い違った');
  assert.equal(out.formula.column[0], 'under', '段差の部屋の柱が段差の下まで伸びていない');
  assert.ok(out.formula.light1 > 2000 && out.formula.light2 > 1800, '照明の高さが天井から決まっていない');
  assert.equal(out.formula.hood, 1650, 'レンジフードの取付の高さ');
  assert.equal(out.formula.hoodOnCounter, 1650, '調理台の上に置いたレンジフードも取付の高さ');
  assert.equal(out.formula.doma, -220, '土間の床の上下が床の厚みから決まっていない');
  // 床の上下(土間・normal)は、[断る] を付けた部屋だけで断り、それ以外では画面と同じに当たる
  const floorRefused = out.refused.filter((r) => /土間|normal/.test(r.label));
  assert.deepEqual(floorRefused.filter((r) => !/\[断る\]/.test(r.label)).map((r) => r.variant + ': ' + r.label + ' ' + r.message), [], '床の上下を断るはずのない部屋で断った');
  assert.ok(out.floorRefusedExpected > 0, '[断る] の部屋が無い');
  const refusedLabels = new Set(floorRefused.map((r) => r.variant + ': ' + r.label));
  assert.deepEqual(out.floorExpected.filter((l) => !refusedLabels.has(l)), [], '断るはずの部屋で断らなかった(画面と同じ値を出せる保証が無い)');
  assert.ok(out.floorSameCount >= 60, '床の上下で一致した組が少ない: ' + out.floorSameCount);
  assert.deepEqual(out.formula.recess, [160, -90, 60, -240], '折り上げ天井の上の部屋の床の下限: ' + JSON.stringify(out.formula.recess));
  assert.ok(out.formula.fixtureMove.changedIds && out.formula.fixtureMove.changedIds.length >= 2 && out.formula.fixtureMove.elev.every(([a, b]) => b === a + 200),
    '器具のある部屋の土間で、Worker が器具を動かしていない: ' + JSON.stringify(out.formula.fixtureMove));
  assert.ok(out.formula.nestedLight[0] !== out.formula.nestedLight[1] && out.formula.nestedLight.every((v) => typeof v === 'number'), '入れ子の部屋の照明は、内側の部屋の天井から決まる: ' + JSON.stringify(out.formula.nestedLight));
  const lightRefusals = (v) => out.refused.filter((r) => r.variant === v && r.message.includes('照明の高さを画面でしか'));
  assert.deepEqual(lightRefusals('斜線の欄あり・効かない').map((r) => r.label), [], '斜線が効かない敷地で照明を断った');
  assert.ok(lightRefusals('斜線が効く').length >= 1, '斜線が効く敷地で照明を断っていない');
  assert.deepEqual(out.refused.filter((r) => /range-hood|KitchenExhaust/.test(r.label)).map((r) => r.variant + ': ' + r.label), [], '取付の高さの分類を断った');
  assert.deepEqual(out.deadFaces.map((d) => d.variant).filter((v) => v !== '外壁の面・基礎なし'), [], '面ごとの外壁設定の残りは、その変種でしか起きない');
  assert.ok(out.same >= 500, '一致した操作が少なすぎる: ' + out.same);
  // 家具の一括差し替え: 断ってよいのは、吹き抜けの部屋の壁掛けの物の高さが要る古民家だけ。吹き抜けの無い写しでは一致し、
  // ロックした物を名指しすると両方とも同じ文で失敗する。
  assert.deepEqual(out.refused.filter((r) => /差し替え/.test(r.label)).map((r) => r.variant + ': ' + r.label), ['house-2f: 差し替え {"set":"kominka"}'], '一括差し替えで断った組');
  assert.equal(out.byVariant['吹き抜けなし'].same, 2, '吹き抜けの無い写しの古民家への差し替えが一致しない: ' + JSON.stringify(out.byVariant['吹き抜けなし']));
  assert.deepEqual([out.byVariant['ソファをロック'].same, out.byVariant['ソファをロック'].bothFailed], [1, 1], 'ロックした物のある差し替え: ' + JSON.stringify(out.byVariant['ソファをロック']));
  assert.equal(out.exterior, true, '外壁の色・素材の書き込みが違う');
  assert.equal(out.summary, true, '要約が違う');
  assert.equal(out.inspect, true, '検査が違う');
  assert.equal(out.inspectBroken, true, '壊れたプランの検査が違う');
  assert.equal(out.dataUntouched, true, '画面の DATA が変わった');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
