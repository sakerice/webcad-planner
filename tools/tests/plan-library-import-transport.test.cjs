// Real PlanLibrary, PlanImport, PlanFinish and EditorPane ownership controllers.
// DOM/IndexedDB/transport are anonymous simulators. All eight endpoint replies
// are mocked here: even quota never reaches a browser, backend or provider.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {libraryContext,makePaneWindow}=require('./plan-library-test-support.cjs');
const {runtime:paneRuntime,fixture:plan,clone}=require('./parallel-view-preferences-support.cjs');
const {createReviewDocument}=require('./scene-review-dom.cjs');
const html=fs.readFileSync('index.html','utf8'),bootstrap=html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const source=name=>fs.readFileSync('assets/js/'+name+'.js','utf8');
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:value=>resolve(value),reject:error=>reject(error)};};
const response=(body,status=200)=>Response.json(body,{status});
const reading=(name='anonymous',revise=true)=>({plan:{walls:[],rooms:[{id:'read-room',floor:1,x:0,y:0,w:4000,d:3000,n:name}],items:[]},summary:{walls:0,rooms:1,items:0,floors:[1]},pages:[{floor:1}],notes:[name],warnings:[],marks:[{id:'mark-1'}],usage:{calls:1,total_tokens:10},revise:{skipAll:!revise},rawOpaque:{retain:['unknown']}});
function makeController(){
 const r=paneRuntime(),c=r.ctx,ui=makePaneWindow().window;c.AbortController=AbortController;c.DOMException=DOMException;c.self=c;
 c.document=createReviewDocument();
 for(const id of ['plan-import-modal','plan-import-step2','plan-import-step3','plan-import-summary','plan-import-notes','plan-import-cost','plan-import-status','plan-import-run','plan-import-apply','plan-import-quota','plan-import-pdf-review','plan-import-page-status','plan-import-prev-page','plan-import-next-page','plan-import-page-confirm','plan-import-image','plan-import-output','plan-import-hint','scene-review-files','save-btn','snap-sel','floor-sel','surface-sel','surface-control','surface-context','st-mode']){const e=c.document.createElement(id==='scene-review-files'?'details':'div');e.id=id;c.document.body.appendChild(e);}
 c.document.querySelector=ui.document.querySelector.bind(ui.document);c.document.querySelectorAll=ui.document.querySelectorAll.bind(ui.document);
 c.fetch=()=>Promise.reject(Error('pane guard'));c.COMPARISON_PREVIEW=false;c.SHARED={saveBusy:false};c.markDirty=()=>c.DIRTY=true;
 c.Image=class{naturalWidth=1000;naturalHeight=800;set src(v){this._src=v;Promise.resolve().then(()=>this.onload?.());}get src(){return this._src;}};
 c.FileReader=class{readAsDataURL(file){Promise.resolve().then(()=>this.onload({target:{result:'data:application/pdf;anonymous-'+file.name}}));}};
 c.PlanRegistration=require('../../assets/js/plan-registration.js');c.PlanStructure=require('../../assets/js/plan-structure.js');c.SceneIR=require('../../assets/js/scene-ir.js');c.SceneCatalogue=require('../../assets/js/scene-catalogue.js');c.SceneOpeningGeometry=require('../../assets/js/scene-opening-geometry.js');c.FMP_ITEMS={};c.ISIZES={};c.getFmpItem=()=>null;
 c.PlanReviewDraw={drawPage:()=> 'data:image/png;anonymous-render'};
 c.PlanCheck={typesByRoomId:()=>({}),knowledgeWarnings:()=>[],readMarks:()=>({reads:[],ask:[{id:'mark-1',index:0,room:'read-room'}]})};
 vm.runInContext(source('plan-source-identity'),c);vm.runInContext(source('plan-import'),c);vm.runInContext(source('plan-finish'),c);
 return r;
}
async function host(reply=call=>response(call.path.endsWith('/quota')?{counted:true,left:5,perUser:5,total:100}:reading())){
 const calls=[],children=[];let h;
 h=libraryContext({native:false,search:'?planLibrary=1',iframeFactory(){const r=makeController();children.push(r);return vm.runInContext('window',r.ctx);},beforeLibrary(c,sandbox){
  c.fetch=async(url,options)=>{const path=new URL(url,c.location.href).pathname,call={url,path,options,body:options?.body?JSON.parse(options.body):null};calls.push(call);return reply(call);};
  c.HTMLScriptElement={supports:()=>true};vm.runInContext(bootstrap,sandbox);
  const create=c.document.createElement;c.document.createElement=function(tag){const e=create(tag);if(tag==='iframe'){const changed=e._sourceChanged;e._sourceChanged=function(url){e.contentWindow.parent=vm.runInContext('window',sandbox);e.contentWindow.EDITOR_PANE=new URL(url,c.location.href).searchParams.get('editorPane');changed(url);};}return e;};
 }});await h.api.ready;
 for(const id of ['A','B','C'])await h.api.repo.save({planId:id,name:id,operationId:'seed-'+id,baseRevisionId:null,baseGeneration:0,payload:plan(id)});
 await h.api.openPlan('A');await h.api.openPlan('C');h.api.changed([...h.api.panes.values()].find(p=>p.planId==='A').id,{cameraChanged:false});await h.api.layout(1);await h.api.openPlan('B');
 const a=[...h.api.panes.values()].find(p=>p.planId==='A'),b=[...h.api.panes.values()].find(p=>p.planId==='B');
 function stage(p=a,label='A'){const s=p.frame.contentWindow.PlanImport.state;s.pages=['data:image/png;anonymous-'+label];s.fileName=label+'.png';s.crop=null;return p.frame.contentWindow;}
 return {...h,calls,children,a,b,stage};
}
async function waitFor(predicate){for(let i=0;i<100&&!predicate();i++)await tick();assert.ok(predicate(),'controller did not reach expected checkpoint');}
function building(){
 const floors=[1,2].map(floor=>({floor,sourcePageId:'anonymous-page-'+floor,sourceIdentity:{status:'confirmed',sourcePageId:'anonymous-page-'+floor,pageNumber:floor,sourceHeader:{status:'observed',floorIds:[floor],evidence:'anonymous source label'}},width:4000,depth:3000,dims:{top:{total:4000},left:{total:3000}},rooms:[{name:'anonymous '+floor,parts:[{x0:0,y0:0,x1:4000,y1:3000}]}]}));
 return {sourceLocal:{floors,items:[],marks:[]},buildingRegistration:{version:1,floors:[]},plan:{walls:[],rooms:[],items:[]},summary:{floors:[1,2]},notes:['anonymous building']};
}
function scene(){return {sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],walls:[],rooms:[],openings:[],objects:[],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]};}

