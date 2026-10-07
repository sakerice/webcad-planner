/* Dedicated offline browser: no existing tabs, production data, API or AI. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {openImportReview}=require('./plan-import-browser-helpers.cjs');
const origin=process.env.APP_URL||'http://127.0.0.1:65371';
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const out=process.env.OUTPUT_DIR||path.join(os.tmpdir(),'webcad-full-review');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[],blocked=[];
 try{
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/'))return r.continue();blocked.push(u.origin+u.pathname);return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?internalAPI=1');
  await page.waitForSelector('#app-loading',{state:'hidden',timeout:60000});
  await page.evaluate(()=>closePresetChoice());
  await page.getByRole('button',{name:'固定raw 2Fの部分プレビュー（AIなし・未完成）'}).click();
  await page.waitForSelector('[data-scene-full-status]');
  await openImportReview(page);
  const integrity=()=>page.evaluate(()=>({data:serializeDataSnapshot(),history:JSON.stringify(HISTORY),redo:JSON.stringify(REDO_HISTORY),dirty:DIRTY,raw:PlanImport.state.result.extraction,source:PlanImport.state.result.sceneIR,storage:Object.fromEntries(Object.entries(localStorage))}));
  const before=await integrity();
  const baseline=await page.evaluate(()=>({sourceHash:SceneIR.sourceHash(PlanImport.state.result.sceneIR),errors:PlanImport.state.result.sceneFullCompilation.diagnostics.filter(d=>d.severity==='error')}));
  assert.equal(baseline.sourceHash,'sha256:8ab65653dfd5ece89c6b7aecfe4b28dce4517bb29f364e89d2cbd44dd897f1fd');
  assert.equal(before.raw.rawSha256,'c98e9213665b0527fae907a19d145d8a038db8f82bd049c57b74607add05485c');
  // Select one non-hosting wall through the compiler's existing explicit scope.
  await page.evaluate(()=>{const b=PlanImport.state.result;PlanImport.stageSceneIR(b.sceneIR,{...b.sceneOptions,partialSelection:SceneIR.createPartialSelection(b.sceneIR,[],true,['wall-west'])});});
  await page.locator('[data-scene-partial-options] > summary').click();
  await page.locator('[data-scene-partial-structure="wall-storage-east"]').check();
  assert.equal(await page.locator('[data-scene-partial-options]').evaluate(el=>el.open),true);
  await page.locator('[data-scene-partial-structure="wall-storage-east"]').uncheck();
  await page.locator('[data-scene-partial-options] > summary').click();
  await page.locator('[data-scene-review-filter]').selectOption('unresolved');
  await page.locator('[data-scene-review-search]').fill('unsupported_opening_mechanism');
  const door=page.locator('details[data-scene-group]').filter({has:page.locator('[data-scene-full-group-errors]')}).filter({hasText:'unsupported_opening_mechanism'});await door.locator(':scope > summary').click();
  assert.equal(await door.isVisible(),true);await door.locator(':scope > details').evaluateAll(es=>es.forEach(e=>e.open=true));assert.match(await door.innerText(),/bypass-slide/);
  await page.screenshot({path:path.join(out,'desktop-full-blocker.png')});
  await door.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'desktop-door-evidence.png')});
  assert.deepEqual(await integrity(),before);
  // Explicit room mapping is reachable even though that room is outside the partial scope.
  await page.locator('[data-scene-review-search]').fill('room-ldk');
  await page.locator('details[data-scene-group="rooms:room-ldk"] > summary').click();
  await page.locator('[data-scene-mapping="room-ldk"]').click();
  assert.equal(await page.locator('[data-scene-review-search]').isDisabled(),true);
  assert.equal(await page.locator('[data-scene-review-filter]').isDisabled(),true);
  await page.locator('[data-scene-appearance]').selectOption('match-diagram-appearance');
  await page.locator('[data-scene-mapping-confirm]').click();
  const refreshed=await page.evaluate(()=>{const b=PlanImport.state.result;return {errors:b.sceneFullCompilation.diagnostics.filter(d=>d.severity==='error'),decisions:b.sceneOptions.bindingDecisions,canApply:b.sceneFullCompilation.canApply};});
  assert.equal(refreshed.errors.some(d=>d.path==='rooms[0].appearance'&&d.code==='appearance_mapping_required'),false);
  assert.ok(refreshed.errors.some(d=>d.code==='unsupported_stair_reconstruction'));assert.equal(refreshed.canApply,false);
  assert.deepEqual(await integrity(),before);
  // API and direct review full diagnostics use identical target, bindings and compiler.
  const parity=await page.evaluate(async()=>{const b=PlanImport.state.result,scene=WebCADInternalAPI.get_scene({planId:'host-draft'});const r=await WebCADInternalAPI.preview_patch({planId:'host-draft',baseRevision:scene.revision,selectedObjectIds:[],selectedEntityIds:['wall-south'],displayBindings:[],incompleteConfirmed:true});return {rendered:r.rendered,api:r.fullDiagnostics,direct:b.sceneFullCompilation.diagnostics};});
  assert.equal(parity.rendered,false);assert.deepEqual(parity.api,parity.direct);assert.deepEqual(await integrity(),before);
  await page.locator('[data-scene-review-search]').fill('unsupported_stair_reconstruction');
  await page.locator('details[data-scene-group]:visible > summary').click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-full-blocker.png')});
  await page.locator('details[data-scene-group]:visible').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'mobile-stair-evidence.png')});
  const overflow=await page.evaluate(()=>{const modal=document.querySelector('#plan-import-modal');return {page:document.documentElement.scrollWidth,viewport:innerWidth,modal:modal.getBoundingClientRect().width};});
  assert.ok(overflow.page<=overflow.viewport+1,JSON.stringify(overflow));
  // Cancellation returns to last confirmed choices without touching the active plan.
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-scene-review-filter]').selectOption('all');await page.locator('[data-scene-review-search]').fill('obj-sofa');
  const sofa=page.locator('details[data-scene-group="objects:obj-sofa"]');await sofa.locator(':scope > summary').click();await page.locator('[data-scene-mapping="obj-sofa"]').click();
  const decisions=await page.evaluate(()=>JSON.stringify(PlanImport.state.result.sceneOptions.bindingDecisions));
  await page.locator('[data-scene-mapping-cancel]').click();assert.equal(await page.evaluate(()=>JSON.stringify(PlanImport.state.result.sceneOptions.bindingDecisions)),decisions);assert.deepEqual(await integrity(),before);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({rawSha256:before.raw.rawSha256,sourceHash:baseline.sourceHash,baseline,refreshed,parity,overflow,originalPreserved:true,cancelPreserved:true,paidCalls:0,errors,blocked},null,2));
  console.log(JSON.stringify({errors:errors.length,fullErrorsBefore:baseline.errors.length,fullErrorsAfter:refreshed.errors.length,parity:true,originalPreserved:true,out}));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
