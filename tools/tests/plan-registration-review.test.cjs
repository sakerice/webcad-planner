// Production DOM controls and actual Apply, with synthetic user-review simulation.
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./scene-fixtures.cjs');
const {createReviewDocument,ReviewEvent}=require('./scene-review-dom.cjs');
const R=require('../../assets/js/plan-registration.js'),Structure=require('../../assets/js/plan-structure.js');
const {fixture}=require('./fixtures/registration/three-floor-setback.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const c=runtime(),document=createReviewDocument();c.document=document;c.PlanRegistration=R;c.PlanStructure=Structure;
 const modal=document.createElement('div');modal.id='plan-import-modal';document.body.appendChild(modal);
 const host=document.createElement('section');host.id='plan-import-step3';modal.appendChild(host);
 for(const id of ['plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost']){const el=document.createElement('div');el.id=id;host.appendChild(el);}
 const apply=document.createElement('button');apply.id='plan-import-apply';host.appendChild(apply);apply.addEventListener('click',()=>c.applyPlanImport());
 const {source,proposals}=fixture(),body={sourceLocal:source,buildingRegistration:proposals,plan:{walls:[],rooms:[],items:[]},summary:{floors:[1,2,3]}};
 c.PlanImport.state.pages=['one','two','three'];c.PlanImport.stageBuildingReview(body);
 return {c,document,body,apply};
}
function field(h,selector){const e=selector.split(' ').reduce((scope,s)=>scope&&scope.querySelector(s),h.document);assert.ok(e,'Missing '+selector);return e;}
function confirmFloors(h){for(const f of [1,2,3])field(h,'details[data-building-floor="'+f+'"] button[data-building-confirm]').click();}
function approve(h){confirmFloors(h);field(h,'input[data-building-partial]').click();}
test('production controls require each floor review and explicit partial choice; Apply retains source/assumptions without guessed stairs or roofs',()=>{
 const h=setup(),before=JSON.stringify(h.body.sourceLocal);assert.equal(h.apply.disabled,true);assert.match(h.document.body.textContent,/階接続・開口・屋根は未完成/);
 confirmFloors(h);assert.equal(h.apply.disabled,true);field(h,'input[data-building-partial]').click();assert.equal(h.apply.disabled,false);
 const heights=JSON.stringify(h.c.DATA.heightDefaults);h.apply.click();assert.equal(h.c.DATA.rooms.length>0,true);
 assert.equal(h.c.DATA.items.some(i=>/^stair/.test(i.type)||i.type==='roof'||i.type==='foundation'),false);
 assert.equal(JSON.stringify(h.c.DATA.heightDefaults),heights);assert.equal(h.c.HISTORY.length,1);
 const report=h.c.DATA.sceneReconstructionReports[0];assert.equal(report.kind,'building-registration');assert.equal(report.status,'partial-building-assembly');assert.equal(report.sourceLocal.items.length,2);assert.equal(report.deferredItems.length,2);assert.equal(JSON.stringify(report.sourceLocal),before);
 const saved=JSON.parse(JSON.stringify(h.c.DATA));assert.deepEqual(saved.sceneReconstructionReports,copy(h.c.DATA.sceneReconstructionReports));
 const undo=JSON.parse(h.c.HISTORY[0]);assert.equal(undo.rooms.length,0);assert.equal(undo.sceneReconstructionReports,undefined);
});
test('Cancel existing-plan confirmation consumes no IDs, changes no plan, history, heights or evidence',()=>{
 const h=setup();h.c.DATA.rooms=[{id:'existing',floor:1,x:0,y:0,w:1000,d:1000}];h.c.DATA.floors={1:{wallHeight:2600},2:{wallHeight:2400}};h.c.confirm=()=>false;approve(h);
 const before=JSON.stringify(h.c.DATA),next=h.c.nextId,source=JSON.stringify(h.body.sourceLocal);h.apply.click();assert.equal(JSON.stringify(h.c.DATA),before);assert.equal(h.c.nextId,next);assert.equal(h.c.HISTORY.length,0);assert.equal(JSON.stringify(h.body.sourceLocal),source);
});
test('editing any correspondence invalidates every prior review and the partial acknowledgment',()=>{
 const h=setup();approve(h);assert.equal(h.apply.disabled,false);
 const input=field(h,'details[data-building-floor="3"]').querySelectorAll('input[data-building-anchor]').find(e=>e.getAttribute('data-building-anchor')==='0:building.y');input.value='4100';input.dispatchEvent(new ReviewEvent('input'));
 assert.equal(h.apply.disabled,true);assert.equal(h.body.buildingDecisions.floors.length,0);assert.equal(h.body.buildingDecisions.partialAcknowledged,false);
 h.c.applyPlanImport();assert.equal(h.c.DATA.rooms.length,0);
});
test('Apply revalidates source mutation, source crop version, and proposal mutation; no stale data can enter DATA',()=>{
 for(const mutate of [h=>h.body.sourceLocal.floors[0].rooms[0].name+='changed',h=>h.c.PlanImport.state.version++,h=>h.body.buildingRegistration.floors[0].anchors[0].building.x+=10]){
  const h=setup();approve(h);mutate(h);const before=JSON.stringify(h.c.DATA),next=h.c.nextId;h.c.applyPlanImport();assert.equal(JSON.stringify(h.c.DATA),before);assert.equal(h.c.nextId,next);assert.equal(h.c.HISTORY.length,0);
 }
});
test('old detached review controls and repeated Apply after closing cannot edit or reapply',()=>{
 const h=setup();approve(h);const old=field(h,'button[data-building-confirm]');h.apply.click();const after=JSON.stringify(h.c.DATA);old.click();h.c.applyPlanImport();assert.equal(JSON.stringify(h.c.DATA),after);assert.equal(h.c.HISTORY.length,1);
});
test('unknown source identity needs explicit floor confirmation with evidence even when registration is correct',()=>{
 const h=setup();h.body.sourceLocal.floors[2].sourceIdentity.status='unknown';h.c.PlanImport.stageBuildingReview(h.body);confirmFloors(h);field(h,'input[data-building-partial]').click();assert.equal(h.apply.disabled,true);
 field(h,'details[data-building-floor="3"] input[data-building-identity]').click();field(h,'details[data-building-floor="3"] input[data-building-identity-evidence]').value='Full page title explicitly says 3階';field(h,'details[data-building-floor="3"] button[data-building-confirm]').click();field(h,'input[data-building-partial]').click();assert.equal(h.apply.disabled,false);
 assert.equal(h.body.sourceLocal.floors[2].sourceIdentity.status,'unknown','user decision separate from original evidence');
});
test('explicit joint model request never automatically approves proposed anchors',async()=>{
 const h=setup();let calls=0;h.c.fetch=async(url,opts)=>{calls++;assert.equal(url,'/api/ai/register-plan');const payload=JSON.parse(opts.body);return {status:200,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({sourceSnapshot:payload.sourceSnapshot,buildingRegistration:h.body.buildingRegistration,rawResponse:'retained',canApply:true})};};
 await h.c.PlanImport.requestBuildingRegistration(h.body);assert.equal(calls,1);assert.equal(h.apply.disabled,true);assert.equal(h.body.buildingDecisions.floors.length,0);assert.equal(h.body.registrationExtraction.rawResponse,'retained');
});
test('cancel during joint request drops late reply without resurrecting Apply or mutating DATA',async()=>{
 const h=setup();let resolve;h.c.fetch=()=>new Promise(r=>resolve=r);const pending=h.c.PlanImport.requestBuildingRegistration(h.body),sourceSnapshot=JSON.stringify(h.body.sourceLocal);
 h.c.closePlanImport();resolve({status:200,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({sourceSnapshot,buildingRegistration:h.body.buildingRegistration})});await pending;
 assert.equal(h.c.PlanImport.state.result,null);assert.equal(h.c.DATA.rooms.length,0);assert.equal(h.c.HISTORY.length,0);assert.equal(h.apply.disabled,true);
});
test('registration provenance blocks generic collaborative sharing until supported',()=>{
 const src=require('./app-source.cjs').appSource();const fn=require('./height-runtime.cjs').topLevelFunction('sceneV3LocalOnlyPlan');const vm=require('node:vm'),c=vm.createContext({});vm.runInContext(fn,c);assert.equal(c.sceneV3LocalOnlyPlan({sceneReconstructionReports:[{kind:'building-registration',version:1}]}),true);assert.ok(src.includes('sceneV3LocalOnlyPlan'));
});

