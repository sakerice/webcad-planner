/* Real editor/pane integration in a fresh, local-only browser context. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.APP_URL||'http://127.0.0.1:8947/';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(url))throw Error('Loopback APP_URL required');
const out=process.env.RPG_REPORT_DIR||path.resolve('tools/assets/rpg-pack-contract/integration-evidence');
const plan={walls:[],rooms:[{id:'room-1',x:0,y:0,w:6000,d:4000,n:'書斎',floor:1}],items:[{id:'item-1',type:'fmp-Table01',x:800,y:700,w:1200,d:700,h:750,rot:0,floor:1},{id:'item-2',type:'missing-asset-stays',x:4800,y:700,w:400,d:400,h:500,rot:30,floor:1,customMetadata:{retain:true}}],floorCount:1,startMode:'blank'};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
 const errors=[],requests=[],report={checks:[],errors,base:'0a1af8d3bcf47f1834128fa6dd15302397f22adf'};
 const context=await browser.newContext({viewport:{width:1800,height:1100},acceptDownloads:true});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['blob:','data:'].includes(u.protocol)||u.origin===new URL(url).origin&&!u.pathname.startsWith('/api/'))return route.continue();return route.abort();});
 context.on('request',r=>requests.push(r.url()));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 async function ready(p){await p.waitForFunction(()=>window.AssetPackPicker?.getRegistry(),null,{timeout:120000});await p.evaluate(()=>window.comparisonCatalogueReady);}
 async function frames(){return page.frames().filter(f=>f.url().includes('editorPane='));}
 const snap=f=>f.evaluate(()=>serializeDataSnapshot());
 try{
  await page.goto(url+'?preset=blank');await ready(page);
  await page.evaluate(p=>{applyJsonImport(stageJsonImport(JSON.stringify(p)));},plan);
  const oldItems=await page.evaluate(()=>JSON.stringify(DATA.items));
  await page.evaluate(async()=>{await StorageAdapter.save(DATA);window.__savedBefore=JSON.stringify(await StorageAdapter.load());});
  for(const pack of ['rpg-mansion','japanese-standard','rpg-mansion'])await page.selectOption('#catalogue-pack',pack);
  assert.equal(await page.evaluate(()=>JSON.stringify(DATA.items)),oldItems);
  assert.equal(await page.evaluate(async()=>JSON.stringify(await StorageAdapter.load())===window.__savedBefore),true);
  report.checks.push('existing items and saved local plan byte content unchanged by switching');
  await page.locator('#object-search-input').fill('椅子');
  assert.equal(await page.locator('#object-search-results [data-tool]').count(),2);
  assert.equal(await page.locator('#object-search-results [data-tool="rpg-mansion-chair-01"]').count(),1);
  await page.locator('#object-search-results [data-tool="rpg-mansion-chair-01"]').click();
  const loc=await page.evaluate(()=>({x:ST.panX+2600*ST.zoom*.05,y:ST.panY+1800*ST.zoom*.05}));
  await page.locator('#c2d').click({position:loc});
  assert.equal(await page.evaluate(()=>DATA.items.filter(i=>i.type==='rpg-mansion-chair-01').length),1,'real picker + canvas places native model');
  const placed=await page.evaluate(()=>JSON.stringify(DATA.items));
  await page.evaluate(()=>undoAction());assert.equal(await page.evaluate(()=>JSON.stringify(DATA.items)),oldItems);
  await page.evaluate(()=>redoAction());assert.equal(await page.evaluate(()=>JSON.stringify(DATA.items)),placed);
  // Selection is not discarded by changing candidates.
  await page.evaluate(()=>{ST.selected=DATA.items[0];});
  await page.selectOption('#catalogue-pack','japanese-standard');assert.equal(await page.evaluate(()=>ST.selected.id),'item-1');
  report.checks.push('real placement / native undo-redo / existing selection preserved');
  const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>exportPlan());const download=await downloadPromise;
  await download.saveAs(path.join(out,'mixed-plan.json'));const exported=JSON.parse(fs.readFileSync(path.join(out,'mixed-plan.json')));
  assert.ok(exported.items.some(i=>i.type==='rpg-mansion-chair-01'));assert.ok(exported.items.some(i=>i.type==='missing-asset-stays'));
  await page.evaluate(p=>applyJsonImport(stageJsonImport(JSON.stringify(p))),exported);
  assert.deepEqual(await page.evaluate(()=>DATA.items),exported.items);
  const hostBefore=await snap(page);
  await page.evaluate(()=>ParallelEditors.open());
  await page.waitForFunction(()=>ParallelEditors.panes.size===2&&[...ParallelEditors.panes.values()].every(p=>p.ready),null,{timeout:120000});
  let [a,b]=await frames();await ready(a);await ready(b);
  await a.selectOption('#catalogue-pack','rpg-mansion');await b.selectOption('#catalogue-pack','japanese-standard');
  const bBefore=await snap(b),aBefore=await snap(a);
  await a.locator('#object-search-input').fill('手紙');assert.equal(await a.locator('#object-search-results [data-tool]').count(),1);
  await b.locator('#object-search-input').fill('手紙');assert.equal(await b.locator('#object-search-results [data-tool]').count(),0);
  await a.locator('#object-search-input').fill('椅子');
  await page.screenshot({path:path.join(out,'independent-pickers.png'),fullPage:true});
  await a.evaluate(()=>{setTool('rpg-mansion-chair-01');AssetPackPicker.setSelection('japanese-standard');});
  assert.equal(await a.evaluate(()=>ST.tool),'select');assert.equal(await snap(a),aBefore);assert.equal(await snap(b),bBefore);
  await a.selectOption('#catalogue-pack','rpg-mansion');
  // Same model can appear multiple times with independent transforms/finishes.
  await a.evaluate(()=>{placeItem('rpg-mansion-chair-01',3400,1800);DATA.items.at(-1).finishColors={fabric:'#325757'};});
  const aMixed=await a.evaluate(()=>JSON.stringify(DATA.items));assert.equal(await a.evaluate(()=>DATA.items.filter(i=>i.type==='rpg-mansion-chair-01').length),2);
  await a.evaluate(()=>EditorPane.save());await page.evaluate(()=>ParallelEditors.saveWorkspace());
  await page.evaluate(()=>ParallelEditors.loadWorkspace());
  await page.waitForFunction(()=>[...ParallelEditors.panes.values()].every(p=>p.ready),null,{timeout:120000});
  [a,b]=await frames();assert.equal(await a.evaluate(()=>AssetPackPicker.getSelection()),'rpg-mansion');assert.equal(await b.evaluate(()=>AssetPackPicker.getSelection()),'japanese-standard');
  assert.equal(await a.evaluate(()=>JSON.stringify(DATA.items)),aMixed);assert.equal(await b.evaluate(()=>JSON.stringify(DATA.items)),JSON.stringify(exported.items));
  report.checks.push('two pane picker/search independence, mixed repeated IDs, per-pane save and workspace reload');
  const swap=await page.evaluate(async()=>{const pane=[...ParallelEditors.panes.values()][0],original=pane.planId,third=await ParallelEditors.addPlan({walls:[],rooms:[],items:[],startMode:'blank'},'第三案');await ParallelEditors.select(pane.id,third);const fresh=pane.frame.contentWindow.AssetPackPicker.getSelection();await ParallelEditors.select(pane.id,original);return {fresh,restored:pane.frame.contentWindow.AssetPackPicker.getSelection()};});
  assert.deepEqual(swap,{fresh:'japanese-standard',restored:'rpg-mansion'});
  report.checks.push('switching a pane to another plan resets/restores its own candidate preference');
  await a.evaluate(()=>setView('3d-ext'));await a.waitForFunction(()=>!!ren&&!hasPendingGltfModels(),null,{timeout:120000});
  await a.evaluate(()=>{setTool('select');});
  const before=await a.evaluate(()=>({data:serializeDataSnapshot(),history:HISTORY.slice(),redo:REDO_HISTORY.slice(),dirty:DIRTY,metrics:EditorPane.metrics()}));
  const networkBefore=requests.filter(x=>/\.glb(?:\?|$)/.test(x)).length;
  const timings=await a.evaluate(()=>{const t=[];for(let i=0;i<100;i++){const start=performance.now();AssetPackPicker.setSelection(i%2?'rpg-mansion':'japanese-standard');t.push(performance.now()-start);}return t;});
  const after=await a.evaluate(()=>({data:serializeDataSnapshot(),history:HISTORY.slice(),redo:REDO_HISTORY.slice(),dirty:DIRTY,metrics:EditorPane.metrics()}));
  assert.equal(after.data,before.data);assert.deepEqual(after.history,before.history);assert.deepEqual(after.redo,before.redo);assert.equal(after.dirty,before.dirty);
  assert.equal(after.metrics.modelCount,before.metrics.modelCount);assert.deepEqual(after.metrics.renderer,before.metrics.renderer);
  assert.equal(requests.filter(x=>/\.glb(?:\?|$)/.test(x)).length,networkBefore);
  assert.equal(await snap(page),hostBefore);
  report.resources={switches:100,modelRequestsBefore:networkBefore,modelRequestsAfter:networkBefore,before:before.metrics,after:after.metrics,switchMs:{max:Math.max(...timings),mean:timings.reduce((s,x)=>s+x,0)/timings.length}};
  await a.locator('#object-search-input').fill('椅子');await page.screenshot({path:path.join(out,'mixed-3d-panes.png'),fullPage:true});
  report.checks.push('100 repeated switches preserve DATA/history/dirty/models/GPU resources and trigger zero GLB requests');
  // Missing thumbnail uses the existing icon vocabulary, without removing card.
  await a.evaluate(()=>{const img=document.querySelector('#object-search-results [data-tool="rpg-mansion-chair-01"] img');img.src='assets/missing-rpg-thumb.png';});
  await a.waitForSelector('#object-search-results [data-tool="rpg-mansion-chair-01"] .asset-thumbnail-fallback');
  assert.equal(await a.evaluate(()=>JSON.stringify(DATA.items)),aMixed);
  report.checks.push('missing thumbnail retains selectable card and plan');
  // Fresh context: optional pack manifest unavailable, missing model and unknown
  // placed IDs remain intact and use the editor fallback path, not conversion.
  const fallback=await context.newPage();fallback.on('pageerror',e=>errors.push(e.message));
  await fallback.route('**/packs/rpg-mansion/manifest.json',route=>route.fulfill({status:404,body:'missing'}));
  await fallback.goto(url+'?preset=blank');await ready(fallback);
  assert.equal(await fallback.evaluate(()=>AssetPackPicker.setSelection('rpg-mansion')),'japanese-standard');
  assert.equal(await fallback.locator('#catalogue-pack option').count(),1);
  await fallback.evaluate(p=>applyJsonImport(stageJsonImport(JSON.stringify(p))),exported);
  const missingItems=await fallback.evaluate(()=>JSON.stringify(DATA.items));
  await fallback.evaluate(()=>setView('3d-ext'));await fallback.waitForFunction(()=>!!ren&&!hasPendingGltfModels(),null,{timeout:120000});
  assert.equal(await fallback.evaluate(()=>JSON.stringify(DATA.items)),missingItems);
  assert.equal(await fallback.evaluate(()=>DATA.items.find(i=>i.type==='missing-asset-stays').customMetadata.retain),true);
  await fallback.screenshot({path:path.join(out,'missing-pack-fallback.png'),fullPage:true});await fallback.close();
  report.checks.push('missing optional pack falls back; unknown/RPG placed IDs survive import and generic 3D rendering');
  const broken=await context.newPage();broken.on('pageerror',e=>errors.push(e.message));
  await broken.route('**/rpg-mansion-chair-01.glb*',route=>route.fulfill({status:404,body:'missing'}));
  await broken.goto(url+'?preset=blank');await ready(broken);
  await broken.evaluate(p=>applyJsonImport(stageJsonImport(JSON.stringify(p))),exported);
  const brokenBefore=await broken.evaluate(()=>JSON.stringify(DATA.items));await broken.evaluate(()=>setView('3d-ext'));
  await broken.waitForFunction(()=>!!ren&&!hasPendingGltfModels()&&Object.keys(_modelFailed).some(url=>url.includes('rpg-mansion-chair-01')),null,{timeout:120000});
  assert.equal(await broken.evaluate(()=>JSON.stringify(DATA.items)),brokenBefore);await broken.close();
  report.checks.push('failed GLB keeps known placed asset and falls through existing 3D fallback');
  const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(url+'?preset=blank');await ready(mobile);await mobile.click('#bnav-tools');
  await mobile.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().top<300);
  await mobile.selectOption('#catalogue-pack','rpg-mansion');await mobile.locator('#object-search-input').fill('椅子');
  assert.equal(await mobile.locator('#object-search-results [data-tool]').count(),2);
  await mobile.locator('#sidebar').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
  const box=await mobile.locator('#catalogue-pack').boundingBox();assert.ok(box&&box.width>150&&box.height>=40&&box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);
  assert.equal(await mobile.evaluate(()=>{const el=document.getElementById('catalogue-pack'),r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),true);
  // Hide only the offline harness banner in this capture, not product chrome.
  await mobile.screenshot({path:path.join(out,'mobile-picker.png'),animations:'disabled',style:'.offline-preview-banner{visibility:hidden!important}'});await mobile.close();
  report.checks.push('390px mobile existing tools sheet keeps pack control/search usable');
  assert.deepEqual(errors,[]);report.status='passed';fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }catch(e){report.status='failed';report.failure=e.stack;fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
