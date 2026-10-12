// Real file inputs, migrations, undo/redo and 2D/3D rollback on desktop and phone.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await pw.chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}),
});
const fixture=readFileSync(new URL('./fixtures/house-2f.json',import.meta.url),'utf8');
const simple={walls:[{id:'p1',x1:0,y1:0,x2:4000,y2:0,thick:120}],
  rooms:[{x:0,y:0,w:4000,d:3000,n:'Legacy room'}],
  items:[{type:'car',x:'500',y:'500',w:1800,d:4000,rot:0}],
  viewState:{twoD:{zoom:1.5,panX:80,panY:95}},northDeg:135};
try {
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    console.log('JSON import QA viewport',viewport.width);
    const page=await browser.newPage({viewport});
    const errors=[];
    // A local shared-room stand-in: never contact a real collaboration room.
    const sharedWrites=[];
    await page.route('**/api/rooms/**',route=>{sharedWrites.push(route.request().method());return route.fulfill({status:500,body:'test: unexpected shared request'});});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto((process.env.APP_URL || 'http://localhost:8932/')+'?preset=blank');
    await page.waitForFunction(()=>typeof doImport==='function');
    await page.waitForSelector('#app-loading',{state:'hidden',timeout:60000});
    await page.evaluate(text=>{
      window.__importAlerts=[];window.alert=m=>__importAlerts.push(m);
      applyJsonImport(stageJsonImport(text));
      window.__liveRefs={data:DATA,selected:DATA.items[0]};
      ST.selected=DATA.items[0];ST.multiSelected=[DATA.items[0]];
      ST.zoom=1.7;ST.panX=123;ST.panY=145;
      setDefaultWallHeight(null,2850);
      saveState();DATA.items[0].x+=100;saveState();DATA.items[0].x+=100;
      undoAction();ST.selected=DATA.items[0];ST.multiSelected=[DATA.items[0]];
      window.__liveRefs={data:DATA,selected:ST.selected};
      updateProps();draw2d();
      window.__snapshot=()=>({data:serializeDataSnapshot(),undo:[...HISTORY],redo:[...REDO_HISTORY],
        selected:ST.selected?.id,multi:ST.multiSelected.map(x=>x.id),floor:ST.floor,view:ST.view,
        zoom:ST.zoom,panX:ST.panX,panY:ST.panY,stash:JSON.stringify(ST._camStash),
        height:WALL_H,nextId,dirty:DIRTY,pending:_defaultPlanPending,north:LIGHT_SETTINGS.northDeg,
        shared:JSON.stringify({force:SHARED.forceScan,baseline:SHARED.baseline,dirty:SHARED.dirtyIds,
          timer:SHARED.timer,localAutoTimer:SHARED.localAutoTimer,pending:SHARED.pending}),
        camera:camExt?[camExt.position.toArray(),camExt.quaternion.toArray(),orbit.target.toArray()]:null});
    },fixture);
    const snapshot=()=>page.evaluate(()=>__snapshot());
    const file=(text)=>page.locator('#import-file').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(text)});
    async function rejected(text){
      await page.evaluate(()=>{SHARED.roomId='json-import-test';});
      const before=await snapshot();const count=await page.evaluate(()=>__importAlerts.length);
      await file(text);
      await page.waitForFunction(n=>__importAlerts.length===n+1,count);
      assert.deepEqual(await snapshot(),before,'failed import changed live state');
      assert.equal(await page.evaluate(()=>DATA===__liveRefs.data&&ST.selected===__liveRefs.selected),true);
      assert.equal(await page.locator('#import-file').inputValue(),'');
      assert.match(await page.evaluate(()=>__importAlerts.at(-1)),/間取りと操作履歴はそのまま/);
      await page.evaluate(()=>{SHARED.roomId=null;});
      assert.deepEqual(sharedWrites,[],'failed import contacted shared storage');
    }
    console.log('  live fixture ready');
    for(const text of ['{','{}','null','[]','{"walls":[],"rooms":[],"items":[null]}','{}']) await rejected(text);
    const cancelled=await snapshot();
    await page.locator('#import-file').setInputFiles([]);
    await page.evaluate(()=>doImport({files:[]}));
    assert.deepEqual(await snapshot(),cancelled);
    // Throw after real legacy migration has changed the candidate and height globals.
    await page.evaluate(()=>{
      const original=normalizeLegacyFurnitureItems;
      normalizeLegacyFurnitureItems=function(){original();normalizeLegacyFurnitureItems=original;throw Error('injected migration failure');};
    });
    await rejected(JSON.stringify(simple));
    // Undo/redo must still operate on the old plan after rejected imports.
    assert.equal(await page.evaluate(()=>{
      const current=DATA.items[0].x;redoAction();const next=DATA.items[0].x;
      undoAction();return next===current+100&&DATA.items[0].x===current;
    }),true);
    // Exercise actual 3D rebuilding, including the partially cleared scene path.
    // Keep the 3D recovery scene small so software-rendered CI remains usable.
    await page.evaluate(text=>{applyJsonImport(stageJsonImport(text));saveState();DATA.items[0].x+=50;},JSON.stringify(simple));
    console.log('  rejection and undo checks passed; entering 3D');
    await page.evaluate(()=>setView('3d-ext'));
    await page.waitForFunction(()=>!!sc3&&!!camExt,{},{timeout:60000});
    await page.waitForTimeout(1800);
    await page.evaluate(()=>{
      ST.selected=DATA.items[0];ST.multiSelected=[DATA.items[0]];
      updateProps();rebuild3D(true);
      window.__liveRefs={data:DATA,selected:ST.selected};
      const original=rebuild3D;
      rebuild3D=function(quiet){
        original(quiet);rebuild3D=original;
        camExt.position.set(99,99,99);orbit.target.set(88,88,88);
        throw Error('injected first-render failure');
      };
    });
    await rejected(JSON.stringify(simple));
    console.log('  3D rollback passed');
    await page.evaluate(()=>setView('2d'));
    // Same file twice: legacy orientation migrates exactly once on each fresh read.
    for(let pass=0;pass<2;pass++){
      const count=await page.evaluate(()=>__importAlerts.length);
      await file(JSON.stringify(simple));
      await page.waitForFunction(()=>DATA.rooms[0]?.n==='Legacy room'&&HISTORY.length===0);
      await page.waitForTimeout(80);
      assert.deepEqual(await page.evaluate(()=>({rot:DATA.items[0].rot,version:DATA.items[0].modelFacingVersion,
        wall:WALL_H,north:LIGHT_SETTINGS.northDeg,x:DATA.items[0].x,floor:DATA.items[0].floor,
        selected:ST.selected,multi:ST.multiSelected.length,undo:HISTORY.length,redo:REDO_HISTORY.length,
        zoom:ST.zoom,panX:ST.panX,panY:ST.panY,alerts:__importAlerts.length})),
      {rot:180,version:1,wall:2400,north:135,x:500,floor:1,selected:null,multi:0,undo:0,redo:0,
        zoom:1.5,panX:80,panY:95,alerts:count});
    }
    // Exported/current JSON must round-trip without another migration.
    const current=await page.evaluate(()=>serializeDataSnapshot());
    await file(current);await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>serializeDataSnapshot()),current);
    // Regression: an empty wall ID used to normalize to an existing p1.
    const collisions=JSON.parse(JSON.stringify(simple));
    collisions.walls.push({...collisions.walls[0],id:''});
    collisions.rooms[0].id='p2';
    collisions.items=[{...collisions.items[0],id:'p3',baseRoom:'p2'},
      {...collisions.items[0],id:'',baseRoom:'p2'}, {...collisions.items[0],id:''}];
    collisions.exteriorWallSettings={walls:{p1:{color:'#123456'}}};
    const alertsBeforeCollision=await page.evaluate(()=>__importAlerts.length);
    await file(JSON.stringify(collisions));
    await page.waitForFunction(()=>DATA.items.length===3&&DATA.walls.length===2);
    assert.deepEqual(await page.evaluate(()=>{
      const all=[...DATA.walls,...DATA.rooms,...DATA.items];
      return {valid:PlanSchema.validatePlan(DATA).ok,unique:new Set(all.map(o=>String(o.id))).size===all.length,
        wall:DATA.walls[0].id,room:DATA.rooms[0].id,item:DATA.items[0].id,
        references:DATA.items.map(o=>o.baseRoom),color:DATA.exteriorWallSettings.walls.p1.color,
        alerts:__importAlerts.length};
    }),{valid:true,unique:true,wall:'p1',room:'p2',item:'p3',references:['p2','p2',undefined],
      color:'#123456',alerts:alertsBeforeCollision});
    // Normal multi-floor plan, genuine edits after import, then invalid import again.
    await file(fixture);
    await page.waitForFunction(()=>DATA.walls.length===41);
    await page.evaluate(()=>{
      ST.selected=DATA.items[0];ST.multiSelected=[];saveState();DATA.items[0].x+=33;
      window.__liveRefs={data:DATA,selected:ST.selected};draw2d();
    });
    await rejected('{}');
    assert.equal(await page.evaluate(()=>{const x=DATA.items[0].x;undoAction();return DATA.items[0].x===x-33;}),true);
    assert.deepEqual(errors,[]);
    if(process.env.JSON_IMPORT_SCREENSHOT_DIR) await page.screenshot({path:process.env.JSON_IMPORT_SCREENSHOT_DIR+'/json-import-'+viewport.width+'.png'});
    console.log(`JSON import ${viewport.width}px: invalid/cancel/stage failure/3D rollback/legacy/repeat/round-trip/undo passed`);
    await page.close();
  }
} finally {await browser.close();}
