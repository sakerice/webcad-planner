// チャット(AI)用の ctx(assets/js/plan-data.js の planChatCtx)を、実物の画面の上で確かめる。
//
//   1. 家具・設備の分類名(ObjectKnowledge の全分類)を1件ずつ placeItem で写しに当て、置けた分類と置けない分類を記録する。
//      置けた物の種類名は、読み取り(PlanFreeApply)が同じ分類に使う種類名と同じ。
//   2. 当てる前後で、本物の DATA が1項目も変わらない(JSON が同じ。DATA は同じ物を指したまま)。
//      当てている間に、描画・保存・共同編集の同期・markDirty が1回も呼ばれない。
//   3. 写しに足した部屋の中に、地面に置く印の物を2階へ置くと、その部屋の屋内の判定が効く
//      (操作の間だけ DATA が写しに差し替わっている)。部屋が無ければ置けない。
//   4. 当てている途中で投げても、DATA は元に戻る。
//   5. カタログの札(tags)をまだ読んでいないときは「読み込み中」の文で断る。
//   6. 要約の部品が、実物の呼び名と分類で動く(凍結間取り house-2f.json の文字数を出す)。
//
// 間取りは tools/tests/fixtures/house-2f.json(凍結間取り)を白紙の起動に入れて使う。
// sh tools/run_browser_tests.sh chat-ctx
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
  // 凍結間取りを入れる(既定プランの読み込みと同じ手順)
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

  const out = await page.evaluate(() => {
    const snap = () => JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v));
    const realData = DATA;
    const before = snap();
    // 当てている間に呼ばれてはいけない画面の関数を見張る
    const WATCH = ['draw2d', 'markDirty', 'saveState', 'build3D', 'rebuild3D', 'queueSharedSync', 'queueSharedLocalAutoSave',
      'sharedMarkIdsDirty', 'sharedMarkObjectsDirty', 'savePlanToStorage', 'updateProps'];
    const calls = {};
    const saved = {};
    WATCH.forEach((n) => {
      if (typeof window[n] !== 'function') return;
      saved[n] = window[n];
      window[n] = function () { calls[n] = (calls[n] || 0) + 1; return saved[n].apply(this, arguments); };
    });
    const res = { placed: [], refused: [], skipped: [], mismatch: [], indoor: null, groundKind: null };
    try {
      const room = DATA.rooms.find((r) => r.floor === 1 && r.w >= 3000 && r.d >= 3000) || DATA.rooms[0];
      const cx = room.x + room.w / 2, cy = room.y + room.d / 2;
      const tags = CATALOGUE_TAGS.items;
      Object.keys(ObjectKnowledge.KNOWLEDGE).forEach((kind) => {
        const r = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: kind, x: cx, y: cy, floor: 1 } }], planChatCtx());
        // fence・other は分類名として引かない(fence はアプリの種類名のブロック塀、other は受け皿)。
        if (kind === 'fence' || kind === 'other') {
          res.skipped.push({ kind, type: r.errors.length ? null : r.plan.items[r.plan.items.length - 1].type, message: r.errors.length ? r.errors[0].message : null });
          return;
        }
        if (r.errors.length) { res.refused.push({ kind, message: r.errors[0].message, candidates: r.errors[0].candidates || [] }); return; }
        const it = r.plan.items[r.plan.items.length - 1];
        const box = PlanFreeApply.KITCHEN_BOX[kind];
        const expected = box && kind !== 'cooking-appliance' ? box.type : PlanFreeApply.typeForKind(kind, 0, tags);
        if (it.type !== expected) res.mismatch.push({ kind, type: it.type, expected });
        res.placed.push({ kind, type: it.type, w: it.w, d: it.d, floor: it.floor, indoor: !!it.indoor });
      });
      // 地面に置く印の物(2階では部屋の中にしか置けない)
      const ground = res.placed.find((p) => { const f = getFmpItem(p.type); return f && f.groundLevel; });
      if (ground) {
        res.groundKind = ground.kind;
        const far = { x: 30000, y: 30000 };
        const without = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: ground.kind, x: far.x, y: far.y, floor: 2 } }], planChatCtx());
        const withRoom = PlanCoreOperations.applyOperations(DATA, [
          { op: 'addRoom', args: { name: '洗面所', floor: 2, x: far.x, y: far.y, w: 3000, d: 3000 } },
          { op: 'placeItem', args: { type: ground.kind, x: far.x, y: far.y, floor: 2 } },
        ], planChatCtx());
        const it = withRoom.errors.length ? null : withRoom.plan.items[withRoom.plan.items.length - 1];
        res.indoor = {
          withoutRoom: without.errors.map((e) => e.message),
          withRoomErrors: withRoom.errors.map((e) => e.message),
          floor: it && it.floor, indoor: it && !!it.indoor, roomId: withRoom.errors.length ? null : withRoom.plan.rooms[withRoom.plan.rooms.length - 1].id,
        };
      }
      // 利用者の格子が 910 でも、AI の指定どおりに置く・動かす(格子にも物の端にも吸着しない)
      const snapSaved = ST.snap, shiftSaved = ST.shiftKey;
      ST.snap = 910; ST.shiftKey = true;
      try {
        const put = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'bed', x: 1234, y: 5678, floor: 1 } }], planChatCtx());
        const bed = put.errors.length ? null : put.plan.items[put.plan.items.length - 1];
        const mover = DATA.items.find((o) => !o.locked && !isStairPartType(o.type) && o.type !== 'foundation' && (o.floor || 1) === 1);
        const mv = PlanCoreOperations.applyOperations(DATA, [{ op: 'moveObject', args: { id: String(mover.id), dx: 300, dy: 0 } }], planChatCtx());
        const moved = mv.errors.length ? null : mv.plan.items.find((o) => o.id === mover.id);
        res.snap = {
          errors: put.errors.concat(mv.errors).map((e) => e.message),
          center: bed ? [bed.x + bed.w / 2, bed.y + bed.d / 2] : null,
          dx: moved ? moved.x - mover.x : null, dy: moved ? moved.y - mover.y : null,
        };
      } finally { ST.snap = snapSaved; ST.shiftKey = shiftSaved; }
      // 読み取りで壁や天井に吊る分類は、読み取りと同じ取付の高さで置く
      res.mount = Object.keys(PlanFreeApply.MOUNT_ELEV_MM).map((kind) => {
        const r = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: kind, x: cx, y: cy, floor: 1 } }], planChatCtx());
        const it = r.errors.length ? null : r.plan.items[r.plan.items.length - 1];
        const imp = PlanFreeApply.toImportPlan({ floors: [{ floor: 1, objects: [{ kind, x: cx, y: cy, w: 900, d: 600, face: 'S' }] }] }, tags);
        const got = imp.items.find((x) => x.type === (it && it.type));
        return { kind, type: it && it.type, elev: it && it.elev, importElev: got && got.extra ? got.extra.elev : undefined, table: PlanFreeApply.MOUNT_ELEV_MM[kind] };
      });
      // 台になる物(調理台・机・棚など)の矩形の中に置いても、台に載せずに表の高さにする(読み取りと同じ)
      const surfaces = [];
      const seenSurface = {};
      DATA.items.forEach((s) => {
        if (!s || s.type === 'foundation' || !isPlacementSurfaceItem(s)) return;
        const cat = (getFmpItem(s.type) || {}).category || s.type;
        if (seenSurface[cat]) return;
        seenSurface[cat] = 1;
        surfaces.push(s);
      });
      res.mountOnSurface = [];
      surfaces.forEach((s) => {
        const sx = s.x + s.w / 2, sy = s.y + s.d / 2, floor = s.floor || 1;
        Object.keys(PlanFreeApply.MOUNT_ELEV_MM).forEach((kind) => {
          const r = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: kind, x: sx, y: sy, floor } }], planChatCtx());
          const it = r.errors.length ? null : r.plan.items[r.plan.items.length - 1];
          // 比べのため、同じ所に普通の小物(台に載る物)を置いて、そこが本当に台の上であることを確かめる
          const ref = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'decor', x: sx, y: sy, floor } }], planChatCtx());
          const refIt = ref.errors.length ? null : ref.plan.items[ref.plan.items.length - 1];
          res.mountOnSurface.push({ kind, surface: s.type, errors: r.errors.map((e) => e.message), elev: it && it.elev, table: PlanFreeApply.MOUNT_ELEV_MM[kind], decorElev: refIt && refIt.elev });
        });
      });
      // 途中で投げても戻る
      const ctx = planChatCtx();
      ctx.hooks.afterPlace = () => { throw new Error('わざと'); };
      const thrown = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'bed', x: cx, y: cy } }], ctx);
      res.thrown = { errors: thrown.errors.map((e) => e.message), same: DATA === realData };
      let seen = null;
      try { planChatCtx().withPlan({ walls: [], rooms: [], items: [] }, () => { seen = DATA; throw new Error('x'); }); } catch (e) { /* 投げ直される */ }
      res.withPlanDirect = { swapped: seen !== realData && !!seen, restored: DATA === realData };
      // 札がまだ無いとき
      const tagsSaved = CATALOGUE_TAGS;
      CATALOGUE_TAGS = null;
      try {
        const r = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'light', x: cx, y: cy } }], planChatCtx());
        res.loading = r.errors.map((e) => e.message);
        const r2 = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'sofa', x: cx, y: cy } }], planChatCtx());
        res.loadingDefault = r2.errors.length ? r2.errors[0].message : r2.plan.items[r2.plan.items.length - 1].type;
      } finally { CATALOGUE_TAGS = tagsSaved; }
      // AI の階の範囲・画面用の props は通さない
      const p5 = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'bed', x: cx, y: cy, floor: 5 } }], planChatCtx());
      const props = PlanCoreOperations.applyOperations(DATA, [{ op: 'setProps', args: { id: String(DATA.items[0].id), props: { color: '#fff' } } }], planChatCtx());
      res.guards = { floor5: p5.errors.length, props: props.errors.length };
      // 部屋を2つ続けて足しても id が重ならない
      const two = PlanCoreOperations.applyOperations(DATA, [
        { op: 'addRoom', args: { x: 30000, y: 0, w: 1000, d: 1000 } }, { op: 'addRoom', args: { x: 32000, y: 0, w: 1000, d: 1000 } },
      ], planChatCtx());
      res.roomIds = two.changedIds;
    } finally {
      WATCH.forEach((n) => { if (saved[n]) window[n] = saved[n]; });
    }
    res.calls = calls;
    res.sameRef = DATA === realData;
    res.sameJson = snap() === before;
    // 要約
    const summary = ChatPlanSummary.summarize(DATA, {
      selectedIds: [DATA.items[5].id],
      labelOf: (t) => itemTypeLabel(t),
      kindOf: (t) => (CATALOGUE_TAGS && CATALOGUE_TAGS.items && CATALOGUE_TAGS.items[t] ? CATALOGUE_TAGS.items[t].kind : null),
    });
    res.summaryLength = summary.length;
    res.summaryBytes = new TextEncoder().encode(summary).length;
    res.summaryCollapsed = (summary.match(/（まとめ）/g) || []).length;
    res.summaryHead = summary.split('\n').slice(0, 30);
    res.summaryItems = summary.split('\n').filter((l) => /^(\[選択中\] )?id=\S+ (?!部屋|壁)/.test(l)).slice(0, 12);
    res.modules = [typeof ChatClaudeStream, typeof ChatSession, typeof ChatPlanSummary];
    return res;
  });

  console.log(JSON.stringify({
    placed: out.placed.map((p) => p.kind + '→' + p.type),
    refused: out.refused, skipped: out.skipped, indoor: out.indoor, groundKind: out.groundKind, loading: out.loading, loadingDefault: out.loadingDefault,
    summaryLength: out.summaryLength, summaryBytes: out.summaryBytes, roomIds: out.roomIds, snap: out.snap, mount: out.mount, mountOnSurface: out.mountOnSurface,
  }, null, 1));
  if (process.env.CHAT_CTX_DUMP) {
    console.log(out.summaryHead.join('\n'));
    console.log('…');
    console.log(out.summaryItems.join('\n'));
  }

  assert.deepEqual(out.modules, ['object', 'object', 'object']);
  assert.deepEqual(out.mismatch, [], '置けた物の種類名が読み取りと同じ');
  assert.ok(out.placed.length >= 35, '置けた分類が少なすぎる: ' + out.placed.length);
  // 分類名と古い種類名が同じ綴りの物は、分類名の側で引く(古い種類にならない)
  for (const k of ['toilet', 'sofa', 'tv', 'dining-table', 'desk', 'closet', 'bed']) {
    const p = out.placed.find((x) => x.kind === k);
    assert.ok(p, k + ' が置けない');
    assert.ok(/^(fmp-|im0261-|original-)/.test(p.type), k + ' がカタログの種類でない: ' + p.type);
  }
  assert.deepEqual(out.skipped.map((x) => [x.kind, x.type]), [['fence', 'fence'], ['other', null]], 'fence はブロック塀(アプリの種類名)、other は置けない');
  const ku = out.refused.find((r) => r.kind === 'kitchen-unit');
  assert.ok(ku && /置けません/.test(ku.message) && ku.candidates.includes('kitchen-sink'), JSON.stringify(ku));
  // 本物の DATA は変わらない。見張った関数は呼ばれない
  assert.equal(out.sameRef, true);
  assert.equal(out.sameJson, true, '本物の DATA が変わった');
  assert.deepEqual(out.calls, {}, '当てている間に画面の関数が呼ばれた');
  // 差し替えが効いている(写しに足した部屋の屋内の判定)
  assert.ok(out.groundKind, '地面に置く印の分類が見つからない');
  assert.ok(out.indoor.withoutRoom.length > 0, '部屋が無いのに 2 階へ置けた');
  assert.deepEqual(out.indoor.withRoomErrors, []);
  assert.equal(out.indoor.floor, 2);
  assert.equal(out.indoor.indoor, true);
  assert.ok(String(out.indoor.roomId).startsWith('rm_'));
  // 投げても戻る
  assert.equal(out.thrown.same, true);
  assert.match(out.thrown.errors[0], /わざと/);
  assert.deepEqual(out.withPlanDirect, { swapped: true, restored: true });
  // 札がまだ無いとき
  assert.match(out.loading[0], /読み込み中/);
  assert.equal(out.loadingDefault, 'fmp-Sofa01', '既定のモデルがある分類は札が無くても置ける');
  assert.deepEqual(out.guards, { floor5: 1, props: 1 });
  assert.deepEqual(out.snap, { errors: [], center: [1234, 5678], dx: 300, dy: 0 }, '格子 910 でも指定どおり');
  assert.ok(out.mount.length >= 1);
  for (const m of out.mount) {
    assert.equal(m.elev, m.table, m.kind + ' の高さ');
    assert.equal(m.elev, m.importElev, m.kind + ' が読み取りと同じ高さ');
  }
  assert.ok(out.mountOnSurface.length >= 3, '台の上に置く場面が少ない: ' + out.mountOnSurface.length);
  for (const m of out.mountOnSurface) {
    assert.deepEqual(m.errors, [], m.kind + ' を ' + m.surface + ' の上に置けない');
    assert.ok(m.decorElev > 0, m.surface + ' の上が台になっていない(小物が載らない)');
    assert.equal(m.elev, m.table, m.kind + ' を ' + m.surface + ' の上に置いても表の高さ');
  }
  assert.equal(out.roomIds.length, 2);
  assert.notEqual(out.roomIds[0], out.roomIds[1]);
  assert.ok(out.summaryLength > 1000 && out.summaryBytes <= 24 * 1024);
  assert.deepEqual(errors, []);
  console.log('チャット用の ctx: 置けた分類 ' + out.placed.length + '・置けない分類 ' + out.refused.length + '、要約 ' + out.summaryLength + ' 文字・' + out.summaryBytes + ' バイト(まとめ ' + out.summaryCollapsed + ' 種類)');
} finally {
  await browser.close();
}
