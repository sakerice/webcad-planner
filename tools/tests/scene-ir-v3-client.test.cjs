const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./scene-fixtures.cjs');
const scene=()=>({sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],walls:[],rooms:[],openings:[],objects:[],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]});
function setup(){const c=runtime(),nodes={};c.document={getElementById:id=>nodes[id]||(nodes[id]={value:'source hint',textContent:'',disabled:false,style:{},classList:{add(){},remove(){}}})};c.PlanImport.state.pages=['data:image/png;base64,AA=='];return {c,nodes};}
function response(body,status=200){return {status,text:async()=>JSON.stringify(body),json:async()=>body};}
test('gated v3 image response stages source/raw contract without revise, finish or live mutation',async()=>{
 const {c}=setup(),s=scene(),calls=[];c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.PlanFinish={analyze:()=>{throw Error('legacy finish called');}};c.PlanReviewDraw={drawPage:()=>{throw Error('legacy revise called');}};
 const raw=JSON.stringify(s),contract={id:'scene-ir-v3-source-preview.1',freezeSha256:'freeze'};
 c.fetch=async(url,opts)=>{calls.push({url,body:opts&&JSON.parse(opts.body)});return response(url.endsWith('/quota')?{counted:false}:{extractionContract:'scene-ir-v3',sceneIR:s,rawResponse:raw,contract,valid:true,canApply:false,pages:[{}],plan:{rooms:[]}});};
 const before=JSON.stringify(c.DATA);await c.runPlanImport({extractionContract:'scene-ir-v3'});
 assert.equal(calls[0].body.extractionContract,'scene-ir-v3');assert.equal(calls[0].body.hint,'');assert.equal(calls.filter(x=>x.url.includes('revise')||x.url.includes('finish')).length,0);assert.equal(c.PlanImport.state.result.sceneIR.sceneVersion,3);assert.equal(c.PlanImport.state.result.extraction.rawResponse,raw);assert.equal(c.PlanImport.state.result.extraction.contract.freezeSha256,'freeze');assert.equal(c.PlanImport.state.result.sceneCompilation.canApply,false);assert.equal(JSON.stringify(c.DATA),before);
});
test('v3 async polling carries extraction contract; mismatched success never enters legacy route',async()=>{
 const {c}=setup(),calls=[];c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.fetch=async(url,opts)=>{calls.push({url,body:opts&&JSON.parse(opts.body)});return response(url.endsWith('/import-plan')?{jobs:['sir3_job'],extractionContract:'scene-ir-v3'}:{plan:{rooms:[]}});};
 await c.runPlanImport({extractionContract:'scene-ir-v3'});assert.equal(calls[1].body.extractionContract,'scene-ir-v3');assert.equal(c.PlanImport.state.result,null);assert.ok(c.PlanImport.state.failedSceneResponse);assert.equal(c.HISTORY.length,0);
});
test('v3 default-off client makes no request and legacy request remains unchanged',async()=>{
 const {c}=setup();let count=0;c.fetch=async()=>{count++;return response({});};await c.runPlanImport({extractionContract:'scene-ir-v3'});assert.equal(count,0);
});
test('combined PDF review and active crop guards also block the experimental v3 request',async()=>{
 for(const blocked of ['pending-page','active-drag']){
  const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;
  if(blocked==='pending-page')c.PlanImport.state.pageReview=[{confirmed:false}];else c.PlanImport.state.drag={x:1,y:1};
  let count=0;c.fetch=async()=>{count++;return response({});};
  await c.runPlanImport({extractionContract:'scene-ir-v3'});assert.equal(count,0,blocked);
 }
});
test('cancelled v3 response cannot stage a scene or initiate job polling',async()=>{
 for(const reply of [{extractionContract:'scene-ir-v3',sceneIR:scene()}, {extractionContract:'scene-ir-v3',jobs:['sir3_job']}]){
  const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;
  let resolve,requests=0;c.fetch=()=>{requests++;return new Promise(r=>{resolve=r;});};
  const pending=c.runPlanImport({extractionContract:'scene-ir-v3'});assert.equal(c.PlanImport.state.busy,true);
  c.closePlanImport();resolve(response(reply));await pending;
  assert.equal(requests,1);assert.equal(c.PlanImport.state.result,null);assert.equal(c.PlanImport.state.busy,false);assert.equal(c.HISTORY.length,0);
 }
});
test('v3 invalid responses cannot enter the combined legacy repair path',async()=>{
 const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;
 const calls=[];c.PlanReviewDraw={drawPage:()=>{throw Error('legacy repair called');}};
 const failed={error:'ai_invalid_plan',revisionCandidate:true,pages:[{}],extractionContract:'scene-ir-v3'};
 c.fetch=async(url)=>{calls.push(url);return response(url.endsWith('/quota')?{counted:false}:failed,422);};
 await c.runPlanImport({extractionContract:'scene-ir-v3'});
 assert.equal(calls.some(url=>url.includes('revise')),false);assert.equal(c.PlanImport.state.result,null);assert.equal(c.PlanImport.state.failedSceneResponse.error,'ai_invalid_plan');
});