test('existing v1 workflow uses read/revise polls and both native finish POSTs with exact transport schema',async()=>{
 let readPoll=0,revisePoll=0,finishes=0;
 const h=await host(call=>{
  if(call.path.endsWith('/quota'))return response({counted:true,left:4,perUser:5,total:100});
  if(call.path.endsWith('/import-plan'))return response({jobs:['anonymous-read-job']});
  if(call.path.endsWith('/revise-plan'))return response({jobs:['anonymous-revise-job']});
  if(call.path.endsWith('/plan-result')){if(call.body.revised){revisePoll++;assert.deepEqual(call.body.jobs,['anonymous-revise-job']);return response({...reading('revised',false),usage:{calls:1,total_tokens:10}});}readPoll++;assert.deepEqual(call.body.jobs,['anonymous-read-job']);return response(reading());}
  if(call.path.endsWith('/finish-plan'))return response(++finishes===1?{rooms:[{id:'r0',use:'other'}],picks:[]}:{reads:[{id:'mark-1',kind:'desk'}]});
  throw Error('unexpected operation');
 });const c=h.stage(),before=JSON.stringify(c.DATA),peer=JSON.stringify(h.b.frame.contentWindow.EditorPane.state());
 await c.runPlanImport();await waitFor(()=>h.calls.some(call=>call.path.endsWith('/quota')));
 assert.equal(readPoll,1);assert.equal(revisePoll,1);assert.equal(finishes,2);assert.equal(c.PlanImport.state.result.notes[0],'revised');assert.equal(c.PlanImport.state.result.usage.calls,2);assert.equal(c.PlanImport.state.result.finish.reads[0].kind,'desk');assert.deepEqual(clone(c.PlanImport.state.result.rawOpaque),{retain:['unknown']});
 assert.equal(JSON.stringify(c.DATA),before);assert.equal(JSON.stringify(h.b.frame.contentWindow.EditorPane.state()),peer);
 assert.deepEqual(h.calls.map(call=>call.path),['/api/ai/import-plan','/api/ai/plan-result','/api/ai/revise-plan','/api/ai/plan-result','/api/ai/finish-plan','/api/ai/finish-plan','/api/ai/quota']);
 for(const call of h.calls){assert.equal(call.options.method,call.path.endsWith('/quota')?'GET':'POST');assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.redirect,'error');assert.equal(new URL(call.url).origin,new URL(h.context.location.href).origin);assert.deepEqual(call.path.endsWith('/quota')?call.options.headers:clone(call.options.headers),call.path.endsWith('/quota')?undefined:{'content-type':'application/json'});}
 assert.equal(h.context.__takePlanLibraryAITransport,undefined);
});

