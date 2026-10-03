/* Existing native editor only; dedicated loopback Chromium, no API/AI/network. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const origin=process.env.APP_URL||'http://127.0.0.1:65372',out=process.env.OUTPUT_DIR||path.join(os.tmpdir(),'webcad-refrigerator-native');
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[],blocked=[];
 try{
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/'))return r.continue();blocked.push(u.origin+u.pathname);return r.abort();});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/?internalAPI=1');await p.waitForSelector('#app-loading',{state:'hidden',timeout:60000});
  await p.evaluate(()=>{closePresetChoice();DATA.walls=[];DATA.rooms=[];DATA.items=[];DATA.heightDefaults={modelVersion:2,floorThickness:180,floorRaise:27,floorRaiseSet:true};DATA.floors={};HISTORY.length=0;REDO_HISTORY.length=0;DIRTY=false;document.getElementById('floor-sel').value='2';onFloorChange(2);setView('3d-ext');});
  await p.waitForFunction(()=>ren&&!hasPendingGltfModels()&&!_gltfRebuildTimer,null,{timeout:60000});
  await p.evaluate(()=>ensureGltfModel(SceneCatalogue.refrigeratorCertificate.url));await p.waitForFunction(()=>_modelCache[SceneCatalogue.refrigeratorCertificate.url]&&!hasPendingGltfModels(),null,{timeout:60000});
  const audit=[];
  for(const side of [1,-1]){
   const shot=await p.evaluate(side=>{const cert=SceneCatalogue.refrigeratorCertificate,m=makeGltfBoxFitClone(cert.url,cert.w/1000,cert.h/1000,cert.d/1000,null),scene=new THREE.Scene();scene.background=new THREE.Color('#dae1e6');scene.add(m);scene.add(new THREE.HemisphereLight(0xffffff,0x647080,2));const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(3,5,4);scene.add(key);const camera=new THREE.PerspectiveCamera(35,ren.domElement.width/ren.domElement.height,.01,100);camera.position.set(.8,1.5,side*3);camera.lookAt(0,.7,0);camera.updateMatrixWorld();ren.render(scene,camera);const box=new THREE.Box3().setFromObject(m);return {png:ren.domElement.toDataURL('image/png'),side,cert,yaw:ModelQuality.sourceYaw(cert.url),bounds:{min:box.min.toArray(),max:box.max.toArray()}};},side);
   fs.writeFileSync(path.join(out,side>0?'asset-front-plus-z.png':'asset-back-minus-z.png'),Buffer.from(shot.png.split(',')[1],'base64'));delete shot.png;audit.push(shot);assert.equal(shot.yaw,Math.PI);
  }
  await p.getByRole('button',{name:'固定raw 2Fの部分プレビュー（AIなし・未完成）'}).click();await p.waitForSelector('[data-scene-full-status]');
  const integrity=()=>p.evaluate(()=>({data:serializeDataSnapshot(),history:JSON.stringify(HISTORY),redo:JSON.stringify(REDO_HISTORY),dirty:DIRTY,source:JSON.stringify(PlanImport.state.result.sceneIR),raw:JSON.stringify(PlanImport.state.result.extraction),storage:Object.fromEntries(Object.entries(localStorage))}));
  const before=await integrity();
  for(const [id,collection] of [['obj-refrigerator','objects'],['room-ldk','rooms']]){
   await p.locator('[data-scene-review-search]').fill(id);const g=p.locator('details[data-scene-group="'+collection+':'+id+'"]');await g.locator('summary').click();await p.locator('[data-scene-mapping="'+id+'"]').click();
   if(collection==='objects'){await p.locator('[data-scene-catalogue]').selectOption('fmp-Refrigerator01');await p.locator('[data-scene-sizing]').selectOption('fit-source');}
   await p.locator('[data-scene-appearance]').selectOption('match-diagram-appearance');await p.locator('[data-scene-mapping-confirm]').click();
  }
  assert.deepEqual(await integrity(),before);
  const result=await p.evaluate(async()=>{const s=WebCADInternalAPI.get_scene({planId:'host-draft'});return WebCADInternalAPI.preview_patch({planId:'host-draft',baseRevision:s.revision,selectedObjectIds:['obj-refrigerator'],displayBindings:[],incompleteConfirmed:true});});
  assert.equal(result.rendered,true,JSON.stringify(result.diagnostics));assert.equal(result.fullReconstructionReady,false);assert.ok(result.fullDiagnostics.some(d=>d.code==='unsupported_stair_reconstruction'));assert.ok(result.fullDiagnostics.some(d=>d.code==='unsupported_opening_mechanism'));
  const frame=p.frames().find(f=>f.url().includes('editorPane='+result.preview.paneId));assert.ok(frame);await frame.waitForFunction(()=>ren&&!hasPendingGltfModels()&&!_gltfRebuildTimer,null,{timeout:60000});
  const rendered=await frame.evaluate(()=>{
   const item=DATA.items[0],roots=getSelectableRoots3D(item),box=new THREE.Box3(),meshes=[];roots.forEach(r=>{r.updateMatrixWorld(true);box.union(new THREE.Box3().setFromObject(r));r.traverse(n=>{if(n.isMesh){const rawFront=new THREE.Vector3(0,0,-1).transformDirection(n.matrixWorld);meshes.push({color:n.material.color?.getHexString(),channel:n.material.userData?.finishChannel,front:rawFront.toArray()});}});});
   const camera=new THREE.PerspectiveCamera(35,ren.domElement.width/ren.domElement.height,.01,100);camera.position.set(3.4,box.min.y+1.7,2.6);camera.lookAt(.435,box.min.y+.7,.455);camera.updateMatrixWorld();ren.render(sc3,camera);
   return {plan:EditorPane.snapshot(),bounds:{min:box.min.toArray().map(n=>n*1000),max:box.max.toArray().map(n=>n*1000)},meshes,pending:hasPendingGltfModels(),loaded:!!_modelCache['assets/models/furniture_mega/glb/Refrigerator01.glb'],png:ren.domElement.toDataURL('image/png')};
  });
  fs.writeFileSync(path.join(out,'source-fridge-east-front-native.png'),Buffer.from(rendered.png.split(',')[1],'base64'));delete rendered.png;
  assert.equal(rendered.plan.items.length,1);assert.equal(rendered.plan.items[0].h,undefined);assert.equal(rendered.loaded,true);assert.equal(rendered.pending,false);
  [rendered.bounds.min[0],rendered.bounds.max[0],rendered.bounds.min[2],rendered.bounds.max[2]].forEach((v,i)=>assert.ok(Math.abs(v-[100,770,87.5,822.5][i])<.01,JSON.stringify(rendered.bounds)));
  assert.ok(Math.abs(rendered.bounds.max[1]-rendered.bounds.min[1]-1514)<.01);
  assert.ok(rendered.meshes.length>0);for(const m of rendered.meshes){assert.ok(m.front[0]>.999999&&Math.abs(m.front[2])<.000001);assert.equal(m.color,'d4d5d0');}
  const saveGuard=await frame.evaluate(async()=>{try{await EditorPane.save();return false;}catch{return true;}});assert.equal(saveGuard,true,'Memory-only API plan cannot save over production');
  await p.addScriptTag({url:origin+'/assets/js/plan-repository-lab.js'});const namespace='webcad-plan-library-lab-fridge-audit-'+crypto.randomUUID();
  const roundtrip=await p.evaluate(async({namespace,plan})=>{const r=PlanRepositoryLab.create({name:namespace});await r.save({planId:'fridge',operationId:'audit',baseRevisionId:null,baseGeneration:0,payload:plan,name:'Test-only fridge'});await r.close();const next=PlanRepositoryLab.create({name:namespace}),saved=await next.read('fridge');await next.close();await new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase(namespace);q.onsuccess=resolve;q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('test DB blocked'));});return saved.payload;},{namespace,plan:rendered.plan});assert.deepEqual(roundtrip,rendered.plan);
  assert.deepEqual(await integrity(),before);await p.evaluate(()=>ParallelEditors.close());assert.deepEqual(await integrity(),before);
  // Three public pages: real native Apply/Undo, retained source-local geometry.
  const q=await context.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(origin);await q.waitForSelector('#app-loading',{state:'hidden',timeout:60000});
  await q.evaluate(async()=>{closePresetChoice();DATA={walls:[],rooms:[],items:[],heightDefaults:{modelVersion:2,floorThickness:180}};clearEditHistory();_defaultPlanPending=false;window.__auditBody=await(await fetch('/local-preview/sample.json')).json();window.__auditRaw=JSON.stringify(__auditBody.sourceLocal);openPlanImport();PlanImport.stageBuildingReview(__auditBody);});
  for(const floor of [1,2,3]){const g=q.locator('details[data-building-floor="'+floor+'"]');await g.evaluate(el=>el.open=true);await g.locator('[data-building-identity]').check();await g.locator('[data-building-identity-evidence]').fill('Test-only retained public source title review');await g.locator('[data-building-confirm]').click();}
  await q.locator('[data-building-partial]').check();await q.locator('#plan-import-apply').click();
  const building=await q.evaluate(()=>({sourceUnchanged:JSON.stringify(__auditBody.sourceLocal)===__auditRaw,plan:JSON.parse(serializeDataSnapshot()),poses:DATA.sceneReconstructionReports[0].poses}));assert.equal(building.sourceUnchanged,true);assert.equal(building.plan.items.length,35);assert.equal(building.poses[3].dy,455);
  for(const floor of [1,2,3]){await q.evaluate(f=>{document.getElementById('floor-sel').value=String(f);onFloorChange(f);setView('2d');resetView();},floor);await q.screenshot({path:path.join(out,'public-floor-'+floor+'-registered-2d.png')});}
  const undo=await q.evaluate(()=>{undoAction();return DATA.rooms.length===0&&DATA.items.length===0;});assert.equal(undo,true);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({audit,api:result,rendered,isolatedSaveRoundtrip:true,rootOriginalPreserved:true,building,undo,errors,blocked,paidCalls:0},null,2));console.log(JSON.stringify({nativeFridge:true,exactWorldEnvelope:true,eastFront:true,diagramColor:true,isolatedSaveRoundtrip:true,buildingSourceUnchanged:true,undo,errors,fullReady:false,out}));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
