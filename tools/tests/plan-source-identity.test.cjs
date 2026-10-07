// Offline only: source sheets, crops and all provider responses are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const Identity = require('../../assets/js/plan-source-identity.js');
const PNG = n => 'data:image/png;base64,' + Buffer.from('synthetic-crop-' + n).toString('base64');
const crop = {x0:.1,y0:.25,x1:.7,y1:.6};
const header = (label, pageKind='floor-plan') => ({pageKind,labels:[{text:label,x0:.4,y0:.02,x1:.6,y1:.06}]});
const source = (floor, page=1, label=floor+'F') => Identity.cropPage(Identity.createPage('full-page-'+floor, page, 'synthetic-document', header(label)), crop, PNG(floor));
const reading = floor => ({floors:[{floor,width:1820,depth:1820,rooms:[{name:'A',parts:[{x0:0,y0:0,x1:1820,y1:1820}]}],items:[]}],notes:[]});

test('SHA256 agrees with native UTF-8 hashing without large byte buffers', () => {
  for (const text of ['', 'abc', '1階平面図・俯瞰図', 'x'.repeat(10000)])
    assert.equal(Identity.hash(text), 'sha256:'+createHash('sha256').update(text).digest('hex'));
});
test('header outside crop and full source hashes are immutable, crop hashes change independently', () => {
  const first=source(3,1), before=JSON.stringify(first), changed=Identity.cropPage(first,{...crop,x0:.2},PNG(30));
  assert.ok(first.sourceHeader.evidence[0].box.y1 < first.cropBox.y0);
  assert.equal(first.sourcePageId,changed.sourcePageId);
  assert.equal(first.sourcePageHash,changed.sourcePageHash);
  assert.notEqual(first.cropImageHash,changed.cropImageHash);
  assert.equal(JSON.stringify(first),before); assert.ok(Object.isFrozen(first.sourceHeader.evidence[0]));
  assert.deepEqual(Identity.normalizePages([first],[PNG(3)]).problems,[]);
  assert.ok(Identity.normalizePages([first],[PNG(30)]).problems.length);
});
test('reordered PDF page ordinals never become floor numbers', async () => {
  const {mergeReadPages}=await import('../../worker/plan-pages.mjs');
  const pages=[reading(3),reading(1),reading(2)], sources=[source(3,1),source(1,2),source(2,3)];
  const before=JSON.stringify({pages,sources});
  const merged=mergeReadPages(pages,sources);
  assert.deepEqual(merged.floors.map(f=>f.floor),[3,1,2]);
  assert.deepEqual(merged.floors.map(f=>f.sourceIdentity.pageNumber),[1,2,3]);
  assert.ok(merged.floors.every(f=>f.sourceIdentity.status==='confirmed'));
  assert.deepEqual(merged.pageProblems,[]);assert.equal(JSON.stringify({pages,sources}),before);
  const {decodeCompactPlan}=await import('../../worker/plan-prompt.mjs');
  const decoded=decodeCompactPlan(merged);
  assert.deepEqual(decoded.floors.map(f=>f.sourcePageId),sources.map(s=>s.sourcePageId));
  assert.deepEqual(decoded.floors.map(f=>f.sourceIdentity.sourceHeader.floorIds[0]),[3,1,2]);
});
test('unknown, missing, unsupported and multiple headers stay explicit uncertainty', () => {
  assert.equal(Identity.header(null).status,'unknown');
  assert.deepEqual(Identity.header(header('施主名 Private Person 住所')).labels,[],'unrelated title block text is never forwarded');
  assert.equal(Identity.header({pageKind:'floor-plan',labels:[]}).status,'unknown');
  assert.equal(Identity.header(header('3')).status,'unsupported','page ordinal must not become a floor');
  for(const label of ['6F','B1F','RF','屋上'])assert.equal(Identity.header(header(label)).status,'unsupported');
  for(const label of ['1F','2階','3階平面図・俯瞰図','Floor 4','5th Floor'])assert.equal(Identity.header(header(label)).status,'explicit');
  assert.equal(Identity.header({pageKind:'floor-plan',labels:['1F','2F']}).status,'ambiguous');
  assert.equal(Identity.header(header('1F','multiple-floor-plans')).status,'ambiguous');
  for(const kind of ['roof-plan','perspective'])assert.equal(Identity.header(header('3F',kind)).status,'non-floor');
  const unknown=Identity.createPage('full',1,'doc',null);
  const got=Identity.reconcile([reading(3)],[unknown]);
  assert.equal(got.pages[0].floors[0].sourceIdentity.status,'unknown');
  assert.equal(got.pages[0].floors[0].floor,3);
});
test('duplicate headers, model conflicts and perspective floors never become partial houses', async () => {
  const {mergeReadPages}=await import('../../worker/plan-pages.mjs');
  const cases=[
    [[reading(1),reading(2)],[source(1,1),source(2,2,'1F')]],
    [[reading(1)],[source(3)]],
    [[{walls:[{floor:1}]}],[source(3)]],
    [[{floors:[reading(1).floors[0],reading(2).floors[0]],notes:[]}],[source(1)]],
    [[reading(3)],[Identity.cropPage(Identity.createPage('perspective',1,'doc',header('3F','perspective')),crop,PNG(3))]],
  ];
  for(const [pages,sources] of cases){const got=mergeReadPages(pages,sources);assert.ok(got.pageProblems.length);assert.deepEqual(got.floors,[]);}
  const fake=reading(1);fake.floors[0].sourceIdentity={status:'confirmed',sourcePageId:'invented'};
  assert.equal(Identity.reconcile([fake],null).pages[0].floors[0].sourceIdentity,undefined);
});
test('actual three-storey sample identifies floor headers independently of page images', async () => {
  const pdf=fs.readFileSync('tools/tests/fixtures/madori-3f.pdf'); assert.ok(pdf.length>1000);
  const pdfjs=await import('../../assets/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=pathToFileURL(join(__dirname,'../../assets/vendor/pdfjs/pdf.worker.min.mjs')).href;
  const doc=await pdfjs.getDocument({data:new Uint8Array(pdf),isEvalSupported:false,disableFontFace:true}).promise;
  const titles=[];
  try {
    for(let i=1;i<=doc.numPages;i++) {
      const page=await doc.getPage(i), text=await page.getTextContent(), title=text.items.find(item=>/階平面図/.test(item.str));
      titles.push(title.str);
      assert.ok(1-title.transform[5]/page.getViewport({scale:1}).height<crop.y0,'actual header lies outside the plan crop');
    }
  } finally { await doc.destroy(); }
  assert.deepEqual(titles,['1階平面図・俯瞰図','2階平面図・俯瞰図','3階平面図・俯瞰図']);
  assert.deepEqual([titles[2],titles[0],titles[1]].map(label=>Identity.header(header(label)).floorIds[0]),[3,1,2]);
});

async function call(route, body, fetchImpl) {
  const {handleAi}=await import('../../worker/routes-ai.mjs');
  const url=new URL('https://example.test/api/ai/'+route);
  const request=new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await handleAi(request,{OPENAI_API_KEY:'mock-source-test-key',AI_LOCATE_PROVIDER:'openai'},url,{fetchImpl});
  return {status:result.status,body:await result.json()};
}
const provider = (id, value) => new Response(JSON.stringify({id,status:'completed',output:[{content:[{text:JSON.stringify(value)}]}],usage:{}}),{headers:{'content-type':'application/json'}});
test('locator retains header outside crop using the same single mocked provider call; old responses remain unknown', async () => {
  for(const include of [true,false]){
    let calls=0;
    const result=await call('find-plan',{image:PNG(1)},async request=>{
      calls++;const wire=await request.json();assert.match(JSON.stringify(wire),/sourceHeader/);
      return provider('locate', {found:true,x0:100,y0:250,x1:700,y1:600,...(include?{sourceHeader:{pageKind:'floor-plan',labels:[{text:'3階平面図・俯瞰図',x0:400,y0:20,x1:600,y1:60}]}}:{})});
    });
    assert.equal(result.status,200);assert.equal(calls,1);assert.ok(result.body.box);
    assert.equal(result.body.sourceHeader.status,include?'explicit':'unknown');
    if(include)assert.ok(result.body.sourceHeader.evidence[0].box.y1<result.body.box.y0);
  }
});
test('signed source metadata survives reordered jobs; polling cannot replace it or create extra provider calls', async () => {
  let starts=0, polls=0;const sourcePages=[source(3,1),source(1,2)];
  const fetchImpl=async request=>{
    if(request.method==='POST'){
      const wire=await request.json();assert.match(JSON.stringify(wire),/順番は階数を表しません/);
      assert.match(JSON.stringify(wire),/sourceHeader|元ページ見出し/);
      const n=starts++;return new Response(JSON.stringify({id:'job_'+n,status:'queued'}));
    }
    polls++;const floor=request.url.endsWith('job_0')?3:1;
    return provider(request.url.split('/').pop(),reading(floor));
  };
  const begun=await call('import-plan',{images:[PNG(3),PNG(1)],sourcePages},fetchImpl);
  assert.equal(begun.status,200);assert.equal(starts,2);
  const done=await call('plan-result',{jobs:begun.body.jobs.slice().reverse(),sourcePages:sourcePages.map(s=>({...s,sourceHeader:header('5F')}))},fetchImpl);
  assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(polls,2);assert.equal(starts,2);
  assert.deepEqual(done.body.pages.map(p=>p.floors[0].floor),[1,3]);
  assert.deepEqual(done.body.pages.map(p=>p.floors[0].sourceIdentity.sourceHeader.floorIds[0]),[1,3]);
  assert.deepEqual(done.body.pages.map(p=>p.sourcePageId),sourcePages.slice().reverse().map(s=>s.sourcePageId));
  assert.deepEqual(done.body.sourceLocal.floors.map(f=>f.sourceIdentity.status),['confirmed','confirmed']);
  const bad=await call('plan-result',{jobs:[begun.body.jobs[0].replace('source:','tamper:')]},fetchImpl);
  assert.equal(bad.status,400);assert.equal(polls,2);
});
test('image hash changes are rejected before a model call and old image-only requests remain compatible', async () => {
  let calls=0;const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({id:'old-job',status:'queued'}));};
  const bad=await call('import-plan',{images:[PNG(2)],sourcePages:[source(1)]},fetchImpl);
  assert.equal(bad.status,400);assert.equal(calls,0);
  const old=await call('import-plan',{images:[PNG(1)]},fetchImpl);
  assert.equal(old.status,200);assert.match(old.body.jobs[0],/^old-job\.[0-9a-f]{32}$/);assert.equal(calls,1);
});
test('revision carries original header/hash identity even when its model omits provenance or contradicts the header', async () => {
  const sources=[source(3)], pages=[reading(3)];
  for(const returnedFloor of [3,1]) {
    let starts=0,polls=0;
    const fetchImpl=async request=>{
      if(request.method==='POST') {
        starts++; const wire=await request.json(); assert.match(JSON.stringify(wire),/3F/);
        return new Response(JSON.stringify({id:'revise-source',status:'queued'}));
      }
      polls++;return provider('revise-source',reading(returnedFloor));
    };
    const begun=await call('revise-plan',{images:[PNG(3)],renders:[PNG(30)],pages,sourcePages:sources},fetchImpl);
    assert.equal(begun.status,200);
    const done=await call('plan-result',{jobs:begun.body.jobs,revised:true},fetchImpl);
    assert.equal(starts,1);assert.equal(polls,1);
    assert.equal(done.status,returnedFloor===3?200:422);
    assert.equal(done.body.pages[0].floors[0].sourceIdentity.sourcePageHash,sources[0].sourcePageHash);
    assert.equal(done.body.pages[0].floors[0].sourceIdentity.cropImageHash,sources[0].cropImageHash);
    assert.equal(done.body.pages[0].floors[0].sourceIdentity.status,returnedFloor===3?'confirmed':'conflict');
    if(returnedFloor!==3)assert.equal(done.body.revisionCandidate,false);
  }
});
test('single PDF with missing header cannot apply until explicit source-bound floor review; old single images remain unchanged', async () => {
  const {mergeReadPages}=await import('../../worker/plan-pages.mjs');
  const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
  const Registration=require('../../assets/js/plan-registration.js');
  const unknown=Identity.cropPage(Identity.createPage('full page',1,'doc',null),crop,PNG(3));
  const unknownResult=await (finishImportedPlan(mergeReadPages([reading(3)],[unknown]))).json();
  assert.ok(unknownResult.sourceLocal);
  const held=Registration.compile(unknownResult.sourceLocal);
  assert.equal(held.canApply,false);assert.ok(held.diagnostics.some(d=>d.code==='floor_identity_unknown'));
  const proposals={version:1,floors:[]};
  const reviewed=Registration.compile(unknownResult.sourceLocal,{sourceSnapshot:Registration.snapshot(unknownResult.sourceLocal),
    proposalSnapshot:Registration.snapshot(proposals),proposals,
    floors:[{floor:3,sourcePageId:unknown.sourcePageId,identityConfirmed:true,identityEvidence:'User checked 3F title on the full source sheet'}]});
  assert.equal(reviewed.canApply,true);
  const explicit=await finishImportedPlan(mergeReadPages([reading(3)],[source(3)])).json();
  assert.equal(explicit.sourceLocal,undefined);
  const old=await finishImportedPlan(mergeReadPages([reading(1)])).json();
  assert.equal(old.sourceLocal,undefined);assert.ok(old.plan);
});
