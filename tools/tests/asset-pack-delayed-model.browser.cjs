/* Deterministic local GLB gates; synthetic plans and a fresh browser per case. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.APP_URL||'http://127.0.0.1:8947/';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(url))throw Error('Loopback APP_URL required');
const out=process.env.RPG_REPORT_DIR||path.resolve('tools/assets/rpg-pack-contract/publication-evidence');
const empty={walls:[],rooms:[],items:[],floorCount:1,startMode:'blank'};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const report={checks:[],errors:[],scope:'Three gated success-response scenarios in local Chromium/SwiftShader. No claim of exhaustive network-race coverage.'};
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
 try{for(const mode of ['cancel-placement','reselect-candidate','replace-pane-plan']){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});let release,seenResolve;const gate=new Promise(r=>release=r),seen=new Promise(r=>seenResolve=r);let held=0;
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==new URL(url).origin&&!['blob:','data:'].includes(u.protocol)||u.pathname.startsWith('/api/'))return route.abort();if(/rpg-mansion-chair-01\.glb/.test(u.pathname)){held++;seenResolve();await gate;}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url+'?preset=blank');await page.waitForFunction(()=>window.AssetPackPicker?.getRegistry());
  await page.evaluate(p=>{applyJsonImport(stageJsonImport(JSON.stringify(p)));ParallelEditors.open();},empty);
  await page.waitForFunction(()=>ParallelEditors.panes.size===2&&[...ParallelEditors.panes.values()].every(p=>p.ready));
  const [a,b]=page.frames().filter(f=>f.url().includes('editorPane='));
  const state=f=>f.evaluate(()=>({data:serializeDataSnapshot(),history:HISTORY.slice(),redo:REDO_HISTORY.slice(),dirty:DIRTY,tool:ST.tool,pack:AssetPackPicker.getSelection()}));
  const bBefore=await state(b);
  await a.evaluate(()=>{AssetPackPicker.setSelection('rpg-mansion');placeItem('rpg-mansion-chair-01',1000,1000);setView('3d-ext');});
  await Promise.race([seen,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('No gated request')),30000);t.unref();})]);
  assert.equal(await a.evaluate(()=>hasPendingGltfModels()),true);
  await a.evaluate(()=>{setTool('rpg-mansion-chair-01');AssetPackPicker.setSelection('japanese-standard');});
  assert.equal(await a.evaluate(()=>ST.tool),'select');
  if(mode==='cancel-placement')await a.evaluate(()=>undoAction());
  if(mode==='reselect-candidate')await a.evaluate(()=>{AssetPackPicker.setSelection('rpg-mansion');setTool('rpg-mansion-desk-01');});
  if(mode==='replace-pane-plan')await page.evaluate(async p=>{const pane=[...ParallelEditors.panes.values()][0],id=await ParallelEditors.addPlan(p,'Synthetic replacement');await ParallelEditors.select(pane.id,id);},empty);
  const expected=await state(a);release();
  await a.waitForFunction(()=>!hasPendingGltfModels()&&!_gltfRebuildTimer,null,{timeout:60000});
  await a.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.deepEqual(await state(a),expected,'Late GLB must not alter data/history/tool/pack');assert.deepEqual(await state(b),bBefore,'Other pane must remain unchanged');
  const rendered=await a.evaluate(()=>{const types=new Set();sc3?.traverse(o=>{const u=o.userData||{};if(u.selectKind==='item'){if(u.selectRef)types.add(u.selectRef.type);for(const ref of u.instanceRefs||[])types.add(ref.type);}});return [...types].sort();});
  assert.equal(rendered.includes('rpg-mansion-chair-01'),mode==='reselect-candidate');
  assert.equal(rendered.includes('rpg-mansion-desk-01'),false,'Pending candidate must not become placed');
  assert.equal(await b.evaluate(()=>Object.keys(_modelCache).some(k=>k.includes('rpg-mansion-chair'))),false);
  report.checks.push({case:mode,heldRequests:held,renderedItemTypes:rendered,result:'passed'});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
 }catch(e){report.status='failed';report.failure=e.message;throw e;}
 finally{fs.writeFileSync(path.join(out,'delayed-model-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
