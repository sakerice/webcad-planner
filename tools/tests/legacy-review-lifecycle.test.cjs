'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sourceRoot=path.resolve(__dirname,'../..');
const {libraryContext,fixture,makePaneWindow}=require(path.join(sourceRoot,'tools/tests/plan-library-test-support.cjs'));
const {appearanceContext,settingsFixture,plain,realFunction,SOURCE}=require(path.join(sourceRoot,'tools/tests/legacy-appearance-support.cjs'));
const Repository=require(path.join(sourceRoot,'assets/js/plan-repository-lab.js'));
const {memoryIDB}=require(path.join(sourceRoot,'tools/tests/plan-library-test-support.cjs'));
const crypto=require('node:crypto').webcrypto;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function legacy(){return {walls:[{id:7,floor:1,x1:0,y1:0,x2:1000,y2:0,thick:120},{id:7,floor:2,x1:0,y1:0,x2:1000,y2:0,thick:120},{id:9,floor:2,x1:20,y1:30,x2:20,y2:30,thick:120,anonymousExtension:{retain:true}}],rooms:[],items:[],exteriorWallSettings:{walls:{7:{color:'#123456'},99:{opaque:'dormant'}},faces:{'7_future_face':{opaque:true}}},anonymousOptional:{nested:[7]}};}
function harness(options={}){let h;h=libraryContext({...options,beforeLibrary(c,sandbox){for(const file of ['room-geometry','plan-schema','legacy-plan-copy-dryrun','legacy-plan-compatibility','legacy-plan-lineage','plan-repository-lab'])vm.runInContext(fs.readFileSync(path.join(sourceRoot,'assets/js/'+file+'.js'),'utf8'),sandbox);c.__cloneInTestRealm=value=>{c.__testValue=JSON.stringify(value);const result=vm.runInContext('JSON.parse(__testValue)',sandbox);delete c.__testValue;return result;};const install=c.EditorPane.install;c.EditorPane.install=async(plan,saved,cap)=>{const checked=c.PlanLibrary.repo.validateAdmission(plan,cap);if(!checked.ok)throw Error('pane validation rejected');return install(plan,saved);};},iframeFactory(){const child=makePaneWindow().window,install=child.EditorPane.install;child.EditorPane.install=async(plan,saved,cap)=>{const checked=h.api.repo.validateAdmission(plan,cap);if(!checked.ok)throw Error('pane validation rejected');return install(plan,saved);};return child;}});const get=h.api.repo.get;h.api.repo.get=async(...args)=>{const value=await get(...args);return value===undefined?value:h.context.__cloneInTestRealm(value);};return h;}
async function imported(h){return (await h.api.repo.importSource({sourceId:'anonymous-ui',kind:'plan',raw:JSON.stringify(legacy())})).plans[0].planId;}
function buttonByText(h,text){return h.document.querySelectorAll('button').find(b=>b.textContent===text);}
async function converted(h){const id=await imported(h),review=await h.api.repo.prepareLegacyCopy(id);await h.api.repo.createLegacyCopy(review,'converted-anonymous','Converted anonymous','create-anonymous');return id;}

test('CONTRACT: closing inventory while its conversion review is pending must not resurrect dismissed review',async()=>{
 const h=harness();await h.api.ready;const id=await imported(h);h.edit(fixture(888));const before=h.plan,beforeId=h.context.__editorPlanId;
 await h.api.list();const gate=deferred(),prepare=h.api.repo.prepareLegacyCopy;h.api.repo.prepareLegacyCopy=async(...args)=>{await gate.promise;return prepare(...args);};
 let pending;const run=h.api.run;h.api.run=fn=>(pending=run(fn));h.document.querySelector('[data-library-convert-review]').onclick();
 buttonByText(h,'閉じる').onclick();assert.equal(h.document.querySelector('.library-dialog'),null);gate.resolve();await pending;
 assert.deepEqual(h.plan,before);assert.equal(h.context.__editorPlanId,beforeId);assert.equal(h.context.DIRTY,true);
 assert.equal(!!h.document.querySelector('.library-dialog'),false,'Late preparation must respect dismissal');
});