test('automatic PDF locator retains native full-page input and explicit manual fallback',async()=>{
 const h=await host(call=>call.path.endsWith('/find-plan')?response({box:null,sourceHeader:{pageKind:'floor-plan',labels:['1F']}}):response({counted:false}));const c=h.a.frame.contentWindow;
 c.PdfPages={renderPages:async(data,opts)=>opts.maxPx===1024?['data:image/png;anonymous-small']:['data:image/png;anonymous-full'],renderRegion:()=>{throw Error('manual confirmation required');}};
 c.onPlanImportFile({files:[{name:'anonymous.pdf',type:'application/pdf'}]});await waitFor(()=>c.PlanImport.state.pageReview);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/ai/find-plan');assert.equal(h.calls[0].body.image,'data:image/png;anonymous-small');assert.equal(c.PlanImport.state.pageReview[0].confirmed,false);assert.equal(c.document.getElementById('plan-import-run').disabled,true);assert.equal(c.PlanImport.state.pageReview[0].sourceIdentity.sourceHeader.evidence[0].text,'1F');
 c.runPlanImport();await tick();assert.equal(h.calls.length,1);c.confirmPlanImportPage();assert.equal(c.PlanImport.state.pageReview[0].confirmed,true);
});

test('existing multi-floor register/poll sends the exact original source snapshot without approvals',async()=>{
 const body=building();let polls=0;const h=await host(call=>{
  if(call.path.endsWith('/register-plan'))return response({jobs:['anonymous-register-job'],sourceSnapshot:call.body.sourceSnapshot},202);
  if(call.path.endsWith('/register-plan-result')){polls++;assert.deepEqual(call.body.jobs,['anonymous-register-job']);return response({sourceSnapshot:call.body.sourceSnapshot,buildingRegistration:body.buildingRegistration,rawResponse:'anonymous-registration-raw',usage:{calls:1}});}
  throw Error('unexpected transport');
 });const c=h.stage(),timers=[];c.setTimeout=fn=>(timers.push(fn),timers.length);c.clearTimeout=()=>{};c.PlanImport.state.pages=['anonymous-floor-1','anonymous-floor-2'];c.PlanImport.stageBuildingReview(body);const original=JSON.stringify(c.PlanImport.state.result.sourceLocal),before=JSON.stringify(c.DATA),run=c.PlanImport.requestBuildingRegistration(c.PlanImport.state.result);
 await waitFor(()=>timers.length);timers.shift()();await run;
 assert.equal(polls,1);assert.equal(h.calls.length,2);assert.equal(h.calls[0].body.sourceSnapshot,original);assert.equal(JSON.stringify(h.calls[1].body.sourceLocal),original);assert.equal(c.PlanImport.state.result.registrationExtraction.rawResponse,'anonymous-registration-raw');assert.equal(JSON.stringify(c.PlanImport.state.result.sourceLocal),original);assert.equal(c.PlanImport.state.result.buildingDecisions.floors.length,0);assert.equal(c.PlanImport.state.result.buildingCompilation.canApply,false);assert.equal(JSON.stringify(c.DATA),before);
});

test('explicit v3 import/poll keeps job contract and raw reply; no legacy revise/finish or Apply',async()=>{
 const raw='{"anonymous":"frozen-v3-evidence"}';const h=await host(call=>{
  if(call.path.endsWith('/import-plan'))return response({jobs:['sir3_anonymous'],extractionContract:'scene-ir-v3'});
  if(call.path.endsWith('/plan-result')){assert.equal(call.body.extractionContract,'scene-ir-v3');assert.deepEqual(call.body.jobs,['sir3_anonymous']);assert.equal(call.body.revised,false);return response({extractionContract:'scene-ir-v3',sceneIR:scene(),rawResponse:raw,contract:{anonymous:true}});}
  return response({counted:false,sceneIRV3:{enabled:true}});
 });const c=h.stage();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;await c.runPlanImport({extractionContract:'scene-ir-v3'});
 assert.equal(c.PlanImport.state.result.extraction.rawResponse,raw);assert.equal(c.PlanImport.state.result.sceneCompilation.canApply,false);assert.equal(h.calls.some(call=>/revise|finish|register/.test(call.path)),false);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,1);assert.equal(c.HISTORY.length,0);
});

for(const failure of ['quota','server','transport','poll-server','poll-transport'])test('native valid v1 result still reaches finish after revise '+failure+' failure, without retry',async()=>{
 let revisions=0,finishes=0;const h=await host(call=>{
  if(call.path.endsWith('/import-plan'))return response(reading());
  if(call.path.endsWith('/revise-plan')){revisions++;if(failure==='transport')throw Error('anonymous offline');if(failure.startsWith('poll-'))return response({jobs:['anonymous-revise-job']});return response({error:failure==='quota'?'ai_quota_exceeded':'ai_upstream_error'},failure==='quota'?429:502);}
  if(call.path.endsWith('/plan-result')){if(failure==='poll-transport')throw Error('anonymous poll offline');return response({error:'ai_upstream_error'},502);}
  if(call.path.endsWith('/finish-plan'))return response(++finishes===1?{rooms:[{id:'r0',use:'other'}]}:{reads:[]});
  return response({counted:false});
 });const c=h.stage();await c.runPlanImport();assert.equal(revisions,1);assert.equal(finishes,2);assert.equal(c.PlanImport.state.result.notes[0],'anonymous');assert.equal(c.PlanImport.state.busy,false);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,1);
});

