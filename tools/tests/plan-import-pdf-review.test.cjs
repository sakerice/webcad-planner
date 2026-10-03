// PDF fallback review uses synthetic pages and mocked APIs only; no model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Identity = require('../../assets/js/plan-source-identity.js');
const identitySource = fs.readFileSync(path.join(__dirname, '../../assets/js/plan-source-identity.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../../assets/js/plan-import.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup({ boxes = [null], renderRegion, renderPages, fetchReply, deferImages = false, headers = [] } = {}) {
  const elements = {}, images = [], sends = [], renders = [], timers = new Map();
  const context2d = new Proxy({}, { get: () => () => {} });
  function element() { return { style: {}, value: '', textContent: '', children: [],
    appendChild(v) { this.children.push(v); }, classList: { add() {}, remove() {} },
    addEventListener() {}, getContext: () => context2d, width: 1000, height: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    toDataURL: () => 'data:image/png;manual' }; }
  const c = { console, Promise, Number, JSON, Date, isFinite, Uint8Array,
    document: { readyState: 'loading', addEventListener() {},
      getElementById: id => elements[id] || (elements[id] = element()), createElement: element },
    addEventListener() {},
    setTimeout(fn) { const n = timers.size + 1; timers.set(n, fn); return n; },
    clearTimeout(n) { timers.delete(n); },
    FileReader: class { readAsDataURL(file) { Promise.resolve().then(() => this.onload({ target: { result: file.name } })); } },
    Image: class { naturalWidth = 1000; naturalHeight = 800; set src(v) {
      this._src = v; images.push(this); if (!deferImages) Promise.resolve().then(() => this.onload());
    } },
    PdfPages: {
      renderPages: renderPages || (() => Promise.resolve(boxes.map((_, i) => `source-${i}`))),
      renderRegion(pdf, page, box, options) {
        renders.push({ pdf, page, box, options });
        return renderRegion ? renderRegion(pdf, page, box, options) : Promise.resolve(`crop-${page}`);
      }
    },
    fetch: async (url, options) => {
      if (url.includes('find-plan')) {
        const i = Number(JSON.parse(options.body).image.split('-').pop());
        if (boxes[i] instanceof Error) throw boxes[i];
        return { ok: true, json: async () => ({ box: boxes[i], sourceHeader: headers[i] }) };
      }
      if (url.includes('import-plan')) sends.push(JSON.parse(options.body));
      if (fetchReply) return fetchReply(url, options);
      return { status: 503, ok: false, headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ error: 'ai_not_configured' }), json: async () => ({}) };
    }
  };
  c.self = c; vm.createContext(c); vm.runInContext(identitySource, c); vm.runInContext(source, c);
  return { c, elements, images, sends, renders, timers,
    load: async (name = 'sample.pdf', type = 'application/pdf') => {
      c.onPlanImportFile({ files: [{ name, type }] }); await tick();
    } };
}
(async () => {
  const valid = { x0: .1, y0: .2, x1: .7, y1: .8 };
  for (const box of [null, new Error('network'), { ...valid, x0: -.1 }, { ...valid, x1: 2 },
    { ...valid, x1: .1 }, { ...valid, y1: NaN }, { ...valid, y1: '0.8' }]) {
    const h = setup({ boxes: [box] }); await h.load();
    assert.equal(h.c.PlanImport.state.pageReview[0].confirmed, false);
    assert.equal(h.elements['plan-import-run'].disabled, true);
    assert.equal(h.renders.length, 0, 'invalid bbox must not reach PDF renderer');
    assert.match(h.elements['plan-import-page-status'].textContent, /要確認/);
    assert.equal(h.elements['plan-import-output'].src, 'source-0');
    h.c.runPlanImport(); await tick(); assert.equal(h.sends.length, 0, 'direct invocation also gated');
    h.c.confirmPlanImportPage();
    assert.equal(h.elements['plan-import-run'].disabled, false);
    h.c.runPlanImport(); await tick();
    assert.equal(h.sends[0].images[0], 'source-0');
    assert.match(h.elements['plan-import-status'].textContent, /まだAIの読み取りを使えません/,
      'review summary must not overwrite extraction error');
  }
  for (const result of [() => Promise.reject(new Error('render')), () => Promise.resolve(null), () => { throw new Error('sync render'); }]) {
    const h = setup({ boxes: [valid], renderRegion: result }); await h.load();
    assert.equal(h.c.PlanImport.state.pages[0], 'source-0');
    assert.equal(h.c.PlanImport.state.pageReview[0].confirmed, false);
    assert.match(h.elements['plan-import-page-status'].textContent, /切り出しに失敗/);
  }
  const h = setup({ boxes: [valid, null] }); await h.load();
  assert.equal(h.renders[0].options.maxPx, 3072);
  assert.deepEqual(h.renders[0].box, valid);
  assert.equal(h.c.PlanImport.state.pages[0], 'crop-1', 'successful bytes unchanged');
  assert.equal(h.elements['plan-import-output'].src, 'crop-1');
  assert.equal(h.c.PlanImport.state.crop.x, 100);
  assert.equal(h.elements['plan-import-run'].disabled, true, 'other failed pages still block');
  h.c.selectPlanImportPage(1); await tick();
  assert.equal(h.elements['plan-import-output'].src, 'source-1');
  assert.match(h.elements['plan-import-page-status'].textContent, /2ページ: 要確認/);
  h.c.confirmPlanImportPage(); h.c.selectPlanImportPage(0); await tick();
  assert.equal(h.elements['plan-import-run'].disabled, false);
  h.c.planImportSelectAll();
  assert.equal(h.elements['plan-import-run'].disabled, true, 'reset crop requires new confirmation');
  h.c.PlanImport.state.drag = { x: 100, y: 200, w: 400, h: 300 };
  h.c.planImportUp(); await tick();
  assert.equal(h.c.PlanImport.state.pageReview[0].status, '手動で切り出し済み');
  assert.equal(h.renders.at(-1).page, 1);
  assert.equal(h.renders.at(-1).options.maxPx, 3072);
  assert.equal(h.elements['plan-import-run'].disabled, false);
  // Stale decode from a previously selected page cannot replace the current source.
  const previews = setup({ boxes: [null, null], deferImages: true }); await previews.load();
  previews.c.selectPlanImportPage(1);
  previews.images[1].onload(); previews.images[0].onload();
  assert.equal(previews.c.PlanImport.state.image._src, 'source-1');
  // Replacement and cancel/reset invalidate old asynchronous PDF preprocessing.
  for (const action of ['reset', 'close', 'replace']) {
    const pending = deferred(); const h = setup({ renderPages: () => pending.promise });
    await h.load();
    if (action === 'reset') h.c.resetPlanImport();
    if (action === 'close') h.c.closePlanImport();
    if (action === 'replace') await h.load('new.png', 'image/png');
    pending.resolve(['old-source']); await tick();
    assert.equal(h.c.PlanImport.state.pages, null);
    assert.equal(h.c.PlanImport.state.busy, false);
    if (action === 'replace') assert.equal(h.c.PlanImport.state.image._src, 'new.png');
  }
  // Late manual rerender must not overwrite a newer file.
  const pending = deferred(); const manual = setup({ renderRegion: () => pending.promise });
  await manual.load(); manual.c.PlanImport.state.drag = { x: 100, y: 100, w: 200, h: 200 };
  manual.c.planImportUp(); await tick(); await manual.load('new.png', 'image/png');
  pending.resolve('old-crop'); await tick();
  assert.equal(manual.c.PlanImport.state.pages, null);
  assert.equal(manual.c.PlanImport.state.image._src, 'new.png');
  // Whole-page drags still require explicit acknowledgment; interrupted drags do not commit.
  const all = setup(); await all.load();
  all.c.PlanImport.state.drag = { x: 0, y: 0, w: 1000, h: 800 };
  all.c.planImportUp(); await tick();
  assert.equal(all.renders.length, 0);
  assert.equal(all.elements['plan-import-run'].disabled, true);
  all.c.confirmPlanImportPage();
  all.c.planImportDown({ clientX: 0, clientY: 0, preventDefault() {} });
  assert.equal(all.elements['plan-import-run'].disabled, true);
  all.c.closePlanImport();
  assert.equal(all.c.PlanImport.state.drag, null);
  assert.equal(all.elements['plan-import-run'].disabled, false, 'closing a drag must restore buttons');
  all.c.PlanImport.state.drag = { x: 100, y: 100, w: 200, h: 200 };
  all.c.cancelPlanImportDrag(); await tick();
  assert.equal(all.renders.length, 0, 'touchcancel must not commit a crop');
  // A reset in the same tick must not even start a stale manual rerender.
  all.c.PlanImport.state.drag = { x: 100, y: 100, w: 200, h: 200 };
  all.c.planImportUp(); all.c.resetPlanImport(); await tick();
  assert.equal(all.renders.length, 0);
  // Prepare, review, read, and cancel must never mutate the live editor.
  const response = body => ({ status: 200, text: async () => JSON.stringify(body), json: async () => body });
  const draft = { plan: { walls: [], rooms: [], items: [] }, pages: [{floors:[{floor:1}]}], revise: { skipAll: true } };
  const live = setup({ boxes: [valid], fetchReply: () => response(draft) });
  live.c.DATA = { walls: [{ id: 'existing-wall' }], rooms: [{ n: 'existing-room' }], northDeg: 35 };
  live.c.ST = { floor: 2 };
  const before = JSON.stringify({ data: live.c.DATA, editor: live.c.ST });
  await live.load(); live.c.runPlanImport(); await tick();
  assert.ok(live.c.PlanImport.state.result, 'successful draft was not returned');
  assert.equal(live.sends[0].images[0], 'crop-1');
  live.c.closePlanImport(); live.c.resetPlanImport();
  assert.equal(JSON.stringify({ data: live.c.DATA, editor: live.c.ST }), before);
  // Cancelled extraction and revision replies must not update a new file or start polls.
  for (const stage of ['import', 'revise']) {
    const reply = deferred(); let polls = 0;
    const stale = setup({ boxes: [valid], fetchReply: (url) => {
      if (url.includes('plan-result')) { polls++; return response({ pending: false }); }
      if (url.includes(stage + '-plan')) return reply.promise;
      return response({ ...draft, revise: null, pages: [{ floors: [] }] });
    } });
    stale.c.PlanReviewDraw = { drawPage: () => 'synthetic-review' };
    await stale.load(); stale.c.runPlanImport(); await tick();
    stale.c.closePlanImport(); await stale.load('replacement.png', 'image/png');
    const status = stale.elements['plan-import-status'].textContent;
    reply.resolve(response({ jobs: ['synthetic-job'] })); await tick();
    assert.equal(polls, 0, stage + ' reply started a poll after cancellation');
    assert.equal(stale.c.PlanImport.state.result, null);
    assert.equal(stale.elements['plan-import-status'].textContent, status);
  }
  // Header evidence is captured outside the crop and keeps original page identity after reorder.
  const header = floor => Identity.header({pageKind:'floor-plan',labels:[{text:floor+'F',x0:.4,y0:.01,x1:.5,y1:.04}]});
  const identity = setup({boxes:[valid,valid,valid],headers:[header(3),header(1),header(2)]}); await identity.load();
  const original = JSON.parse(JSON.stringify(identity.c.PlanImport.state.pageReview.map(p=>p.sourceIdentity)));
  assert.deepEqual(original.map(p=>p.sourceHeader.floorIds[0]),[3,1,2]);
  assert.ok(original[0].sourceHeader.evidence[0].box.y1 < original[0].cropBox.y0);
  assert.ok(Object.isFrozen(identity.c.PlanImport.state.pageReview[0].sourceIdentity));
  identity.c.closePlanImport(); identity.c.openPlanImport(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(identity.c.PlanImport.state.pageReview.map(p=>p.sourceIdentity))),original,'reopen does not relabel source pages');
  identity.c.PlanImport.state.pageReview.reverse();identity.c.PlanImport.state.pages.reverse();
  identity.c.selectPlanImportPage(0);await tick();
  identity.c.PlanImport.state.drag={x:100,y:100,w:400,h:300};identity.c.planImportUp();await tick();
  assert.equal(identity.renders.at(-1).page,3,'manual recrop uses immutable original PDF page number');
  identity.c.runPlanImport();await tick();
  assert.deepEqual(identity.sends[0].sourcePages.map(p=>p.pageNumber),[3,2,1]);
  assert.deepEqual(identity.sends[0].sourcePages.map(p=>p.sourceHeader.floorIds[0]),[2,1,3]);
  assert.deepEqual(identity.sends[0].sourcePages.map(p=>p.sourcePageHash),original.slice().reverse().map(p=>p.sourcePageHash));
  // A pending result cannot reattach metadata to a replacement file, even if floor IDs match.
  const late=deferred();const staleIdentity=setup({boxes:[valid],headers:[header(1)],fetchReply:()=>late.promise});
  await staleIdentity.load();staleIdentity.c.runPlanImport();await tick();
  const oldIdentity=staleIdentity.c.PlanImport.state.pageReview[0].sourceIdentity.sourcePageId;
  await staleIdentity.load('replacement.pdf');
  assert.notEqual(staleIdentity.c.PlanImport.state.pageReview[0].sourceIdentity.sourcePageId,oldIdentity);
  late.resolve(response(draft));await tick();assert.equal(staleIdentity.c.PlanImport.state.result,null);
  // Locator replies from old servers still crop but never manufacture header evidence.
  const unknown=setup({boxes:[valid]});await unknown.load();
  assert.equal(unknown.c.PlanImport.state.pageReview[0].sourceIdentity.sourceHeader.status,'unknown');
  // Model conflict with a separately retained header is blocked before finish/apply.
  const conflict=setup({boxes:[valid],headers:[header(3)],fetchReply:()=>response(draft)});
  await conflict.load();conflict.c.runPlanImport();await tick();
  assert.equal(conflict.c.PlanImport.state.result,null);
  assert.match(conflict.elements['plan-import-status'].textContent,/見出し/);
  console.log('plan-import-pdf-review: fallback gating, crop success/failure, page preview, confirmation and stale-result checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
