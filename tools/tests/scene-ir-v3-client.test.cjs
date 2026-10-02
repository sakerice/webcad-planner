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