test('explicit session choice reaches ordinary run entry; legacy remains the initial route',async()=>{
 const {c}=setup(),calls=[];c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;
 c.fetch=async(url,opts)=>{calls.push({url,body:opts&&JSON.parse(opts.body)});return response(url.endsWith('/quota')?{counted:false}:{extractionContract:'scene-ir-v3',sceneIR:scene()});};
 assert.equal(c.PlanImport.state.extractionMode,'v1');assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),true);
 const before=JSON.stringify(c.DATA);await c.runPlanImport();assert.equal(calls[0].body.extractionContract,'scene-ir-v3');assert.equal(calls[0].body.hint,'');assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);
});
test('selection requires both gates, is not changed while busy, and never persists across close/reset',()=>{
 const {c}=setup();assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),false);c.SCENE_IR_V3_IMAGE_IMPORT=true;assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),false);c.PlanImport.state.sceneIRV3Available=true;assert.equal(c.setPlanImportExtractionMode('unknown'),false);assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),true);c.PlanImport.state.busy=true;assert.equal(c.setPlanImportExtractionMode('v1'),false);c.closePlanImport();assert.equal(c.PlanImport.state.extractionMode,'scene-ir-v3');assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),true);c.resetPlanImport();assert.equal(c.PlanImport.state.extractionMode,'v1');
});
test('selected source route fails closed if capability disappears and multi-page never sends or clears results',async()=>{
 for(const blocked of ['gate','pages']){const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.setPlanImportExtractionMode('scene-ir-v3');const prior={retained:true};c.PlanImport.state.result=prior;if(blocked==='gate')c.PlanImport.state.sceneIRV3Available=false;else c.PlanImport.state.pages.push('second');let requests=0;c.fetch=async()=>{requests++;return response({});};await c.runPlanImport();assert.equal(requests,0);assert.equal(c.PlanImport.state.result,prior);assert.equal(c.PlanImport.state.busy,false);assert.equal(c.PlanImport.state.extractionMode,'scene-ir-v3');}
});
test('legacy fallback is a separate explicit choice and preserves its unchanged API payload',async()=>{
 const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.setPlanImportExtractionMode('scene-ir-v3');c.setPlanImportExtractionMode('v1');let sent;c.fetch=async(url,opts)=>{if(opts)sent=JSON.parse(opts.body);return response(url.endsWith('/quota')?{counted:false}:{error:'unavailable'},503);};await c.runPlanImport();assert.deepEqual(JSON.parse(JSON.stringify(sent)),{images:['data:image/png;base64,AA=='],hint:'source hint'});assert.equal(c.HISTORY.length,0);
});

