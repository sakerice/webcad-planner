/* Synthetic large valid annotations exercise bounded serialization, not source accuracy. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const origin=process.env.APP_URL||'http://127.0.0.1:65372',out=process.env.OUTPUT_DIR||'/tmp/webcad-large-review';assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync('local-preview/frozen-page-2.json')),text='図'.repeat(2000);source.annotations=source.annotations.concat(Array.from({length:256-source.annotations.length},(_,i)=>({id:'large-note-'+i,kind:'label',literalText:{value:text,status:'inferred',source:text,reason:text}})));const compact=JSON.stringify(source),original=compact+' '.repeat(5685751-Buffer.byteLength(compact)),input=Buffer.from(original);
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],blocked=[];context.setDefaultTimeout(90000);
 try{await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/'))return r.continue();blocked.push(u.origin+u.pathname);return r.abort();});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(origin);await p.waitForSelector('#app-loading',{state:'hidden'});await p.evaluate(()=>closePresetChoice());const before=await p.evaluate(()=>serializeDataSnapshot());let start=Date.now();await p.locator('#import-file').setInputFiles({name:'large-valid-source.json',mimeType:'application/json',buffer:input});await p.waitForSelector('[data-scene-full-status]');const importMs=Date.now()-start;await p.evaluate(()=>window.__beforeReview=PlanImport.state.result);start=Date.now();const downloadEvent=p.waitForEvent('download');await p.locator('[data-scene-review-save]').click();const download=await downloadEvent,bytes=fs.readFileSync(await download.path()),saved=JSON.parse(bytes);const saveMs=Date.now()-start;assert.ok(bytes.length<=8*1024*1024);assert.equal(saved.version,2);assert.equal(saved.sceneIR,undefined);assert.equal(saved.extraction.rawResponse,original);start=Date.now();await p.locator('[data-scene-review-file]').setInputFiles({name:'large-review.json',mimeType:'application/json',buffer:bytes});await p.waitForFunction(()=>PlanImport.state.result!==__beforeReview);const resumeMs=Date.now()-start;assert.equal(await p.evaluate(()=>PlanImport.state.result.sceneIR.annotations.length),256);assert.equal(await p.evaluate(()=>PlanImport.state.result.extraction.rawResponse),original);assert.equal(await p.evaluate(()=>serializeDataSnapshot()),before);assert.equal(await p.locator('#plan-import-apply').isDisabled(),true);await p.screenshot({path:path.join(out,'large-file-resumed.png')});
 // A saved native report uses the same codec, after all in-memory review state is gone.
 const scope=require('../../assets/js/scene-ir-v3.js').createPartialSelection(source,[],true,['wall-west']);
 saved.sceneOptions.partialSelection=scope;
 await p.evaluate(()=>window.__beforeReview=PlanImport.state.result);
 await p.locator('[data-scene-review-file]').setInputFiles({name:'large-partial-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await p.waitForFunction(()=>PlanImport.state.result!==__beforeReview);
 if(!await p.locator('[data-scene-partial-options]').evaluate(e=>e.open))await p.locator('[data-scene-partial-options] > summary').click();
 assert.equal(await p.locator('[data-scene-partial-structure="wall-west"]').isChecked(),true);
 await p.locator('[data-scene-partial-accept]').check();
 await p.locator('#plan-import-apply').click();
 await p.waitForFunction(()=>PlanImport.state.result?.scenePartialOpened===true);
 async function nativeFrame(){for(const frame of p.frames().slice(1))if(await frame.evaluate(()=>window.DATA?.sceneReconstructionReports?.[0]?.originalIR?.annotations?.length===256))return frame;throw Error('Large native report pane missing');}
 const frame=await nativeFrame();
 await frame.locator('#save-btn').click();
 await frame.waitForFunction(()=>DIRTY===false&&!document.getElementById('save-btn').classList.contains('saving'));
 const storedReport=await frame.evaluate(()=>JSON.stringify(DATA.sceneReconstructionReports[0]));
 const report=JSON.parse(storedReport);
 assert.equal(report.extraction.rawResponse,original);
 assert.deepEqual(report.originalIR,source);
 assert.equal(report.originalIR.objects.length,20);
 const deferredIds=new Set(report.deferredEntities.map(e=>e.id));
 for(const o of source.objects)assert.ok(deferredIds.has(o.id));
 await p.locator('[data-parallel-save]').click();
 await p.waitForFunction(()=>document.querySelector('[data-parallel-status]').textContent==='表示中・非表示の案をこのブラウザに保存しました。');
 // Browser document reload discards the review body and all old runtime objects.
 await p.reload();await p.waitForSelector('#app-loading',{state:'hidden'});await p.evaluate(()=>closePresetChoice());
 await p.locator('#compare-launch').click();
 await p.locator('[data-parallel-load]').click();
 await p.waitForFunction(()=>document.querySelector('[data-parallel-status]').textContent==='保存した比較セットを開きました。');
 const fresh=await nativeFrame();
 assert.equal(await fresh.evaluate(()=>PlanImport.state.result),null);
 assert.equal(await fresh.evaluate(()=>JSON.stringify(DATA.sceneReconstructionReports[0])),storedReport);
 const nativeBefore=await fresh.evaluate(()=>serializeDataSnapshot());
 await fresh.locator('#plan-import-toolbar-btn').click();
 if(!await fresh.locator('#scene-review-files').evaluate(e=>e.open))await fresh.locator('#scene-review-files > summary').click();
 start=Date.now();await fresh.locator('[data-scene-resume-report]').click();
 await fresh.waitForFunction(()=>!!PlanImport.state.result?.sceneIR);
 const nativeResumeMs=Date.now()-start;
 assert.equal(await fresh.evaluate(()=>PlanImport.state.result.extraction.rawResponse),original);
 assert.equal(await fresh.evaluate(()=>JSON.stringify(PlanImport.state.result.sceneIR)),JSON.stringify(source));
 assert.equal(await fresh.evaluate(()=>PlanImport.state.result.sceneOptions.acceptedReviewGroups.length),0);
 assert.equal(await fresh.evaluate(()=>Object.keys(PlanImport.state.result.sceneOptions.reviewedEntities).length),0);
 assert.equal(await fresh.locator('#plan-import-apply').isDisabled(),true);
 assert.equal(await fresh.evaluate(()=>serializeDataSnapshot()),nativeBefore);
 assert.equal(await fresh.evaluate(()=>JSON.stringify(DATA.sceneReconstructionReports[0])),storedReport);
 await p.screenshot({path:path.join(out,'large-native-fresh-reload-evidence-resume.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);const result={syntheticPerformanceFixture:true,inputBytes:input.length,savedBytes:bytes.length,formatVersion:saved.version,rawSha256:crypto.createHash('sha256').update(input).digest('hex'),savedSha256:crypto.createHash('sha256').update(bytes).digest('hex'),importMs,saveMs,resumeMs,nativeResumeMs,nativeFreshReload:true,nativeRawNotesAndDeferredUnchanged:true,nativeAll20ObjectsDeferred:true,nativeApprovalTokensReset:true,nativeStoredReportSha256:crypto.createHash('sha256').update(storedReport).digest('hex'),exactRawPreserved:true,originalPlanPreserved:true,paidCalls:0,errors,blocked};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
