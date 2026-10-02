// Untouched fresh native Astra output, extracted blind from all 3 original sheets.
// This native wrapper's opaque page IDs are not runtime data-URL hash attestations.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const R=require('../../assets/js/plan-registration.js');
const file=__dirname+'/fixtures/registration/native-astra-three-floor.raw.json';
const bytes=fs.readFileSync(file),raw=JSON.parse(bytes),original=JSON.stringify(raw);
async function finalized(){
 const {mergeReadPages}=await import('../../worker/plan-pages.mjs'),{finishImportedPlan}=await import('../../worker/routes-ai.mjs');
 const merged=mergeReadPages(raw.pages.map(p=>p.reading));
 // Transport metadata only: preserve wrapper IDs separately from floor readings.
 merged.floors=merged.floors.map(f=>({...f,sourcePageId:raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor)).sourcePageId}));
 const res=finishImportedPlan({...merged,buildingRegistration:raw.buildingRegistration},null,{});assert.equal(res.status,200);return res.json();
}
test('untouched real three-page reading finalizes and proposes registration but never autoapproves',async()=>{
 const body=await finalized(),r=R.compile(body.sourceLocal,{proposals:body.buildingRegistration});
 assert.equal(body.buildingReview.canApply,false);assert.equal(r.canApply,false);assert.ok(r.diagnostics.some(d=>d.code==='registration_unreviewed'));assert.ok(r.diagnostics.some(d=>d.code==='floor_identity_unknown'));
 assert.equal(r.poses[1].dy,0);assert.equal(r.poses[2].dy,0);assert.equal(r.poses[3].dy,455);assert.equal(r.poses[3].quarterTurns,0);
 assert.ok(r.floors[2].solution.residuals.some(a=>a.precisionMm>=85));assert.ok(r.floors[2].solution.residuals.every(a=>a.residualMm===0));
 assert.equal(JSON.stringify(raw),original);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),crypto.createHash('sha256').update(bytes).digest('hex'));
});
test('explicit simulated review of actual native reading applies partial geometry and preserves deferred symbols, save/load/Undo',async()=>{
 const {runtime}=require('./scene-fixtures.cjs'),{createReviewDocument}=require('./scene-review-dom.cjs'),c=runtime(),document=createReviewDocument();c.document=document;c.PlanRegistration=R;
 const host=document.createElement('section');host.id='plan-import-step3';document.body.appendChild(host);
 for(const id of ['plan-import-modal','plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost','plan-import-apply']){const e=document.createElement(id==='plan-import-apply'?'button':'div');e.id=id;host.appendChild(e);}
 const body=await finalized(),sourceBefore=JSON.stringify(body.sourceLocal);c.PlanImport.stageBuildingReview(body);assert.equal(document.getElementById('plan-import-apply').disabled,true);
 for(const floor of [1,2,3]){const group=document.querySelector('details[data-building-floor="'+floor+'"]');group.querySelector('[data-building-identity]').click();group.querySelector('[data-building-identity-evidence]').value='Test-only simulated review of printed full-page '+floor+'階 title';group.querySelector('[data-building-confirm]').click();}
 document.querySelector('[data-building-partial]').click();assert.equal(document.getElementById('plan-import-apply').disabled,false);c.applyPlanImport();
 assert.ok(c.DATA.rooms.length>10);assert.equal(c.DATA.items.some(i=>/^stair/.test(i.type)),false);assert.ok(c.DATA.rooms.some(r=>r.floor===1&&/トイレ|収納/.test(r.n)),'occupied ground-floor spaces under projected upper treads are retained');
 const report=c.DATA.sceneReconstructionReports[0];assert.equal(report.status,'partial-building-assembly');assert.equal(JSON.stringify(report.sourceLocal),sourceBefore);assert.ok(report.deferredItems.length);assert.ok(report.sourceLocal.marks.some(m=>/DN/.test(m.label)),'arrival mark remains source evidence even without a stair item');assert.equal(report.poses[3].dy,455);
 assert.deepEqual(JSON.parse(JSON.stringify(c.DATA)).sceneReconstructionReports[0],JSON.parse(JSON.stringify(report)));assert.equal(JSON.parse(c.HISTORY[0]).rooms.length,0);assert.equal(JSON.stringify(raw),original);
});