for(const change of ['A-C-A','same-id-replace','same-id-edit-undo','source','mode','cancel','dispose'])test('late read rejects '+change+' before response/follow-on/finally mutation',async()=>{
 const pending=deferred();const h=await host(call=>call.path.endsWith('/import-plan')?pending.promise:response({counted:false}));const c=h.stage(),beforePeer=JSON.stringify(h.b.frame.contentWindow.EditorPane.state());const run=c.runPlanImport();await waitFor(()=>h.calls.length===1);
 if(change==='A-C-A'){await h.api.switchPlan(h.a.id,'C');await h.api.switchPlan(h.a.id,'A');}
 else if(change==='same-id-replace')c.applyJsonImport({data:plan('same-ID replacement')});
 else if(change==='same-id-edit-undo'){const before=clone(c.DATA);c.DATA.rooms[0].n='temporary';c.draw2d();c.DATA=before;c.draw2d();}
 else if(change==='source')c.PlanImport.state.pages[0]='data:image/png;new-source';
 else if(change==='mode')c.PlanImport.state.extractionMode='scene-ir-v3';
 else if(change==='cancel')c.closePlanImport();
 else c.EditorPane.dispose();
 c.PlanImport.state.busy=true;c.document.getElementById('plan-import-status').textContent='new owner status';pending.resolve(response(reading('late')));await run;
 assert.equal(h.calls.length,1);assert.equal(c.PlanImport.state.result,null);assert.equal(c.PlanImport.state.busy,true);assert.equal(c.document.getElementById('plan-import-status').textContent,'new owner status');assert.equal(JSON.stringify(h.b.frame.contentWindow.EditorPane.state()),beforePeer);
 if(change!=='source'&&change!=='mode')assert.equal(h.calls[0].options.signal.aborted,true);
});

test('camera-only DATA.viewState and runtime camera changes do not retire the source chain',async()=>{
 const pending=deferred();const h=await host(call=>call.path.endsWith('/import-plan')?pending.promise:response({counted:false}));const c=h.stage(),run=c.runPlanImport();await waitFor(()=>h.calls.length===1);c.DATA.viewState={twoD:{zoom:3,panX:42,panY:99}};c.ST.panX=42;c.EditorPane.noteImportTargetEdit();pending.resolve(response({...reading('view-still-current',false),plan:{walls:[],rooms:[],items:[]}}));await run;assert.equal(c.PlanImport.state.result.notes[0],'view-still-current');assert.equal(c.PlanImport.state.busy,false);
});

test('cancel then newer read keeps its busy/result/quota state when old transport completes',async()=>{
 const old=deferred(),newer=deferred();let reads=0;const h=await host(call=>call.path.endsWith('/import-plan')?(++reads===1?old.promise:newer.promise):response({counted:true,left:3,perUser:5,total:100}));const c=h.stage(),one=c.runPlanImport();await waitFor(()=>reads===1);c.closePlanImport();const two=c.runPlanImport();await waitFor(()=>reads===2);const status=c.document.getElementById('plan-import-status').textContent;old.resolve(response(reading('obsolete')));await one;assert.equal(c.PlanImport.state.busy,true);assert.equal(c.document.getElementById('plan-import-status').textContent,status);newer.resolve(response({...reading('new owner',false),plan:{walls:[],rooms:[],items:[]}}));await two;await tick();assert.equal(c.PlanImport.state.result.notes[0],'new owner');assert.equal(c.PlanImport.state.busy,false);assert.equal(reads,2);
});

test('actual target change while the host parses response cannot start revise/finish',async()=>{
 const h=await host(call=>{
  const reply=response(reading());if(call.path.endsWith('/import-plan')){const text=reply.text.bind(reply);reply.text=async()=>{const out=await text();h.a.frame.contentWindow.DATA.rooms[0].n='edit during parsing';h.a.frame.contentWindow.draw2d();return out;};}return reply;
 });const c=h.stage();await c.runPlanImport();assert.equal(h.calls.length,1);assert.equal(c.PlanImport.state.result,null);assert.equal(h.calls[0].options.signal.aborted,true);
});

test('cross-pane IDs/windows, forged contexts/tickets, ticket replay and replaced flow reject before transport',async()=>{
 const h=await host(call=>response(call.path.endsWith('/quota')?{counted:false}:{...reading('safe',false),plan:{walls:[],rooms:[],items:[]}})),c=h.stage(),original=h.api.requestImportOperation;let issued;
 h.api.requestImportOperation=async function(...args){issued=args;const count=h.calls.length;
  await assert.rejects(original(h.b.id,args[1],args[2],args[3]));
  await assert.rejects(original(args[0],h.b.frame.contentWindow,args[2],args[3]));
  await assert.rejects(original(args[0],args[1],{isCurrent:()=>true},args[3]));
  await assert.rejects(original(args[0],args[1],args[2],{}));
  assert.equal(h.calls.length,count);return original(...args);
 };
 await c.runPlanImport();await tick();assert.equal(c.PlanImport.state.result.notes[0],'safe');const count=h.calls.length;await assert.rejects(original(...issued));assert.equal(h.calls.length,count);
 h.api.requestImportOperation=original;const genuine=c.PlanImport;c.PlanImport={...genuine};await assert.rejects(original(issued[0],issued[1],issued[2],issued[3]));assert.equal(h.calls.length,count);c.PlanImport=genuine;
});

