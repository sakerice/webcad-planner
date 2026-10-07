const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../../assets/js/plan-registration.js');
const {runtime}=require('./scene-fixtures.cjs'),{createReviewDocument}=require('./scene-review-dom.cjs');
async function setup(){
 const raw=JSON.parse(fs.readFileSync(__dirname+'/fixtures/registration/native-astra-three-floor.raw.json'));
 const {mergeReadPages}=await import('../../worker/plan-pages.mjs'),{finishImportedPlan}=await import('../../worker/routes-ai.mjs');
 const merged=mergeReadPages(raw.pages.map(p=>p.reading));merged.floors=merged.floors.map(f=>({...f,sourcePageId:raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor)).sourcePageId}));
 const res=finishImportedPlan({...merged,buildingRegistration:raw.buildingRegistration},null,{}),body=await res.json();
 const c=runtime(),doc=createReviewDocument();c.document=doc;c.PlanRegistration=R;c.SourceObjectMapping=require('../../assets/js/source-object-mapping.js');c.SourceStairDisplay=require('../../assets/js/source-stair-display.js');
 const host=doc.createElement('section');host.id='plan-import-step3';doc.body.appendChild(host);
 for(const id of ['plan-import-modal','plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost','plan-import-apply']){const e=doc.createElement(id==='plan-import-apply'?'button':'div');e.id=id;host.appendChild(e);}
 c.PlanImport.stageBuildingReview(body);
 for(const floor of [1,2,3]){const group=doc.querySelector('details[data-building-floor="'+floor+'"]');group.querySelector('[data-building-identity]').click();group.querySelector('[data-building-identity-evidence]').value='Test-only source title confirmation';group.querySelector('[data-building-confirm]').click();}
 doc.querySelector('[data-building-partial]').click();return {c,doc,body};
}
test('reviewed native stairs apply at registered source locations with saved assumptions and actual Undo/Redo',async()=>{
 const {c,doc,body}=await setup(),vm=require('node:vm'),{topLevelFunction}=require('./height-runtime.cjs');
 Object.assign(c,{REDO_HISTORY:[],HISTORY_LIMIT:100,DRAG:{active:false},ren:null,syncNorthFromPlan(){},ensureFloorMetadata(){},clearMultiSelection(){},sharedForceFullSync(){},markDirty(){},draw2d(){},sharedRememberEditTargets(){}});
 for(const name of ['serializeDataSnapshot','pushHistorySnapshot','saveState','restoreHistorySnapshot','undoAction','redoAction'])vm.runInContext(topLevelFunction(name),c);
 const before=c.serializeDataSnapshot(),source=JSON.stringify(body.sourceLocal),index=c.SourceStairDisplay.candidates(body.sourceLocal)[0].sourceItemIndex;
 doc.querySelector('[data-stair-field="'+index+':displayRiseMm"]').value='1800';doc.querySelector('[data-stair-field="'+index+':partOrder"]').value='1';doc.querySelector('[data-source-stair="'+index+'"]').click();c.applyPlanImport();
 const stair=c.DATA.items.find(i=>i.stairDisplayOnly);assert.ok(stair);assert.equal(stair.displayRiseMm,1800);assert.equal(stair.displayBaseOffsetMm,0);assert.equal(stair.sourceStairDisplay.measured,false);assert.equal(stair.sourceStairDisplay.physicalConnection,false);assert.equal(stair.sourceStairDisplay.targetFloor,2);
 assert.equal(stair.x+stair.w/2,body.sourceLocal.items[index].x);assert.equal(stair.rot,270);assert.equal(c.DATA.sceneReconstructionReports[0].stairDisplayDecisions.length,1);
 const after=c.serializeDataSnapshot();c.DATA=JSON.parse(after);c.undoAction();assert.equal(c.serializeDataSnapshot(),before);c.redoAction();assert.equal(c.serializeDataSnapshot(),after);assert.equal(JSON.stringify(body.sourceLocal),source);
});
test('stale or missing stair height decisions refuse before IDs/history; geometry review edits clear them',async()=>{
 const {c,doc,body}=await setup(),index=c.SourceStairDisplay.candidates(body.sourceLocal)[0].sourceItemIndex;
 doc.querySelector('[data-source-stair="'+index+'"]').click();const before=JSON.stringify(c.DATA),id=c.nextId;c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.nextId,id);assert.equal(c.HISTORY.length,0);
 body.stairDisplayDecisions[0].proposalSnapshot='stale';c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),before);
 const group=doc.querySelector('details[data-building-floor="1"]'),input=[...group.querySelectorAll('[data-building-anchor]')].find(e=>e.getAttribute('data-building-anchor').endsWith(':building.x'));input.value=String(Number(input.value)+100);input.dispatchEvent({type:'input'});
 assert.equal(body.stairDisplayDecisions.length,0);assert.equal(doc.querySelector('[data-source-stair="'+index+'"]').checked,false);
});

test('native direction conflict is visible and reviewed flip is retained outside immutable source',async()=>{
 const {c,doc,body}=await setup(),source=JSON.stringify(body.sourceLocal),candidate=c.SourceStairDisplay.candidates(body.sourceLocal)[0],index=candidate.sourceItemIndex;
 assert.match(doc.querySelector('[data-source-stair-diagnostics]').textContent,/上端同士/);
 const direction=doc.querySelector('[data-stair-direction="'+index+'"]');direction.value='flip-y';direction.dispatchEvent({type:'change'});doc.querySelector('[data-stair-direction-evidence="'+index+'"]').value='1F UP 1-3 corner, 4-12 straight ascends left';
 doc.querySelector('[data-stair-field="'+index+':displayRiseMm"]').value='1800';doc.querySelector('[data-stair-field="'+index+':partOrder"]').value='2';doc.querySelector('[data-source-stair="'+index+'"]').click();
 assert.equal(c.SourceStairDisplay.directionDiagnostics(body.sourceLocal,body.stairDisplayDecisions.map(d=>d.directionDecision)).filter(d=>d.floor===1).length,0);c.applyPlanImport();const item=c.DATA.items.find(i=>i.stairDisplayOnly);assert.equal(item.flipY,true);assert.equal(item.rot,270);assert.equal(item.sourceStairDisplay.physicalConnection,false);assert.equal(JSON.stringify(body.sourceLocal),source);
});