test('CONTRACT: file-review cancellation while prepare is delayed must not reopen dismissed review',async()=>{
 const h=harness();await h.api.ready;await h.api.list();let current=true;const gate=deferred(),prepare=h.api.repo.prepareLegacyCopy;h.api.repo.prepareLegacyCopy=async(...args)=>{await gate.promise;return prepare(...args);};
 const pending=h.api.reviewLegacyImport(JSON.stringify(legacy()),{isCurrent:()=>current});for(let i=0;i<20&&!((await h.api.repo.list()).length);i++)await tick();
 buttonByText(h,'閉じる').onclick();gate.resolve();await pending;
 assert.equal(!!h.document.querySelector('.library-dialog'),false,'Modal close must invalidate pending import review');
});

test('newer selected file and disposed source pane each suppress late file-review presentation',async()=>{
 for(const reason of ['file-change','pane-close']){const h=harness();await h.api.ready;const gate=deferred(),prepare=h.api.repo.prepareLegacyCopy;h.api.repo.prepareLegacyCopy=async(...args)=>{await gate.promise;return prepare(...args);};let current=true;const pending=h.api.reviewLegacyImport(JSON.stringify(legacy()),{isCurrent:()=>current&&!h.context._editorPaneDisposed});
 for(let i=0;i<30&&!((await h.api.repo.list()).length);i++)await tick();if(reason==='file-change')current=false;else h.context._editorPaneDisposed=true;gate.resolve();assert.equal(await pending,false);assert.equal(h.document.querySelector('[data-library-convert-commit]'),null);assert.equal((await h.api.repo.list()).filter(head=>head.origin?.legacyCopy).length,0);}
});

test('CONTRACT: newer file selection during commit metadata read must prevent stale converted-head creation',async()=>{
 const h=harness();await h.api.ready;let current=true;await h.api.reviewLegacyImport(JSON.stringify(legacy()),{isCurrent:()=>current});const commit=h.document.querySelector('[data-library-convert-commit]'),gate=deferred(),entered=deferred(),get=h.api.repo.get;
 h.api.repo.get=async(store,id)=>{if(store==='plans'&&id===commit.dataset.libraryConvertCommit){entered.resolve();await gate.promise;}return get(store,id);};
 let pending;const run=h.api.run;h.api.run=fn=>(pending=run(fn));commit.onclick();await entered.promise;current=false;gate.resolve();await pending;
 assert.equal((await h.api.repo.list()).filter(head=>head.origin?.legacyCopy).length,0,'Stale commit must recheck after await');
});

test('cancelled review keeps dirty source identity and original archive but creates no converted head',async()=>{
 const h=harness();await h.api.ready;h.edit(fixture(777));const before=h.plan,id=h.context.__editorPlanId;await h.api.reviewLegacyImport(JSON.stringify(legacy()),{isCurrent:()=>true});await buttonByText(h,'キャンセル').onclick();
 assert.deepEqual(h.plan,before);assert.equal(h.context.__editorPlanId,id);assert.equal(h.context.DIRTY,true);assert.equal((await h.api.repo.list()).filter(head=>head.origin?.legacyCopy).length,0);assert.equal((await h.api.repo.list('rawSources')).length,1);
});

test('derived stale source edits block creation and keep dirty source/model scope unchanged',async()=>{
 const h=harness();await h.api.ready;await converted(h);await h.api.openPlan('converted-anonymous');const before=h.plan,id=h.context.__editorPlanId,scope=h.api.modelPool,count=(await h.api.repo.list()).length,options={sourcePaneId:'native-editor',sourcePlanId:id,sourceSnapshot:JSON.stringify(before),isCurrent:()=>true,cataloguePack:'rpg-mansion'};h.edit({...before,anonymousLaterEdit:true});
 await assert.rejects(h.api.createIndependentPlan(before,'Stale RPG preview',options),/更新/);assert.equal(h.context.__editorPlanId,id);assert.equal(h.context.DIRTY,true);assert.equal(h.api.modelPool,scope);assert.equal((await h.api.repo.list()).length,count);
});

