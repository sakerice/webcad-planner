// Real JSON FileReader imports and production host. No replacement controllers.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.APP_URL||'http://127.0.0.1:8950',out=process.env.EVIDENCE_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'webcad-tps-acceptance-'));fs.mkdirSync(out,{recursive:true});
const room=(id,x,y,w,d,floor=1,extra={})=>({id,x,y,w,d,floor,n:id,...extra});
const plan=(rooms,items=[],walls=[])=>({rooms,items,walls});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:980,height:760}}),page=await ctx.newPage(),result={checks:[],errors:[],limitations:[]};page.setDefaultTimeout(120000);
 let dismissNext=false,lastDialog=Promise.resolve();page.on('dialog',d=>{lastDialog=d.type()==='confirm'&&dismissNext?(dismissNext=false,d.dismiss()):d.accept();});page.on('pageerror',e=>result.errors.push(e.message));
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());
 async function check(name,fn){try{const detail=await fn();result.checks.push({name,status:'pass',detail});console.log('PASS '+name);}catch(e){result.checks.push({name,status:'fail',error:e.stack});console.log('FAIL '+name+' '+e.message);}}
 async function file(p){await page.locator('#import-file').setInputFiles({name:'acceptance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});}
 async function load(p){await file(p);await page.waitForFunction(id=>DATA.rooms.some(r=>r.id===id),p.rooms[0].id);await page.evaluate(()=>setView('3d-walk'));await page.waitForFunction(()=>threeModulesReady&&WALK.active&&!hasPendingGltfModels());}
 async function pose(x,z,yaw=0,floor=1){return page.evaluate(q=>{if(ST.floor!==q.floor)onFloorChange(q.floor);WALK.x=q.x;WALK.z=q.z;WALK.yaw=q.yaw;walkUpdateGround(true);WalkTps.setMode('tps');WalkTps.update(10);return WalkTps.debug().output;},{x,z,yaw,floor});}
 try{
  await page.goto(base+'/?preset=blank');await page.evaluate(async()=>{await comparisonCatalogueReady;document.getElementById('preset-choice-modal')?.remove();_defaultPlanPending=false;});
  await check('imported concave room camera stops at the actual missing quadrant',async()=>{
   await load(plan([room('concave',0,0,6000,6000,1,{shape:{kind:'orthogonalPolygon',outer:[{x:0,y:0},{x:6000,y:0},{x:6000,y:2000},{x:2000,y:2000},{x:2000,y:6000},{x:0,y:6000}]}})]));
   const s=await pose(1,3,Math.PI/2);assert.equal(s.camera.verified,true);assert.ok(s.camera.position.x+s.camera.volumeRadius<=2);await page.screenshot({path:path.join(out,'imported-concave.png')});return s.camera;
  });
  await check('imported adjacent rooms allow the camera across their shared seam',async()=>{await load(plan([room('joined-a',0,0,3000,6000),room('joined-b',3000,0,3000,6000)]));const s=await pose(2.8,3,Math.PI/2);assert.equal(s.camera.verified,true);assert.ok(s.camera.distance>2);return s.camera;});
  await check('imported 1mm gap is not skipped by the camera volume',async()=>{await load(plan([room('gap-a',0,0,3000,6000),room('gap-b',3001,0,2999,6000)]));const s=await pose(2.2,3,Math.PI/2);assert.equal(s.camera.verified,true);assert.ok(s.camera.position.x+s.camera.volumeRadius<3);return s.camera;});
  await check('imported 400mm connector cannot admit the 480mm camera volume',async()=>{await load(plan([room('narrow-a',0,0,4000,3000),room('narrow-link',1800,3000,400,1000),room('narrow-b',0,4000,4000,3000)]));const s=await pose(2,2.4);assert.equal(s.camera.verified,true);assert.ok(s.camera.position.z+s.camera.volumeRadius<3.001);return s.camera;});
  await check('real open doorway admits the camera; jamb and closed leaf remain solid',async()=>{
   await load(plan([room('door-room',0,0,6000,6000)],[{id:'narrow-door',type:'door-swing',floor:1,x:2625,y:2625,w:750,d:750,rot:0,doorHeight:2000,doorOpenState:'open'}],[{id:'partition',floor:1,x1:0,y1:3000,x2:6000,y2:3000,thick:120}]));
   await page.evaluate(()=>{for(let i=0;i<30;i++)updateWalkDoors(.1);WalkTps.invalidate();});
   const side=await pose(2.3,2.3);assert.ok(!side.camera.verified||side.camera.position.z+side.camera.volumeRadius<3);
   const center=await pose(3,2.3);assert.equal(center.camera.verified,true);assert.ok(center.camera.distance>1&&center.camera.avatarVisible);
   await pose(3,.3);const closed=await page.evaluate(()=>{for(let i=0;i<60;i++)updateWalkDoors(.1);WALK.z=2.3;walkUpdateGround(true);WalkTps.invalidate();WalkTps.update(.1);return {camera:WalkTps.debug().output.camera,leafAngle:_doorAnims[0].pivot.rotation.y};});
   assert.ok(Math.abs(closed.leafAngle)<.002);assert.equal(closed.camera.verified,true);assert.ok(closed.camera.position.z+closed.camera.volumeRadius<3);return {side:side.camera,center:center.camera,closed};
  });
  await check('imported raised floors and upper floor use real host ground heights',async()=>{
   await load(plan([room('raised-a',0,0,3000,6000),room('raised-b',3000,0,3000,6000,1,{floorRaiseMm:300}),room('upper',0,0,6000,6000,2,{floorRaiseMm:150})]));
   const low=await pose(1.5,3),raised=await pose(4.5,3),upper=await pose(3,3,0,2);assert.ok(Math.abs(raised.avatar.y-low.avatar.y-.3)<1e-8);assert.ok(upper.avatar.y>2);assert.equal(upper.avatar.floor,2);assert.equal(upper.camera.verified,true);return {low:low.avatar,raised:raised.avatar,upper:upper.avatar};
  });
  const seatPlan=plan([room('seat-transform-room',0,0,9000,9000,1,{floorRaiseMm:180})],[{id:'seat-transform',type:'fmp-Sofa01',floor:1,x:3500,y:3500,w:1867,d:770,rot:0,flipX:false,flipY:false,modelFacingVersion:1}]);
  await load(seatPlan);
  await check('elevated or buried furniture cannot offer an unsafe seat',async()=>{
   const states=await page.evaluate(()=>[-1000,1000,0].map(elev=>{
    const it=DATA.items.find(i=>i.id==='seat-transform');it.elev=elev;rebuild3D(true);sc3.updateMatrixWorld(true);
    let g;sc3.traverse(o=>{if(o.userData.walkSeatSocket&&o.userData.selectRef===it)g=o;});
    const a=g.localToWorld(new THREE.Vector3().fromArray(g.userData.walkSeatSocket.approach)),seat=g.localToWorld(new THREE.Vector3().fromArray(g.userData.walkSeatSocket.seat));
    WALK.x=a.x;WALK.z=a.z;WALK.yaw=Math.atan2(-(seat.x-a.x),-(seat.z-a.z));walkUpdateGround(true);WalkTps.setMode('tps');WalkTps.update(.1);
    return {elev,candidate:WalkTps.debug().candidate};
   }));assert.equal(states[0].candidate,null);assert.equal(states[1].candidate,null);assert.equal(states[2].candidate,'seat-transform');return states;
  });
  for(const variant of [{name:'original',x:3500,y:3500,w:1867,d:770,rot:0,flipX:false},{name:'moved-rotated-scaled-reflected',x:4100,y:3600,w:2240,d:924,rot:70,flipX:true}])await check('real seat '+variant.name+' supports start cancellation and deletion',async()=>{
   const data=await page.evaluate(v=>{
    let it=DATA.items.find(i=>i.id==='seat-transform');if(!it){it={id:'seat-transform',type:'fmp-Sofa01',floor:1,modelFacingVersion:1};DATA.items.push(it);}Object.assign(it,v);delete it.name;rebuild3D(true);sc3.updateMatrixWorld(true);
    let g;sc3.traverse(o=>{if(o.userData.walkSeatSocket&&o.userData.selectRef===it)g=o;});if(!g)throw Error('Registered rendered seat absent');
    const a=g.localToWorld(new THREE.Vector3().fromArray(g.userData.walkSeatSocket.approach)),seat=g.localToWorld(new THREE.Vector3().fromArray(g.userData.walkSeatSocket.seat));
    WALK.x=a.x;WALK.z=a.z;WALK.yaw=Math.atan2(-(seat.x-a.x),-(seat.z-a.z));walkUpdateGround(true);WalkTps.setMode('tps');WalkTps.update(.1);
    const candidate=WalkTps.debug().candidate;if(candidate!=='seat-transform')throw Error('Approach not reachable: '+candidate);
    const origin=[WALK.x,WALK.z];const started=WalkTps.action(),state=WalkTps.debug().output.state,worldSeat=WalkTps.debug().output.avatar;
    const cancelled=WalkTps.cancel(),restored=[WALK.x,WALK.z];WalkTps.action();DATA.items=[];rebuild3D(true);WalkTps.update(.1);
    return {started,state,cancelled,origin,restored,worldSeat,expectedSeat:seat.toArray(),lockedAfterDelete:WalkTps.debug().output.locked};
   },variant);
   assert.equal(data.started,true);assert.equal(data.state,'sitting');assert.equal(data.cancelled,true);assert.deepEqual(data.origin,data.restored);assert.equal(data.lockedAfterDelete,false);assert.deepEqual([data.worldSeat.x,data.worldSeat.y,data.worldSeat.z],data.expectedSeat);return data;
  });
  await check('cancelled JSON replacement retains current TPS mode and plan',async()=>{
   await pose(2,2);const before=await page.evaluate(()=>({plan:serializeDataSnapshot(),profile:WalkTps.preference()}));await page.evaluate(()=>markDirty());dismissNext=true;const dialog=page.waitForEvent('dialog');await file(plan([room('cancelled-import',12000,0,6000,6000)]));await dialog;await lastDialog;
   const after=await page.evaluate(()=>({plan:serializeDataSnapshot(),profile:WalkTps.preference()}));assert.deepEqual(after,before);return after.profile;
  });
  result.status=result.checks.every(c=>c.status==='pass')&&!result.errors.length?'passed':'failed';
 }catch(e){result.status='failed';result.fatal=e.stack;console.error(e);}finally{fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2));await ctx.close();await browser.close();}
 if(result.status!=='passed')process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
