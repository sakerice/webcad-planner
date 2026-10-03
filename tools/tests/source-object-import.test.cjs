const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../../assets/js/plan-registration.js');
const {runtime}=require('./scene-fixtures.cjs'),{createReviewDocument}=require('./scene-review-dom.cjs');
async function setup(){
 const raw=JSON.parse(fs.readFileSync(__dirname+'/fixtures/registration/native-astra-three-floor.raw.json'));
 const {mergeReadPages}=await import('../../worker/plan-pages.mjs'),{finishImportedPlan}=await import('../../worker/routes-ai.mjs');
 const merged=mergeReadPages(raw.pages.map(p=>p.reading));merged.floors=merged.floors.map(f=>({...f,sourcePageId:raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor)).sourcePageId}));
 const res=finishImportedPlan({...merged,buildingRegistration:raw.buildingRegistration},null,{}),body=await res.json();
 const c=runtime(),doc=createReviewDocument();c.document=doc;c.PlanRegistration=R;c.SourceObjectMapping=require('../../assets/js/source-object-mapping.js');
 const host=doc.createElement('section');host.id='plan-import-step3';doc.body.appendChild(host);
 for(const id of ['plan-import-modal','plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost','plan-import-apply']){const e=doc.createElement(id==='plan-import-apply'?'button':'div');e.id=id;host.appendChild(e);}
 c.PlanImport.stageBuildingReview(body);
 for(const floor of [1,2,3]){const group=doc.querySelector('details[data-building-floor="'+floor+'"]');group.querySelector('[data-building-identity]').click();group.querySelector('[data-building-identity-evidence]').value='Test-only source title confirmation';group.querySelector('[data-building-confirm]').click();}
 doc.querySelector('[data-building-partial]').click();return {c,doc,body};
}
test('native furniture mapping selector applies real models once with registered geometry and preserved immutable evidence',async()=>{
 const {c,doc,body}=await setup(),before=JSON.stringify(body.sourceLocal),candidates=c.PlanImport.buildingObjectCandidates(body);
 assert.equal(candidates.some(x=>x.semantic==='kitchen-unit'),true);assert.equal(candidates.some(x=>x.semantic==='bathtub'),false);
 for(const semantic of ['sofa','refrigerator','dining-table']){
  const candidate=candidates.find(x=>x.semantic===semantic),select=doc.querySelector('[data-source-object="'+candidate.id+'"]');
  assert.ok(select);select.value=candidate.models[0].id;select.dispatchEvent({type:'change'});
 }
 c.applyPlanImport();assert.equal(JSON.stringify(body.sourceLocal),before);
 const mapped=c.DATA.items.filter(x=>x.sourceObjectMapping);assert.equal(mapped.length,3);
 assert.equal(mapped.find(x=>x.type==='fmp-Sofa01').w,1780);
 const fridge=mapped.find(x=>x.type==='fmp-Refrigerator01');assert.equal(fridge.x+fridge.w/2,410);assert.equal(fridge.floor,2);
 assert.equal(c.DATA.sceneReconstructionReports[0].objectDecisions.length,3);
 assert.deepEqual(JSON.parse(JSON.stringify(mapped))[0].sourceObjectMapping.source,mapped[0].sourceObjectMapping.source);
});
test('mapping source or proposal edits reject before IDs/history and disable stale decisions on rerender',async()=>{
 const {c,doc,body}=await setup(),candidate=c.PlanImport.buildingObjectCandidates(body).find(x=>x.semantic==='sofa'),select=doc.querySelector('[data-source-object="'+candidate.id+'"]');
 select.value=candidate.models[0].id;select.dispatchEvent({type:'change'});body.objectDecisions[0].proposalSnapshot='old';
 const before=JSON.stringify(c.DATA),id=c.nextId;c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.nextId,id);assert.equal(c.HISTORY.length,0);
});
test('registered quarter turns preserve source rectangle dimensions and transform rail endpoints to existing wall style',async()=>{
 const {c,body}=await setup();body.sourceLocal.marks.push({guess:'parapet',floor:2,x:100,y:200,w:200,d:30,start:{x:0,y:200},end:{x:200,y:200},thick:30});
 body.buildingCompilation.poses[2]={quarterTurns:1,dx:300,dy:400};
 const candidate=c.PlanImport.buildingObjectCandidates(body).find(x=>x.semantic==='parapet');
 body.objectDecisions=[{sourceId:candidate.id,entitySnapshot:candidate.snapshot,sourceSnapshot:R.snapshot(body.sourceLocal),proposalSnapshot:R.snapshot(body.buildingRegistration),reviewed:true,kind:'rail',acceptSolidParapet:true,acceptDisplayHeightMm:1100}];
 const plan=c.PlanImport.mapReviewedSourceObjects(body.buildingCompilation.plan,body),wall=plan.walls.find(x=>x.sourceObjectMapping),made=c.PlanImport.toAppObjects(plan).walls.find(x=>x.sourceObjectMapping);
 assert.deepEqual([wall.x1,wall.y1,wall.x2,wall.y2],[100,400,100,600]);assert.equal(made.wallStyle,'balcony-fence');assert.equal(made.sourceObjectMapping.assumptions[0].measured,false);
});
test('reviewed furniture survives real history functions and JSON persistence without modifying source',async()=>{
 const {c,doc,body}=await setup(),vm=require('node:vm'),{topLevelFunction}=require('./height-runtime.cjs');
 Object.assign(c,{REDO_HISTORY:[],HISTORY_LIMIT:100,DRAG:{active:false},ren:null,syncNorthFromPlan(){},ensureFloorMetadata(){},clearMultiSelection(){},sharedForceFullSync(){},markDirty(){},draw2d(){},sharedRememberEditTargets(){}});
 for(const name of ['serializeDataSnapshot','pushHistorySnapshot','saveState','restoreHistorySnapshot','undoAction','redoAction'])vm.runInContext(topLevelFunction(name),c);
 const before=c.serializeDataSnapshot(),source=JSON.stringify(body.sourceLocal),candidate=c.PlanImport.buildingObjectCandidates(body).find(x=>x.semantic==='sofa'),select=doc.querySelector('[data-source-object="'+candidate.id+'"]');
 select.value=candidate.models[0].id;select.dispatchEvent({type:'change'});c.applyPlanImport();const applied=c.serializeDataSnapshot();
 c.DATA=JSON.parse(applied);c.undoAction();assert.equal(c.serializeDataSnapshot(),before);c.redoAction();assert.equal(c.serializeDataSnapshot(),applied);assert.equal(JSON.stringify(body.sourceLocal),source);
});