test('CONTRACT: real appearance getter after admitted staging must not overwrite preexisting wall map values before save/reload',async()=>{
 const mem=memoryIDB();global.IDBKeyRange=mem.keyRange;const repo=Repository.create({indexedDB:mem.idb,crypto,name:'webcad-plan-library-lab-anonymous-review-preservation'}),original=settingsFixture();
 // Valid conflicting saved values: exact wall-map false/null must be retained,
 // even when established appearance resolution reads fallback wall fields.
 original.exteriorWallSettings.whole.linked=true;delete original.exteriorWallSettings.faces['7_-1_0_2400'];original.walls[0].exteriorColor='#abcdef';original.walls[0].exteriorTexture='data:anonymous-fallback';original.walls[0].exteriorTextureFlipX=true;
 original.exteriorWallSettings.walls[7]={color:null,texture:null,textureFlipX:false,textureFlipY:false,opaqueExtension:{retained:true}};
 const raw=JSON.stringify(original),imported=await repo.importSource({sourceId:'anonymous-values',kind:'plan',raw}),review=await repo.prepareLegacyCopy(imported.plans[0].planId);await repo.createLegacyCopy(review,'anonymous-copy','Anonymous copy','anonymous-create');
 const loaded=await repo.read('anonymous-copy'),cap=await repo.admission('anonymous-copy',loaded.payload),c=appearanceContext({walls:[],rooms:[],items:[]});c.PlanLibrary={repo};const staged=c.stageJsonImport(JSON.stringify(loaded.payload),cap);c.DATA=staged.data;
 assert.deepEqual(plain(c.DATA.exteriorWallSettings.walls[7]),original.exteriorWallSettings.walls[7],'stage retains existing values');const face=c.getWallExteriorSpans(c.DATA.walls[0])[0];assert.ok(face);assert.equal(c.resolveExteriorFaceAppearance(c.DATA.walls[0],face).source,'whole','The affected existing wall map is dormant under whole appearance');
 const saved=await repo.save({planId:'anonymous-copy',operationId:'anonymous-save',baseRevisionId:loaded.revision.id,baseGeneration:loaded.head.headGeneration,payload:JSON.parse(c.serializeDataSnapshot())});assert.equal(saved.status,'saved');
 const reread=await repo.read('anonymous-copy');assert.equal((await repo.list('rawSources'))[0].raw,raw);
 assert.deepEqual(plain(reread.payload.exteriorWallSettings.walls[7]),original.exteriorWallSettings.walls[7],'Rendering helper plus save must retain preexisting wall-map values');
});


test('CONTRACT: real light-render default helper must not overwrite existing entity color after admitted staging',async()=>{
 const mem=memoryIDB();global.IDBKeyRange=mem.keyRange;const repo=Repository.create({indexedDB:mem.idb,crypto,name:'webcad-plan-library-lab-anonymous-light-review'}),original=settingsFixture();
 original.items=[{id:91,type:'light-ceiling',floor:1,x:100,y:200,w:500,d:500,rot:0,elev:2300,color:'#112233',lightKind:'ceiling',lightShape:'point',lightColor:'#aabbcc',lightIntensity:0.56,lightRange:5600,lightAngle:64,lightCastShadow:true,opaqueLight:{retained:true}}];
 const raw=JSON.stringify(original),imported=await repo.importSource({sourceId:'anonymous-light',kind:'plan',raw}),review=await repo.prepareLegacyCopy(imported.plans[0].planId);await repo.createLegacyCopy(review,'anonymous-light-copy','Anonymous light copy','light-create');
 const loaded=await repo.read('anonymous-light-copy'),cap=await repo.admission('anonymous-light-copy',loaded.payload),c=appearanceContext({walls:[],rooms:[],items:[]});c.PlanLibrary={repo};const staged=c.stageJsonImport(JSON.stringify(loaded.payload),cap);c.DATA=staged.data;
 for(const name of ['LIGHT_ITEM_TYPES','LIGHT_KIND_TO_TYPE'])vm.runInContext(new RegExp('^var '+name+'\\s*=[^\\n]+;','m').exec(SOURCE)[0],c);
 vm.runInContext(['isLightItemType','lightKindFromType','ensureLightDefaults'].map(realFunction).join('\n'),c);
 assert.deepEqual(plain(c.DATA.items[0]),original.items[0]);c.ensureLightDefaults(c.DATA.items[0]);
 const saved=await repo.save({planId:'anonymous-light-copy',operationId:'light-save',baseRevisionId:loaded.revision.id,baseGeneration:loaded.head.headGeneration,payload:JSON.parse(c.serializeDataSnapshot())});assert.equal(saved.status,'saved');const reload=await repo.read('anonymous-light-copy');
 assert.equal((await repo.list('rawSources'))[0].raw,raw);assert.deepEqual(plain(reload.payload.items[0]),original.items[0],'Existing color must survive renderer-default helper plus save');
});