test('active collaboration blocks actual Apply atomically, rather than discovering unsupported report after save',()=>{
 const h=setup();approve(h);h.c.SHARED={roomId:'existing-room'};const before=JSON.stringify(h.c.DATA),next=h.c.nextId;h.c.applyPlanImport();assert.equal(JSON.stringify(h.c.DATA),before);assert.equal(h.c.nextId,next);assert.equal(h.c.HISTORY.length,0);assert.ok(h.body.buildingCompilation.diagnostics.some(d=>d.code==='shared_session_unsupported'));
});

test('one point plus direction exposes angular evidence and residual before user review',()=>{
 const h=setup(),p=h.body.buildingRegistration.floors[2];p.anchors=p.anchors.slice(0,1);p.directions=[{local:{x:1,y:0},building:{x:1,y:0},precisionDeg:2,evidence:'Explicit shared wall X direction'}];h.c.PlanImport.stageBuildingReview(h.body);
 assert.match(h.document.body.textContent,/角度残差 0.00°/);assert.match(h.document.body.textContent,/Explicit shared wall X direction/);assert.match(h.document.body.textContent,/精度 ±2°/);assert.equal(h.apply.disabled,true);approve(h);assert.equal(h.apply.disabled,false);
});

test('unknown identity review stays visible and revoking/editing it invalidates Apply',()=>{
 for(const editEvidence of [true,false]){const h=setup();h.body.sourceLocal.floors[2].sourceIdentity.status='unknown';h.c.PlanImport.stageBuildingReview(h.body);confirmFloors(h);field(h,'details[data-building-floor="3"] input[data-building-identity]').click();field(h,'details[data-building-floor="3"] input[data-building-identity-evidence]').value='3F title';field(h,'details[data-building-floor="3"] button[data-building-confirm]').click();field(h,'input[data-building-partial]').click();assert.equal(h.apply.disabled,false);
 assert.equal(field(h,'details[data-building-floor="3"] input[data-building-identity]').checked,true);assert.equal(field(h,'details[data-building-floor="3"] input[data-building-identity-evidence]').value,'3F title');
 if(editEvidence){const input=field(h,'details[data-building-floor="3"] input[data-building-identity-evidence]');input.value='';input.dispatchEvent(new ReviewEvent('input'));}else field(h,'details[data-building-floor="3"] input[data-building-identity]').click();assert.equal(h.apply.disabled,true);h.c.applyPlanImport();assert.equal(h.c.DATA.rooms.length,0);}
});
test('detached old controls cannot revise a newer panel for the same result',()=>{
 const h=setup(),old=field(h,'details[data-building-floor="1"] button[data-building-confirm]');field(h,'details[data-building-floor="2"] button[data-building-confirm]').click();const snapshot=JSON.stringify(h.body.buildingDecisions);old.click();assert.equal(JSON.stringify(h.body.buildingDecisions),snapshot);
});

