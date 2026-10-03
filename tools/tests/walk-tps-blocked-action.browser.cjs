// Real renderer and host geometry; no safety/controller functions are replaced.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.APP_URL||'http://127.0.0.1:8950';
const out=process.env.EVIDENCE_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'webcad-tps-blocked-'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:1100,height:760}}),page=await ctx.newPage();
 const result={checks:[],errors:[]};const check=n=>{result.checks.push(n);console.log('PASS '+n);};
 page.setDefaultTimeout(120000);page.on('pageerror',e=>result.errors.push(e.message));page.on('dialog',d=>d.accept());
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());
 async function start(reflected=false){
  const plan={walls:[],rooms:[1,2].map(floor=>({id:'room-'+floor,floor,x:0,y:0,w:7000,d:7000,floorRaiseMm:floor===1&&reflected?180:0})),items:[{id:'bath',type:'original-bathtub',floor:1,x:2600,y:2800,w:1600,d:750,rot:reflected?90:0,flipX:reflected}]};
  await page.locator('#import-file').setInputFiles({name:'blocked-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
  await page.waitForFunction(()=>DATA.items.some(i=>i.id==='bath'));
  await page.evaluate(()=>{onFloorChange(1);setView('3d-walk');});
  await page.waitForFunction(()=>{if(!threeModulesReady||hasPendingGltfModels()||_tablet3DRebuildQueued||!sc3)return false;let found=false;sc3.traverse(o=>{if(o.userData.walkActionSocket?.kind==='bath-pose')found=true;});return found;});
  const started=await page.evaluate(()=>{
   let g;sc3.traverse(o=>{if(o.userData.walkActionSocket?.kind==='bath-pose')g=o;});sc3.updateMatrixWorld(true);
   const a=g.localToWorld(new THREE.Vector3().fromArray(g.userData.walkActionSocket.approach)),front=new THREE.Vector3(0,0,1).transformDirection(g.matrixWorld);
   WALK.x=a.x;WALK.z=a.z;WALK.yaw=Math.atan2(front.x,front.z);walkUpdateGround(true);WalkTps.setMode('tps');WalkTps.update(.1);
   return WalkTps.action();
  });assert.equal(started,true);
  await page.waitForFunction(()=>WalkTps.debug().output.state==='bathing');
  return page.evaluate(()=>({output:WalkTps.debug().output,host:[WALK.x,WALK.z]}));
 }
 async function block(kind){
  return page.evaluate(kind=>{
   // A 1.4m ceiling rejects every external standing-body candidate, including
   // findSafe. This changes real geometry rather than mocking isSafe/findSafe.
   DATA.rooms.find(r=>r.floor===1).ceiling={type:'flat',heightMm:1400};
   const it=DATA.items.find(i=>i.id==='bath');
   if(kind==='deleted')DATA.items=[];
   if(kind==='moved-stair'){
    it.x+=1600;
    DATA.items.push({id:'blocked-stair',type:'stair',floor:1,x:WALK.x/U-400,y:WALK.z/U-500,w:800,d:1000,rot:90,flipX:true});
   }
   rebuild3D(true);WalkTps.update(.1);
   const cancelled=WalkTps.cancel();WalkTps.update(.1);
   let actor;sc3.traverse(o=>{if(o.userData.walkTpsAvatar)actor=o;});
   return {cancelled,output:WalkTps.debug().output,visible:actor?.visible,host:[WALK.x,WALK.z]};
  },kind);
 }
 function assertBlocked(before,after){
  assert.equal(after.cancelled,false);assert.equal(after.output.locked,true);assert.equal(after.output.state,'blocked');
  assert.equal(after.output.avatarHidden,true);assert.equal(after.visible,false);
  assert.deepEqual(after.output.avatar,before.output.avatar);assert.equal(after.output.supportY,before.output.supportY);
  assert.deepEqual(after.host,before.host);
 }
 try{
  await page.goto(base+'/?preset=blank');await page.evaluate(async()=>{await comparisonCatalogueReady;document.getElementById('preset-choice-modal')?.remove();_defaultPlanPending=false;});
  for(const kind of ['intact','deleted','moved-stair']){
   const before=await start(kind==='moved-stair'),after=await block(kind);assertBlocked(before,after);
   await page.keyboard.down('w');await page.waitForTimeout(120);await page.keyboard.up('w');
   assert.deepEqual(await page.evaluate(()=>[WALK.x,WALK.z]),before.host);
   await page.locator('#walk-tps-action').dispatchEvent('click');
   assert.equal(await page.evaluate(()=>WalkTps.debug().output.avatarHidden),true);
   assert.match(await page.locator('#walk-tps-action').textContent(),/再確認/);
   assert.match(await page.locator('#walk-tps-status').textContent(),/非表示.*ウォークスルー終了/);
   assert.equal(await page.evaluate(()=>WalkTps.setMode('fps')),false);
   assert.equal(await page.evaluate(()=>WalkTps.debug().output.avatarHidden),true);
   await page.screenshot({path:path.join(out,kind+'-blocked-hidden.png')});
   check(kind+': all exits blocked, no host restore or visible unsupported actor, retries stay locked');
   if(kind==='moved-stair'){
    await page.evaluate(()=>onFloorChange(2));
    await page.waitForFunction(()=>WALK.floor===2&&WalkTps.debug().output&&!WalkTps.debug().output.locked);
    const next=await page.evaluate(()=>({floor:WalkTps.debug().output.avatar.floor,hidden:WalkTps.debug().output.avatarHidden,kind:WalkTps.debug().output.actionKind}));
    assert.deepEqual(next,{floor:2,hidden:false,kind:null});check('floor switch discards reflected raised action and uses existing new-floor spawn');
   }else{
    await page.evaluate(()=>{delete DATA.rooms.find(r=>r.floor===1).ceiling;rebuild3D(true);WalkTps.update(.1);});
    await page.locator('#walk-tps-action').dispatchEvent('click');
    await page.waitForFunction(()=>!WalkTps.debug().output.locked);
    assert.equal(await page.evaluate(()=>WalkTps.debug().output.avatarHidden),false);
    check(kind+': correcting geometry restores through verified exit');
   }
  }
  await page.setViewportSize({width:390,height:844});
  const before=await start();assertBlocked(before,await block('deleted'));
  await page.screenshot({path:path.join(out,'mobile-blocked-recovery.png')});
  await page.locator('#walk-exit').click();
  assert.equal(await page.evaluate(()=>isWalkView()),false);
  assert.equal(await page.evaluate(()=>WalkTps.debug().output),null);
  assert.equal(await page.evaluate(()=>WalkTps.debug().bathQueryActive),false);
  check('mobile walkthrough exit releases blocked action and private bath resources');
  result.status=result.errors.length?'failed':'passed';
 }catch(e){result.status='failed';result.failure=e.stack;console.error(e);}
 finally{fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2));await ctx.close();await browser.close();}
 if(result.status!=='passed')process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