test('native beds laundry and four chairs enter real editable DATA with separate reviewed rotation and unchanged source',async()=>{
 const {c,doc,body}=await setup(),before=JSON.stringify(body.sourceLocal),candidates=c.PlanImport.buildingObjectCandidates(body);
 const wanted=candidates.filter(v=>['bed','chair','laundry'].includes(v.semantic));assert.equal(wanted.length,7);
 for(const candidate of wanted){const select=doc.querySelector('[data-source-object="'+candidate.id+'"]');select.value=candidate.models[0].id;const rotation=doc.querySelector('[data-source-object-rotation="'+candidate.id+'"]');rotation.value=candidate.semantic==='chair'?(candidate.source.x<3410?'270':'90'):candidate.semantic==='bed'?'180':'0';select.dispatchEvent({type:'change'});}
 c.applyPlanImport();const mapped=c.DATA.items.filter(v=>v.sourceObjectMapping);assert.equal(mapped.length,7);
 for(const chair of mapped.filter(v=>v.type==='fmp-Chair07')){assert.deepEqual([chair.w,chair.d],[520,360]);assert.equal(chair.floor,2);assert.equal(chair.sourceObjectMapping.assumptions.find(v=>v.field==='rotationDeg').measured,false);}
 assert.equal(JSON.stringify(body.sourceLocal),before);const loaded=JSON.parse(JSON.stringify(c.DATA));assert.equal(loaded.sceneReconstructionReports[0].objectDecisions.length,7);assert.equal(loaded.items.filter(v=>v.type==='fmp-Bed01').length,2);
});

test('complete kitchen replaces the unique raw cabinet once, preserves evidence and rejects stale replacement',async()=>{
 const {c,doc,body}=await setup(),source=JSON.stringify(body.sourceLocal),candidate=c.PlanImport.buildingObjectCandidates(body).find(v=>v.semantic==='kitchen-unit');assert.equal(candidate.models[0].id,'original-kitchen-i2400');assert.equal(body.sourceLocal.items[candidate.replacesSourceItemIndex].type,'kitchen');
 const select=doc.querySelector('[data-source-object="'+candidate.id+'"]'),rotation=doc.querySelector('[data-source-object-rotation="'+candidate.id+'"]');rotation.value='270';select.value=candidate.models[0].id;select.dispatchEvent({type:'change'});const decision=body.objectDecisions[0];assert.equal(decision.replacesSourceItemSnapshot,candidate.replacesSourceItemSnapshot);
 const plan=c.PlanImport.mapReviewedSourceObjects(body.buildingCompilation.plan,body);assert.equal(plan.items.filter(i=>i.type==='kitchen').length,0);const mapped=plan.items.filter(i=>i.type==='original-kitchen-i2400');assert.equal(mapped.length,1);assert.deepEqual([mapped[0].w,mapped[0].d,mapped[0].rot],[2250,720,270]);assert.equal(mapped[0].sourceObjectMapping.replacedSourceItem.source.type,'kitchen');assert.equal(JSON.stringify(body.sourceLocal),source);
 decision.replacesSourceItemSnapshot='old';assert.throws(()=>c.PlanImport.mapReviewedSourceObjects(body.buildingCompilation.plan,body),/置き換え/);assert.equal(JSON.stringify(body.sourceLocal),source);
});

test('kitchen replacement refuses ambiguous raw items and tests overlap in rotated source axes',async()=>{
 const {c,body}=await setup(),raw=body.sourceLocal.items.find(i=>i.type==='kitchen'),mark=body.sourceLocal.marks.find(i=>i.guess==='kitchen-unit');
 mark.x=raw.x+1000;mark.y=raw.y;const outside=c.PlanImport.buildingObjectCandidates(body).find(v=>v.semantic==='kitchen-unit');assert.equal(outside.replacesSourceItemIndex,undefined);
 mark.x=raw.x;body.sourceLocal.items.push({...raw});assert.equal(c.PlanImport.buildingObjectCandidates(body).some(v=>v.semantic==='kitchen-unit'),false);
});
