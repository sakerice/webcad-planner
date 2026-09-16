import fs from 'node:fs';import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const b=await (pw.chromium||pw.default.chromium).launch({args:['--use-angle=metal']});
const dir='docs/quality-review/ceiling-designer';fs.mkdirSync(dir,{recursive:true});
try{
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.APP_URL||'http://localhost:8932/');await p.waitForFunction(()=>window.CeilingDesigner);await p.evaluate(()=>{closePresetChoice();setView('2d');window.testRoom=DATA.rooms.find(r=>r.floor===1&&r.w>2800&&r.d>2800&&roomHasCoverAbove(r)&&!roomCeilingProfile(r));if(!testRoom)throw Error('No room');testRoom.ceiling={type:'flat',heightMm:2300};ST.floor=1;resetView();});
 const pose=await p.evaluate(()=>[ST.panX,ST.panY,ST.zoom]);await p.selectOption('#surface-sel','ceiling');assert.deepEqual(await p.evaluate(()=>[ST.panX,ST.panY,ST.zoom]),pose);assert.equal(await p.evaluate(()=>ST.view),'2d');assert.equal(await p.locator('.ceiling-designer').count(),0);
 async function click(x,y){const pt=await p.evaluate(({x,y})=>{const a=w2c(testRoom.x+x,testRoom.y+y),r=canvas.getBoundingClientRect();return{x:r.left+a.cx,y:r.top+a.cy};},{x,y});await p.mouse.click(pt.x,pt.y);}
 await p.locator('.cat-hdr').filter({hasText:'部屋・壁・天井'}).click();await p.locator('[data-tool="ceiling-lower"]').click();await click(400,400);await click(1400,1400);assert.equal(await p.evaluate(()=>DATA.items.filter(CeilingDesigner.zone).length),1);assert.equal(await p.locator('[data-ceiling-field="offset"]').count(),1);
 const drag=await p.evaluate(()=>{const z=ST.selected,r=canvas.getBoundingClientRect(),q=w2c(z.x+z.w/2,z.y+z.d/2);return {x:r.left+q.cx,y:r.top+q.cy,dx:200*ST.zoom*.05,old:z.x,id:z.id};});
 await p.mouse.move(drag.x,drag.y);await p.mouse.down();await p.mouse.move(drag.x+drag.dx,drag.y,{steps:5});await p.mouse.up();assert.notEqual(await p.evaluate(id=>DATA.items.find(it=>it.id===id).x,drag.id),drag.old);
 await p.keyboard.press('Control+a');assert.equal(await p.evaluate(()=>explicit2DSelection().every(CeilingDesigner.visible)),true);await p.evaluate(id=>{clearMultiSelection();ST.selected=DATA.items.find(it=>it.id===id);updateProps();},drag.id);
 await p.evaluate(()=>{window.zoneId=ST.selected.id;placeItem('light-down',testRoom.x+800,testRoom.y+800);window.lightId=DATA.items.at(-1).id;ST.selected=DATA.items.find(it=>it.id===zoneId);updateProps();});
 const old=await p.evaluate(()=>DATA.items.find(it=>it.id===lightId).elev);await p.locator('[data-ceiling-field="offset"]').fill('-250');await p.locator('[data-ceiling-field="offset"]').dispatchEvent('change');assert.equal(await p.evaluate(()=>DATA.items.find(it=>it.id===lightId).elev),old-100);
 await p.evaluate(()=>undoAction());assert.equal(await p.evaluate(()=>DATA.items.find(it=>it.id===lightId).elev),old);await p.evaluate(()=>redoAction());assert.equal(await p.evaluate(()=>DATA.items.find(it=>it.id===lightId).elev),old-100);
 // 天井面は下から光線を当てて測る。ゾーンの中と外を両方測り、**段差そのもの**を見る。
 // 天井面の絶対値は高さモデルで変わる(v2は壁の高さがそのまま仕上げ天井面で、
 // 旧モデルは仕上げ厚12mmぶん下)ので、基準面は実装と同じ規則で出す。
 const result=await p.evaluate(()=>{const z=DATA.items.find(it=>it.id===zoneId),r=DATA.rooms.find(r=>r.id===testRoom.id);window.testRoom=r;const ceilY=floorBaseY(r.floor)+roomCeilingHeightM(r);const g=CeilingDesigner.ceilingGroup(r,ceilY,new THREE.MeshStandardMaterial({side:THREE.DoubleSide}),[],null);g.updateMatrixWorld(true);
  const hit=(x,y)=>{const i=new THREE.Raycaster(new THREE.Vector3(x*U,-10,y*U),new THREE.Vector3(0,1,0)).intersectObject(g,true)[0];return i?i.point.y:null;};
  // 天井面は壁の内側までしか無いので、部屋の縁ぎりぎりは外れる。
  // 部屋の中を格子で当たって、ゾーンの外で当たった最初の点を基準にする。
  const grid=[];for(let i=1;i<=4;i++)for(let j=1;j<=4;j++)grid.push([r.x+r.w*i/5,r.y+r.d*j/5]);
  const flat=grid.filter(p=>!CeilingDesigner.offsetAt(r,p[0],p[1])).find(p=>hit(p[0],p[1])!==null);
  const inset=usesFinishedHeightModel()?0:.012;
  return{height:hit(z.x+z.w/2,z.y+z.d/2),base:hit(flat[0],flat[1]),expectedBase:ceilY-inset,step:z.offset*U,hiddenFurniture:DATA.items.filter(it=>it.floor===1&&!CeilingDesigner.visible(it)).length,saved:JSON.parse(serializeDataSnapshot()).items.find(it=>it.id===zoneId).offset};});
 assert.ok(Math.abs(result.base-result.expectedBase)<.001,'平らな天井が仕上げ天井面に無い '+result.base+' / '+result.expectedBase);
 assert.ok(Math.abs((result.height-result.base)-result.step)<.001,'折り下げの段差が指定どおりでない '+(result.height-result.base)+' / '+result.step);
 assert.ok(result.hiddenFurniture>0);assert.equal(result.saved,-250);
 const edits=await p.evaluate(()=>{
  ST.selected=DATA.items.find(it=>it.id===zoneId);const z=ST.selected,oldX=z.x;updateSelectedProp('x',-1000000);const rejected=z.x===oldX;
  copySelectedObject();pasteCopiedObject();const copy=ST.selected,copyValid=!!copy&&!CeilingDesigner.validItem(copy)&&copy.id!==zoneId;
  if(copy)delSel();
  const legacy={id:'legacy-test',x:1800,y:1800,w:300,d:300,offset:-100};testRoom.ceilingAreas=[legacy];CeilingDesigner.migrate();CeilingDesigner.migrate();const migrated=DATA.items.filter(it=>it.id==='legacy-test');const migration=migrated.length===1&&migrated[0].x===testRoom.x+1800;DATA.items=DATA.items.filter(it=>it.id!=='legacy-test');ST.selected=DATA.items.find(it=>it.id===zoneId);updateProps();draw2d();return {rejected,copyValid,migration};
 });assert.deepEqual(edits,{rejected:true,copyValid:true,migration:true});
 await p.screenshot({path:`${dir}/plan.png`});await p.evaluate(()=>{setView('3d-int');window.nativeRenderer=ren;});await p.waitForTimeout(1200);await p.locator('#app-loading').waitFor({state:'hidden'});await p.screenshot({path:`${dir}/underside.png`});assert.equal(await p.evaluate(()=>ren===nativeRenderer&&ST.view==='3d-int'&&sc3.children.some(o=>o.userData.ceiling)),true);
 await p.selectOption('#surface-sel','floor');await p.waitForFunction(()=>!sc3.children.some(o=>o.userData.ceiling));assert.equal(await p.evaluate(()=>ren===nativeRenderer&&!ST.ceilingView&&!sc3.children.some(o=>o.userData.ceiling)),true);
 await p.evaluate(()=>{setView('2d');CeilingDesigner.setSurface('ceiling');ST.selected=DATA.items.find(it=>it.id===zoneId);delSel();});assert.equal(await p.evaluate(()=>DATA.items.some(it=>it.id===zoneId)),false);await p.evaluate(()=>undoAction());assert.equal(await p.evaluate(()=>DATA.items.some(it=>it.id===zoneId)),true);
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>resetView());await p.screenshot({path:`${dir}/mobile.png`});assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/checks.json`,JSON.stringify({...result,errors,nativeViews:true},null,2));console.log('Native plan clicks, properties, fixture attachment, Undo/Redo, delete, persistence, same 3D renderer and mobile: passed');
}finally{await b.close();}