for(const corruption of ['url','room','render','headers','credentials','method','jobs','contract','revised'])test('wrong operation/payload '+corruption+' rejects before private transport',async()=>{
 const h=await host(call=>response(call.path.endsWith('/quota')?{counted:false}:{jobs:['anonymous-owned-job'],extractionContract:undefined})),c=h.stage(),claim=c.PlanImport.claimTransportRequest;let denied=0;
 c.PlanImport.claimTransportRequest=function(context,ticket){const request=claim(context,ticket);if(!request)return request;
  if(['url','room','render'].includes(corruption)&&request.operation==='read'){request.operation=corruption==='url'?'https://outside.invalid/read':corruption==='room'?'/api/rooms':'/api/ai/render';denied++;}
  else if(['headers','credentials','method'].includes(corruption)&&request.operation==='read'){const body=JSON.parse(request.body);body[corruption]=corruption==='headers'?{'x-test':'unsafe'}:'unsafe';request.body=JSON.stringify(body);denied++;}
  else if(['jobs','contract','revised'].includes(corruption)&&request.operation==='read-result'){const body=JSON.parse(request.body);if(corruption==='jobs')body.jobs=['unrelated-job'];if(corruption==='contract')body.extractionContract='scene-ir-v3';if(corruption==='revised')body.revised=true;request.body=JSON.stringify(body);denied++;}
  return request;
 };
 await c.runPlanImport();await tick();assert.equal(denied,1);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,['jobs','contract','revised'].includes(corruption)?1:0);assert.equal(h.calls.some(call=>call.path.endsWith('/plan-result')),false);assert.equal(c.PlanImport.state.result,null);
});

test('capture preview and disconnected actual iframe never receive host import capability',async()=>{
 for(const disconnected of [false,true]){const h=await host(),c=h.stage();if(disconnected)h.a.frame.isConnected=false;else c.COMPARISON_PREVIEW=true;await c.runPlanImport();await tick();assert.equal(h.calls.length,0);assert.equal(c.PlanImport.state.result,null);}
});

test('local-only contexts cannot start finish even on a real comparison pane',async()=>{
 const h=await host(),c=h.stage();await c.PlanFinish.analyze(reading().plan,[{}],c.PlanImport.captureContext());assert.equal(h.calls.length,0);assert.equal(c.PlanFinish.result,null);
});

for(const mode of ['native','pane','capture','host'])test('early bootstrap '+mode+' keeps blanket API/WebSocket restrictions and single host claim',async()=>{
 const calls=[],root={URL,URLSearchParams,location:{href:'https://anonymous.invalid/index.html',search:''},HTMLScriptElement:{supports:()=>true},document:{},fetch:async(url,opts)=>{calls.push({url,opts});return response({anonymous:true});},WebSocket:function(){}};root.window=root;root.parent=root;
 if(mode==='host')root.location.search='?planLibrary=1';
 if(mode==='pane'||mode==='capture'){root.parent={};root.location.search=mode==='pane'?'?editorPane=anonymous-pane&planLibrary=1':'?comparisonPreview=1';}
 root.location.href+=root.location.search;vm.createContext(root);vm.runInContext(bootstrap,root);
 if(mode==='native'){assert.equal(root.__takePlanLibraryAITransport,undefined);await root.fetch('/api/ai/quota');assert.equal(calls.length,1);return;}
 for(const url of ['/api/ai/quota','/api/rooms','/api/ai/render'])await assert.rejects(root.fetch(url));await assert.rejects(root.fetch('/asset',{method:'POST'}));assert.throws(()=>new root.WebSocket('wss://anonymous.invalid'));assert.equal(calls.length,0);
 await root.fetch('/asset');assert.equal(calls.length,1);
 if(mode!=='host'){assert.equal(root.__takePlanLibraryAITransport,undefined);return;}
 const take=root.__takePlanLibraryAITransport,transport=take();assert.equal(root.__takePlanLibraryAITransport,undefined);assert.throws(()=>take(),/already owned/);
 for(const operation of ['fetch','/api/ai/read','https://outside.invalid','rooms','render'])await assert.rejects(transport(operation,'{}',null,()=>{}));assert.equal(calls.length,1);
 await assert.rejects(transport('quota','{}',null,()=>{}));await assert.rejects(transport('read',new Request('https://anonymous.invalid'),null,()=>{}));assert.equal(calls.length,1);
});

