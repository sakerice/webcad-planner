// Real editor + real iframe panes; no injected controller, renderer or monkey patches.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=process.env.EVIDENCE_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'webcad-tps-integrated-'));fs.mkdirSync(out,{recursive:true});
const fixture={walls:[],rooms:[],items:[{id:'seat-1',type:'sofa',floor:1,x:1950,y:2500,w:2100,d:850,rot:0,flipX:false,flipY:false,color:'#bc9668'}]};
for(const floor of [1,2]){
  fixture.rooms.push({id:'room-'+floor,type:'room',x:0,y:0,w:6000,d:6000,floor,n:'TPS fixture '+floor});
  [[0,0,6000,0],[6000,0,6000,6000],[6000,6000,0,6000],[0,6000,0,0]].forEach((p,i)=>fixture.walls.push({id:'wall-'+floor+'-'+i,x1:p[0],y1:p[1],x2:p[2],y2:p[3],floor,thick:120,color:'#ddd8cd'}));
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const result={kind:'integrated editor / real panes',scope:process.env.PANES_ONLY?'panes-only':'full',checks:[],errors:[]};
 const check=s=>{result.checks.push(s);console.log('PASS '+s);};
 const ctx=await browser.newContext({viewport:{width:1100,height:760}}),page=await ctx.newPage();
 page.setDefaultTimeout(60000);
 page.on('pageerror',e=>result.errors.push(e.message));
 const base=process.env.APP_URL||'http://127.0.0.1:8950';
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===base&&!u.pathname.startsWith('/api/')?r.continue():r.abort();});
 try{
  await page.goto(base+'/?preset=blank');await page.waitForFunction(()=>window.threeModulesReady&&window.WalkTps);
  if(!process.env.PANES_ONLY){
  await page.evaluate(p=>{document.getElementById('preset-choice-modal')?.remove();_defaultPlanPending=false;DATA=p;resetHeightGlobalsForPlanLoad();ensureFloorMetadata();ensureHeightDefaults();ST.floor=1;setView('3d-walk');WALK.x=3;WALK.z=3.5;WALK.yaw=0;walkUpdateGround(true);walkApplyCamera();},fixture);
  await page.locator('#walk-tps-mode').dispatchEvent('click');console.log('TPS requested');
  await page.waitForFunction(()=>WalkTps.debug().output?.camera?.verified,{},{timeout:120000});
  assert.equal(await page.evaluate(()=>WalkTps.debug().output.motionSource),'procedural-placeholder');
  const before=await page.evaluate(()=>serializeDataSnapshot());
  await page.screenshot({path:path.join(out,'main-tps.png')});check('real main editor TPS camera and placeholder; no runtime injection');
  await page.keyboard.down('w');await page.waitForTimeout(220);await page.keyboard.up('w');assert.ok(await page.evaluate(()=>WALK.z<3.5));
  await page.locator('#walk-tps-mode').dispatchEvent('click');assert.equal(await page.evaluate(()=>camExt.position.z===WALK.z),true);
  await page.locator('#walk-tps-mode').dispatchEvent('click');check('existing WASD and FPS camera restored by actual mode control');
  result.occlusion=await page.evaluate(()=>{
    WALK.x=3;WALK.z=5.3;WALK.yaw=0;walkUpdateGround(true);WalkTps.update(10);
    const c=WalkTps.debug().output.camera;
    WALK.x=1;WALK.z=.6;WALK.yaw=0;walkUpdateGround(true);iMov.w=true;
    const t=performance.now();for(let i=1;i<=20;i++)updateWalkMode(t+i*100);iMov.w=false;_lastWalkTick=performance.now();
    return {verified:c.verified,distance:c.distance,outerExtent:c.position&&c.position.z+c.volumeRadius,wallStoppedZ:WALK.z};
  });
  assert.equal(result.occlusion.verified,true);assert.ok(result.occlusion.distance<.7&&result.occlusion.outerExtent<6);
  assert.ok(result.occlusion.wallStoppedZ>=.339&&result.occlusion.wallStoppedZ<.6);
  check('actual wall retracts camera volume inside room; existing movement collision remains active at capped low FPS');
  await page.evaluate(()=>{WALK.x=3;WALK.z=1.85;WALK.yaw=Math.PI;walkUpdateGround(true);walkApplyCamera();});
  const canSit=await page.evaluate(()=>WalkTps.debug());result.seatDiagnostic=canSit;
  assert.equal(canSit.candidate,'seat-1');
  await page.locator('#walk-tps-action').dispatchEvent('click');await page.waitForFunction(()=>WalkTps.debug().output?.state==='seated');
  await page.evaluate(()=>{WALK.yaw=Math.PI;walkApplyCamera();});
  await page.screenshot({path:path.join(out,'main-seated.png')});
  const at=await page.evaluate(()=>[WALK.x,WALK.z]);await page.keyboard.down('w');await page.waitForTimeout(150);await page.keyboard.up('w');assert.deepEqual(await page.evaluate(()=>[WALK.x,WALK.z]),at);
  await page.locator('#walk-tps-action').dispatchEvent('click');assert.equal(await page.evaluate(()=>WalkTps.debug().output.locked),false);
  assert.equal(await page.evaluate(()=>serializeDataSnapshot()),before);check('geometry-validated existing GLB sofa sit/stand; locked movement; plan snapshot unchanged');
  await page.locator('#walk-tps-action').dispatchEvent('click');
  await page.waitForFunction(()=>WalkTps.debug().output?.locked);
  const blockedExit=await page.evaluate(()=>{const rooms=DATA.rooms;DATA.rooms=[];rebuild3D(true);const refused=!WalkTps.cancel()&&WalkTps.debug().output.state==='blocked';DATA.rooms=rooms;rebuild3D(true);const recovered=WalkTps.cancel();WalkTps.update(.1);WalkTps.action();return {refused,recovered};});
  assert.deepEqual(blockedExit,{refused:true,recovered:true});check('real host refuses unchecked exit when no room boundary exists, then safely recovers');
  await page.evaluate(()=>{DATA.items[0].x+=400;rebuild3D(true);WalkTps.update(.1);});
  assert.equal(await page.evaluate(()=>WalkTps.debug().output.locked),false);check('moving furniture cancels the socket action safely');
  await page.evaluate(()=>{DATA.items[0].x-=400;rebuild3D(true);WALK.x=3;WALK.z=1.85;WALK.yaw=Math.PI;walkApplyCamera();WalkTps.action();DATA.items=[];rebuild3D(true);WalkTps.update(.1);});
  assert.equal(await page.evaluate(()=>WalkTps.debug().output.locked),false);check('deleting furniture clears action without stale object reference');
  await page.locator('#floor-sel').selectOption('2');
  await page.evaluate(()=>WalkTps.update(.1));
  assert.equal(await page.evaluate(()=>WalkTps.debug().output?.avatar.floor),2);check('actual floor-change path resets action and respawns on the selected floor');
  await page.evaluate(()=>{DATA.rooms.find(r=>r.floor===2).ceiling={type:'void',toFloor:3};WalkTps.invalidate();WalkTps.update(.1);});
  assert.equal(await page.evaluate(()=>WalkTps.debug().output.camera.verified),false);
  assert.equal(await page.evaluate(()=>camExt.position.x===WALK.x&&camExt.position.z===WALK.z),true);check('unsupported void ceiling uses host FPS without inventing safety');
  await page.evaluate(()=>{delete DATA.rooms.find(r=>r.floor===2).ceiling;WalkTps.invalidate();WalkTps.update(10);});
  assert.equal(await page.evaluate(()=>Number.isFinite(WalkTps.debug().output.phase)),true);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{positionWalkHud();const b=document.querySelector('.wk-btn[data-wdir]');b.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,bubbles:true}));b.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}));});
  assert.equal(await page.evaluate(()=>Object.values(WALK.keys).some(Boolean)),false);
  const bounds=await page.locator('#walk-tps-controls').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
  await page.screenshot({path:path.join(out,'mobile-tps.png')});check('mobile HUD, pointercancel and resize retain finite camera');
  }
  await page.evaluate(()=>{document.getElementById('preset-choice-modal')?.remove();_defaultPlanPending=false;});
  await page.setViewportSize({width:1280,height:820});
  await page.evaluate(p=>{setView('2d');DATA=p;resetHeightGlobalsForPlanLoad();ensureFloorMetadata();ensureHeightDefaults();ParallelEditors.open();ParallelEditors.setSync(false);},fixture);
  await page.waitForFunction(()=>ParallelEditors.panes.size===2&&[...ParallelEditors.panes.values()].every(p=>p.ready),{},{timeout:120000});
  const frames=page.frames().filter(f=>f.url().includes('editorPane='));assert.equal(frames.length,2);
  for(const frame of frames){await frame.evaluate(()=>setView('3d-walk'));await frame.waitForFunction(()=>window.threeModulesReady&&WALK.active);await frame.evaluate(()=>{WALK.x=3;WALK.z=1.85;WALK.yaw=Math.PI;walkUpdateGround(true);walkApplyCamera();});}
  await frames[0].locator('#walk-tps-mode').dispatchEvent('click');
  await frames[0].waitForFunction(()=>WalkTps.debug().output?.camera?.verified&&WalkTps.debug().candidate==='seat-1');
  assert.equal(await frames[1].evaluate(()=>WalkTps.enabled()),false);check('real iframe panes keep independent FPS/TPS preference');
  await frames[0].evaluate(async()=>{await EditorPane.save();});
  const persisted=await frames[0].evaluate(async()=>StorageAdapter.load());assert.equal(persisted.items[0].id,'seat-1');assert.equal(Object.hasOwn(persisted,'walkProfile'),false);
  check('actual pane save/load retains plan data without runtime TPS fields');
  const saved=await frames[0].evaluate(()=>EditorPane.state());assert.deepEqual(saved.view.walkProfile,{version:1,mode:'tps'});
  await frames[0].locator('#walk-tps-action').dispatchEvent('click');await frames[0].waitForFunction(()=>WalkTps.debug().output.state==='seated');
  await page.screenshot({path:path.join(out,'two-panes-seated.png')});
  await frames[0].evaluate(async p=>{await EditorPane.install(p);},fixture);
  assert.equal(await frames[0].evaluate(()=>WalkTps.enabled()),false);assert.equal(await frames[0].evaluate(()=>WalkTps.debug().output),null);
  await frames[0].evaluate(async s=>{await EditorPane.install(s.plan,s);},saved);
  assert.equal(await frames[0].evaluate(()=>WalkTps.enabled()),true);assert.equal(await frames[0].evaluate(()=>WalkTps.debug().output.locked),false);
  assert.deepEqual(await frames[0].evaluate(()=>EditorPane.snapshot()),saved.plan);check('real install accepts old JSON and restores opt-in view profile without serialized avatar/action');
  await frames[0].evaluate(()=>{WALK.keys.w=true;EditorPane.dispose();EditorPane.dispose();});
  assert.equal(await frames[0].evaluate(()=>WalkTps.debug().disposed),true);
  assert.equal(await frames[0].evaluate(()=>Object.values(WALK.keys).some(Boolean)),false);
  assert.equal(await frames[1].evaluate(()=>WalkTps.debug().disposed),false);check('idempotent pane disposal clears input and leaves sibling alive');
  await page.evaluate(()=>ParallelEditors.close());assert.equal(await page.evaluate(()=>ParallelEditors.panes.size),0);
  check('comparison close cancels both pane lifecycles');
  await page.evaluate(()=>ParallelEditors.loadWorkspace());
  await page.waitForFunction(()=>ParallelEditors.panes.size>0&&[...ParallelEditors.panes.values()].every(p=>p.ready));
  assert.equal(await page.evaluate(()=>[...ParallelEditors.panes.values()][0].frame.contentWindow.WalkTps.enabled()),true);
  check('actual IndexedDB workspace reload restores versioned view preference');
  await page.evaluate(()=>ParallelEditors.close());
  assert.deepEqual(result.errors,[]);result.status='passed';
 }catch(e){result.status='failed';result.failure=e.stack;try{result.failureDiagnostic=await page.evaluate(()=>({debug:window.WalkTps&&WalkTps.debug(),view:ST.view,floor:ST.floor,walk:WALK.active,pending:hasPendingGltfModels(),items:DATA.items,rooms:DATA.rooms}));console.log(JSON.stringify(result.failureDiagnostic));}catch(_){}throw e;}
 finally{fs.writeFileSync(path.join(out,process.env.PANES_ONLY?'browser-pane-results.json':'browser-results.json'),JSON.stringify(result,null,2)+'\n');await ctx.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