test('empty and one-point unresolved proposals expose manual recovery fields without another model call',()=>{
 for(const count of [0,1]){const h=setup();h.body.buildingRegistration.floors[2].anchors=h.body.buildingRegistration.floors[2].anchors.slice(0,count);h.c.PlanImport.stageBuildingReview(h.body);const inputs=field(h,'details[data-building-floor="3"]').querySelectorAll('input[data-building-anchor]');assert.equal(inputs.length,12);assert.equal(h.apply.disabled,true);}
});

test('render failure after committed Apply consumes draft once and retains usable Undo',()=>{
 const h=setup();approve(h);h.c.rebuild3D=()=>{throw Error('synthetic renderer failure');};assert.doesNotThrow(()=>h.apply.click());const after=JSON.stringify(h.c.DATA);assert.ok(h.c.DATA.rooms.length);assert.equal(h.body.buildingApplied,true);assert.equal(h.apply.disabled,true);assert.match(field(h,'#plan-import-status').textContent,/表示の更新に失敗/);h.c.applyPlanImport();assert.equal(JSON.stringify(h.c.DATA),after);assert.equal(h.c.HISTORY.length,1);assert.equal(JSON.parse(h.c.HISTORY[0]).rooms.length,0);
});

test('partial-import notice persists after save/reload and clears on Undo via normal redraw hook',()=>{
 const h=setup(),notice=h.document.createElement('details');notice.id='building-registration-notice';h.document.body.appendChild(notice);const detail=h.document.createElement('div');detail.id='building-registration-notice-detail';notice.appendChild(detail);approve(h);h.apply.click();assert.equal(notice.hidden,false);assert.match(detail.textContent,/階段部材 2 点を未配置/);assert.match(detail.textContent,/階高・階段の接続・床の開口・屋根は未検証/);
 h.c.DATA=JSON.parse(JSON.stringify(h.c.DATA));h.c.PlanImport.syncBuildingNotice();assert.equal(notice.hidden,false);h.c.DATA=JSON.parse(h.c.HISTORY[0]);h.c.PlanImport.syncBuildingNotice();assert.equal(notice.hidden,true);
 const draw=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../assets/js/draw-2d.js'),'utf8');assert.match(draw,/function draw2d\(\)\{\s*if\(typeof PlanImport[^\n]+syncBuildingNotice/);
});