test('old quota response cannot replace a newer quota, and quota failure stays visible',async()=>{
 const old=deferred(),newer=deferred();let quotas=0;const h=await host(call=>call.path.endsWith('/quota')?(++quotas===1?old.promise:newer.promise):response(reading())),c=h.stage();c.PlanImport.showQuota();await waitFor(()=>quotas===1);c.PlanImport.showQuota();await waitFor(()=>quotas===2);newer.resolve(response({counted:true,left:4,perUser:5,total:100,sceneIRV3:{enabled:true}}));await tick();const text=c.document.getElementById('plan-import-quota').textContent;old.resolve(response({counted:true,left:0,sceneIRV3:{enabled:false}}));await tick();assert.equal(c.PlanImport.state.quotaBlocked,false);assert.equal(c.PlanImport.state.sceneIRV3Available,true);assert.equal(c.document.getElementById('plan-import-quota').textContent,text);
 const failure=await host(()=>{throw Error('anonymous quota offline');}),f=failure.stage();f.PlanImport.showQuota();await waitFor(()=>failure.calls.length);await tick();assert.match(f.document.getElementById('plan-import-quota').textContent,/確認できません/);assert.equal(f.document.getElementById('plan-import-quota').style.display,'');
});

test('registration source-local mutation rejects a pending reply without replacing proposals',async()=>{
 const pending=deferred(),h=await host(()=>pending.promise),c=h.stage(),body=building();c.PlanImport.state.pages=['anonymous-floor-1','anonymous-floor-2'];c.PlanImport.stageBuildingReview(body);const current=c.PlanImport.state.result,run=c.PlanImport.requestBuildingRegistration(current);await waitFor(()=>h.calls.length===1);current.sourceLocal.floors[0].width++;const before=JSON.stringify(current.buildingRegistration);pending.resolve(response({sourceSnapshot:h.calls[0].body.sourceSnapshot,buildingRegistration:{version:1,floors:[{floor:1,quarterTurns:3}]}}));await run;assert.equal(JSON.stringify(current.buildingRegistration),before);assert.equal(h.calls.length,1);assert.equal(current.registrationExtraction,undefined);
});

test('cancel during native read polling clears timer and never issues another poll or new paid read',async()=>{
 const h=await host(call=>response(call.path.endsWith('/import-plan')?{jobs:['anonymous-read-job']}:call.path.endsWith('/plan-result')?{pending:true,done:0,total:1}:{counted:false})),c=h.stage(),timers=new Map();let sequence=0;c.setTimeout=fn=>{const id=++sequence;timers.set(id,fn);return id;};c.clearTimeout=id=>timers.delete(id);
 const run=c.runPlanImport();await waitFor(()=>timers.size===1);c.closePlanImport();assert.equal(timers.size,0);const status=c.document.getElementById('plan-import-status').textContent;await run;assert.equal(h.calls.length,2);assert.equal(c.document.getElementById('plan-import-status').textContent,status);assert.match(status,/受付済み/);assert.equal(c.PlanImport.state.pages[0],'data:image/png;anonymous-A');
});

test('native finish response retires before its second marks POST or cached result write on target edit',async()=>{
 const h=await host(call=>response(call.path.endsWith('/import-plan')?reading('first',false):call.path.endsWith('/finish-plan')?{rooms:[{id:'r0',use:'other'}]}:{counted:false})),c=h.stage();c.PlanCheck.typesByRoomId=()=>{c.DATA.rooms[0].n='target changed during native finish';c.draw2d();return {};};await c.runPlanImport();assert.equal(h.calls.filter(call=>call.path.endsWith('/finish-plan')).length,1);assert.equal(c.PlanFinish.result,null);assert.equal(c.PlanImport.state.result,null);assert.equal(h.calls.length,2);
});

test('register cannot poll unrelated jobs and cancel cannot restart its pending poll',async()=>{
 for(const cancel of [false,true]){const h=await host(call=>response({jobs:['anonymous-register-job'],sourceSnapshot:call.body.sourceSnapshot},202)),c=h.stage(),timers=new Map();let sequence=0;c.setTimeout=fn=>{const id=++sequence;timers.set(id,fn);return id;};c.clearTimeout=id=>timers.delete(id);c.PlanImport.state.pages=['anonymous-floor-1','anonymous-floor-2'];c.PlanImport.stageBuildingReview(building());
 const claim=c.PlanImport.claimTransportRequest;c.PlanImport.claimTransportRequest=function(context,ticket){const request=claim(context,ticket);if(request?.operation==='register-result'){const body=JSON.parse(request.body);body.jobs=['foreign-registration-job'];request.body=JSON.stringify(body);}return request;};
 const run=c.PlanImport.requestBuildingRegistration(c.PlanImport.state.result);await waitFor(()=>timers.size===1);if(cancel){c.closePlanImport();assert.equal(timers.size,0);}else timers.values().next().value();await run;assert.equal(h.calls.length,1);assert.equal(c.PlanImport.state.result.registrationExtraction,undefined);assert.equal(c.PlanImport.state.result.buildingDecisions.floors.length,0);}
});