test('expired source contract explains explicit new read without automatic fallback or plan mutation',async()=>{
 const {setup:setupUi,visibleText}=require('./plan-import-ui-dom.cjs'),{ReviewEvent}=require('./scene-review-dom.cjs');
 const c=setupUi();c.PlanImport.state.pages=['data:image/png;base64,AA=='];c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.setPlanImportExtractionMode('scene-ir-v3');
 const before=JSON.stringify(c.DATA),failed={error:'scene_ir_v3_job_mismatch',extractionContract:'scene-ir-v3',message:'old packet'},calls=[];
 c.fetch=async(url)=>{calls.push(url);return response(url.endsWith('/quota')?{counted:false}:failed,url.endsWith('/quota')?200:409);};
 await c.runPlanImport();
 assert.equal(calls.filter(x=>x.endsWith('/import-plan')).length,1);assert.equal(calls.some(x=>x.includes('revise')||x.includes('finish')||x.includes('plan-result')),false);
 assert.equal(c.PlanImport.state.failedSceneResponse.error,'scene_ir_v3_job_mismatch');assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);assert.equal(c.document.getElementById('plan-import-apply').disabled,true);
 const status=c.document.getElementById('plan-import-status').textContent,details=c.document.getElementById('plan-import-error-details');
 assert.match(status,/自動では読み直しません/);assert.match(status,/再読み取りは新しいAI処理/);assert.match(status,/回数・料金を消費する場合/);
 assert.equal(details.open,false);assert.equal(details.style.display,'');
 assert.match(visibleText(c.document.getElementById('plan-import-modal')),/新しいAI処理.*回数・料金を消費する場合/,'cost and quota notice must be visible before another explicit read');
 assert.equal(c.document.getElementById('plan-import-run').disabled,false);
 details.open=true;details.dispatchEvent(new ReviewEvent('toggle'));
 assert.match(visibleText(details),/自動で読み直すことはありません/);assert.match(visibleText(details),/新しいAPI呼び出し/);assert.match(visibleText(details),/保存済みプランは変更していません/);
 assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);assert.equal(calls.filter(x=>x.endsWith('/import-plan')).length,1,'opening diagnostics never initiates another read');
});

test('empty direct options preserve selected v3 and cannot send legacy through disabled gate',async()=>{
 for(const value of [null,undefined,''])for(const available of [true,false]){const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.setPlanImportExtractionMode('scene-ir-v3');c.PlanImport.state.sceneIRV3Available=available;const calls=[];c.fetch=async(url,opts)=>{if(opts)calls.push(JSON.parse(opts.body));return response(url.endsWith('/quota')?{counted:false}:{extractionContract:'scene-ir-v3',sceneIR:scene()});};await c.runPlanImport({extractionContract:value});assert.equal(calls.length,available?1:0);if(available)assert.equal(calls[0].extractionContract,'scene-ir-v3');}
});
test('invalid explicit false or zero contract cannot dispatch another reading mode',async()=>{
 for(const value of [false,0,'v1']){const {c}=setup();let calls=0;c.fetch=async()=>{calls++;return response({});};await c.runPlanImport({extractionContract:value});assert.equal(calls,0);}
});
test('gate disappearance during source request retains raw reply without staging or retrying',async()=>{
 for(const gate of ['client','capability']){const {c}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;c.setPlanImportExtractionMode('scene-ir-v3');let resolve;const calls=[];c.fetch=(url,opts)=>{calls.push(url);if(url.endsWith('/quota'))return Promise.resolve(response({counted:false}));return new Promise(r=>resolve=r);};const before=JSON.stringify(c.DATA),raw=JSON.stringify(scene());const pending=c.runPlanImport();if(gate==='client')c.SCENE_IR_V3_IMAGE_IMPORT=false;else c.PlanImport.state.sceneIRV3Available=false;resolve(response({extractionContract:'scene-ir-v3',sceneIR:scene(),rawResponse:raw}));await pending;assert.equal(c.PlanImport.state.result,null);assert.equal(c.PlanImport.state.failedSceneResponse.rawResponse,raw);assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);assert.equal(calls.filter(x=>!x.endsWith('/quota')).length,1);assert.equal(c.PlanImport.state.busy,false);}
});

test('selector reflects mode, guards multiple images and preserves exhausted quota disable',async()=>{
 const {c,nodes}=setup();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.fetch=async()=>response({counted:true,left:0,sceneIRV3:{enabled:true}});c.openPlanImport();await new Promise(r=>setImmediate(r));assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),true);assert.equal(nodes['plan-import-mode'].value,'scene-ir-v3');assert.equal(nodes['plan-import-hint'].disabled,true);assert.equal(nodes['plan-import-run'].disabled,true);assert.equal(c.setPlanImportExtractionMode('v1'),true);assert.equal(nodes['plan-import-run'].disabled,true);c.PlanImport.state.pages.push('second');assert.equal(c.setPlanImportExtractionMode('scene-ir-v3'),false);assert.equal(nodes['plan-import-source-mode'].disabled,true);assert.equal(nodes['plan-import-hint'].disabled,false);
});