for(const stage of ['initial','poll'])test('v3 '+stage+' contract mismatch preserves raw reply and stops without downgrade/retry',async()=>{
 const raw='anonymous-mismatching-raw';const h=await host(call=>{
  if(call.path.endsWith('/import-plan'))return response(stage==='initial'?{jobs:['foreign-contract-job'],extractionContract:'unsupported-contract',rawResponse:raw}:{jobs:['sir3_anonymous'],extractionContract:'scene-ir-v3'});
  if(call.path.endsWith('/plan-result'))return response({pending:true,extractionContract:'unsupported-contract',rawResponse:raw});
  return response({counted:false});
 }),c=h.stage();c.SCENE_IR_V3_IMAGE_IMPORT=true;c.PlanImport.state.sceneIRV3Available=true;await c.runPlanImport({extractionContract:'scene-ir-v3'});assert.equal(c.PlanImport.state.failedSceneResponse.rawResponse,raw);assert.equal(c.PlanImport.state.result,null);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,1);assert.equal(h.calls.filter(call=>call.path.endsWith('/plan-result')).length,stage==='initial'?0:1);assert.equal(h.calls.some(call=>/revise|finish/.test(call.path)),false);
});

test('foreign echoed poll job cannot start revision or finish',async()=>{
 const h=await host(call=>response(call.path.endsWith('/import-plan')?{jobs:['anonymous-owned-job']}:call.path.endsWith('/plan-result')?{...reading('foreign'),jobs:['anonymous-foreign-job']}:{counted:false})),c=h.stage();await c.runPlanImport();assert.equal(c.PlanImport.state.result,null);assert.equal(h.calls.some(call=>/revise|finish/.test(call.path)),false);assert.equal(h.calls.filter(call=>call.path.endsWith('/plan-result')).length,1);
});

test('host redirect rejection preserves native error flow without retry or sending to another origin',async()=>{
 const h=await host(call=>{const reply=response(call.path.endsWith('/quota')?{counted:false}:reading());Object.defineProperty(reply,'redirected',{value:true});return reply;}),c=h.stage();await c.runPlanImport();await tick();assert.equal(c.PlanImport.state.result,null);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,1);assert.equal(h.calls.some(call=>/revise|finish|plan-result/.test(call.path)),false);assert.match(c.document.getElementById('plan-import-status').textContent,/サーバに接続できません/);
});

test('quota HTTP errors stay visible and do not advertise a successful availability check',async()=>{
 const h=await host(()=>response({error:'ai_not_configured'},503)),c=h.stage();c.PlanImport.showQuota();await waitFor(()=>h.calls.length);await tick();assert.match(c.document.getElementById('plan-import-quota').textContent,/確認できません/);assert.equal(c.document.getElementById('plan-import-quota').style.display,'');assert.equal(c.PlanImport.state.sceneIRV3Available,false);
});

test('completed broker evidence survives A→C→A and remount without automatic request or Apply',async()=>{
 const h=await host(call=>response(call.path.endsWith('/quota')?{counted:false}:{...reading('retained broker evidence',false),plan:{walls:[],rooms:[],items:[]}})),c=h.stage(),before=JSON.stringify(c.DATA);await c.runPlanImport();await tick();const count=h.calls.length,raw=JSON.stringify(c.PlanImport.state.result.rawOpaque);await h.api.switchPlan(h.a.id,'C');await h.api.switchPlan(h.a.id,'A');assert.equal(JSON.stringify(c.PlanImport.state.result.rawOpaque),raw);assert.equal(c.PlanImport.state.result.notes[0],'retained broker evidence');assert.equal(h.calls.length,count);assert.equal(JSON.stringify(c.DATA),before);
 h.stage(h.b,'B');h.b.frame.contentWindow.PlanImport.state.result=reading('B evidence',false);h.b.frame.contentWindow.PlanImport.renderPlanImportResult(h.b.frame.contentWindow.PlanImport.state.result);h.api.changed(h.a.id,{cameraChanged:false});const closing=h.api.layout(1);let discard;await waitFor(()=>discard=h.document.querySelector('[data-library-decision="discard"]'));await discard.onclick();await closing;await h.api.openPlan('B');const newPane=[...h.api.panes.values()].find(p=>p.planId==='B'),fresh=newPane.frame.contentWindow;assert.notEqual(fresh,h.b.frame.contentWindow);assert.equal(fresh.PlanImport.state.result.notes[0],'B evidence');assert.equal(h.calls.length,count);await fresh.runPlanImport();await tick();assert.equal(fresh.PlanImport.state.result.notes[0],'retained broker evidence');assert.ok(h.calls.length>count);
});

for(const stage of ['read','read-poll','revise','revise-poll'])for(const contract of ['unsupported-contract','scene-ir-v3',false,0,'',null])test('foreign v1 '+stage+' response contract '+JSON.stringify(contract)+' retains raw and never enables Apply',async()=>{
 const foreign={...reading('foreign must remain raw'),extractionContract:contract,rawResponse:'anonymous-exact-foreign-'+stage,rawOpaque:{untouched:[false,0,null]}},beforeRaw=JSON.stringify(foreign);const h=await host(call=>{
  if(call.path.endsWith('/import-plan'))return response(stage==='read'?foreign:stage==='read-poll'?{jobs:['anonymous-read-job']}:reading());
  if(call.path.endsWith('/revise-plan'))return response(stage==='revise'?foreign:stage==='revise-poll'?{jobs:['anonymous-revise-job']}:reading());
  if(call.path.endsWith('/plan-result'))return response(foreign);
  if(call.path.endsWith('/finish-plan'))throw Error('foreign contract cannot finish');
  return response({counted:false});
 }),c=h.stage(),before=JSON.stringify(c.DATA);await c.runPlanImport();await tick();assert.equal(c.PlanImport.state.result,null);assert.equal(JSON.stringify(c.PlanImport.state.failedSceneResponse),beforeRaw);assert.equal(c.document.getElementById('plan-import-apply').disabled,true);assert.equal(JSON.stringify(c.DATA),before);assert.equal(h.calls.some(call=>call.path.endsWith('/finish-plan')),false);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,1);if(stage==='read'||stage==='read-poll')assert.equal(h.calls.some(call=>call.path.endsWith('/revise-plan')),false);c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),before);c.closePlanImport();const memo=c.PlanImport.capture();assert.equal(JSON.stringify(memo.state.failedSceneResponse),beforeRaw);
});

test('foreign echoed revise-poll job stops applicability instead of native transport-error fallback',async()=>{
 const h=await host(call=>response(call.path.endsWith('/import-plan')?reading():call.path.endsWith('/revise-plan')?{jobs:['anonymous-revise-owned-job']}:call.path.endsWith('/plan-result')?{...reading('foreign revision'),jobs:['anonymous-revise-foreign-job']}:{counted:false})),c=h.stage();await c.runPlanImport();await tick();assert.equal(c.PlanImport.state.result,null);assert.equal(c.document.getElementById('plan-import-apply').disabled,true);assert.equal(h.calls.some(call=>call.path.endsWith('/finish-plan')),false);assert.equal(h.calls.filter(call=>call.path.endsWith('/import-plan')).length,1);
});

for(const stage of ['first-no-marks','second-marks'])for(const contract of ['unsupported-contract','scene-ir-v3',false,0,'',null])test('foreign '+stage+' finish contract '+JSON.stringify(contract)+' cannot cache foreign analysis',async()=>{
 const failed=stage==='first-no-marks'?{rooms:[{id:'r0',use:'foreign'}],extractionContract:contract,rawResponse:'anonymous bad finish'}:{reads:[{id:'mark-1',kind:'foreign'}],extractionContract:contract,rawResponse:'anonymous bad marks'};let finishes=0;const h=await host(call=>{
  if(call.path.endsWith('/import-plan'))return response(reading('safe original',false));
  if(call.path.endsWith('/finish-plan')){finishes++;return response(stage==='first-no-marks'||finishes===2?failed:{rooms:[{id:'r0',use:'other'}]});}
  return response({counted:false});
 }),c=h.stage();if(stage==='first-no-marks')c.PlanCheck.readMarks=()=>({reads:[],ask:[]});await c.runPlanImport();await tick();assert.equal(c.PlanFinish.result,null);assert.equal(c.PlanImport.state.result.finish,null);assert.equal(c.PlanImport.state.result.notes[0],'safe original');assert.equal(JSON.stringify(c.PlanImport.state.failedSceneResponse),JSON.stringify(failed));assert.equal(finishes,stage==='first-no-marks'?1:2);
});

for(const stage of ['initial-foreign','poll-foreign','poll-missing'])test('registration '+stage+' contract retains raw without replacing source proposals',async()=>{
 const failed={registrationContract:stage==='poll-missing'?undefined:false,sourceSnapshot:null,buildingRegistration:{version:1,floors:[{floor:1,quarterTurns:3}]},rawResponse:'anonymous bad registration'};const h=await host(call=>{failed.sourceSnapshot=call.body.sourceSnapshot;if(call.path.endsWith('/register-plan')&&stage!=='initial-foreign')return response({jobs:['anonymous-register-job'],sourceSnapshot:call.body.sourceSnapshot,registrationContract:'building-registration-v1'},202);return response(failed);}),c=h.stage(),timers=[];c.setTimeout=fn=>(timers.push(fn),timers.length);c.clearTimeout=()=>{};c.PlanImport.state.pages=['anonymous-floor-1','anonymous-floor-2'];c.PlanImport.stageBuildingReview(building());const body=c.PlanImport.state.result,original=JSON.stringify(body.buildingRegistration),run=c.PlanImport.requestBuildingRegistration(body);if(stage!=='initial-foreign'){await waitFor(()=>timers.length);timers.shift()();}await run;assert.equal(JSON.stringify(body.buildingRegistration),original);assert.equal(body.registrationExtraction,undefined);assert.equal(JSON.stringify(c.PlanImport.state.failedSceneResponse),JSON.stringify(failed));assert.equal(body.buildingDecisions.floors.length,0);assert.equal(h.calls.length,stage==='initial-foreign'?1:2);
});
