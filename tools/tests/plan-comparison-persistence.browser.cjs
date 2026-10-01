// Real IndexedDB regressions: stale tabs and closing during an outstanding save.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/house-2f.json');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try{
    const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
    const errors=[];
    for(const page of [a,b]){
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:8931');
      await page.waitForFunction(()=>window.PlanComparison);
      await page.evaluate(p=>{_defaultPlanPending=false;DATA=p;document.getElementById('preset-choice-overlay')?.remove();},fixture);
      await page.evaluate(()=>PlanComparison.open());
    }
    const save=async(page,name)=>{await page.locator('#compare-name').fill(name);await page.locator('#compare-save').click();await page.waitForFunction(n=>document.getElementById('compare-status').textContent.includes('「'+n+'」を保存'),name);};
    await save(a,'tab A');await save(b,'tab B');
    assert.equal(await b.locator('#compare-a option').count(),2);
    for(const [page,name] of [[a,'view A'],[b,'view B']]){
      await page.locator('#compare-view-name').fill(name);await page.locator('#compare-save-view').click();
      await page.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('平面視点を保存'));
    }
    const persisted=await a.evaluate(()=>PlanComparison.storage());
    assert.deepEqual(persisted.plans.map(p=>p.name),['tab A','tab B']);
    assert.deepEqual(persisted.views.map(p=>p.name),['view A','view B']);
    await Promise.all([a,b].map((page,i)=>page.evaluate(i=>PlanComparison.storage({version:1,plans:[],views:[],cameras:[{id:'camera-'+i,name:'camera '+i,spec:{floor:1,pos:[1,2,3],target:[0,0,0],up:[0,1,0],fov:65,width:960,height:720,lighting:{}}}]}),i)));
    assert.equal((await a.evaluate(()=>PlanComparison.storage())).cameras.length,2);
    // Pause the next database open before its transaction begins. The save stays busy.
    await b.evaluate(()=>{
      const original=indexedDB.open.bind(indexedDB);
      indexedDB.open=function(...args){
        const real=original(...args),proxy={};indexedDB.open=original;
        real.onsuccess=()=>{proxy.result=real.result;window.releaseComparisonSave=()=>proxy.onsuccess();};
        real.onerror=()=>{proxy.error=real.error;proxy.onerror();};return proxy;
      };
    });
    await b.locator('#compare-name').fill('pending save');await b.locator('#compare-save').click();
    await b.waitForFunction(()=>window.releaseComparisonSave);
    await b.locator('#compare-close').click();await b.evaluate(()=>PlanComparison.open());
    assert.equal(await b.locator('#compare-save').isDisabled(),true);
    await b.evaluate(()=>releaseComparisonSave());
    await b.waitForFunction(()=>document.getElementById('compare-count').textContent.startsWith('3案'));
    await save(b,'after reopen');
    assert.equal(await b.locator('#compare-a option').count(),4);
    // Compare linked finishes in actual canvas output with otherwise identical plans.
    const before=await b.evaluate(()=>JSON.stringify(DATA));
    const originalImage=await b.locator('#compare-b-image').getAttribute('src');
    const linked=JSON.parse(JSON.stringify(fixture));linked.interiorWallSettings={whole:{linked:true,color:'#cc1133'},floors:{}};
    await b.locator('#compare-name').fill('linked whole');
    await b.locator('#compare-import').setInputFiles({name:'whole.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(linked))});
    await b.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('「linked whole」を保存'));
    const wholeImage=await b.locator('#compare-b-image').getAttribute('src');assert.notEqual(wholeImage,originalImage);
    linked.interiorWallSettings={whole:{linked:false},floors:{1:{linked:true,color:'#1166cc'},2:{linked:true,color:'#1166cc'}}};
    await b.locator('#compare-name').fill('linked floor');
    await b.locator('#compare-import').setInputFiles({name:'floor.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(linked))});
    await b.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('「linked floor」を保存'));
    assert.notEqual(await b.locator('#compare-b-image').getAttribute('src'),wholeImage);
    assert.equal(await b.evaluate(()=>JSON.stringify(DATA)),before);
    await b.reload();await b.waitForFunction(()=>window.PlanComparison);await b.evaluate(()=>PlanComparison.open());
    assert.equal(await b.locator('#compare-a option').count(),6);
    assert.equal(await b.locator('#compare-views option').count(),2);
    assert.equal(await b.locator('#compare-cameras option').count(),2);
    // Selecting a saved view must not reuse its identity when saving a new name.
    await b.locator('#compare-views').selectOption({label:'view A'});
    await b.locator('#compare-view-name').fill('view A copy');await b.locator('#compare-save-view').click();
    await b.waitForFunction(()=>document.getElementById('compare-views').options.length===3);
    await b.locator('#compare-views').selectOption({label:'view A'});
    await b.locator('[data-compare-camera="right"]').click();
    await b.locator('#compare-view-name').fill('view A moved');await b.locator('#compare-save-view').click();
    await b.waitForFunction(()=>document.getElementById('compare-views').options.length===4);
    const finalViews=(await b.evaluate(()=>PlanComparison.storage())).views;
    const original=finalViews.find(v=>v.name==='view A'),copy=finalViews.find(v=>v.name==='view A copy'),moved=finalViews.find(v=>v.name==='view A moved');
    assert.equal(new Set(finalViews.map(v=>v.id)).size,4);
    for(const key of ['x','y','span','floor'])assert.equal(original[key],copy[key]);
    assert.notEqual(original.x,moved.x);
    assert.deepEqual(original,persisted.views.find(v=>v.name==='view A'));
    assert.deepEqual(errors,[]);
    console.log('PASS: two stale tabs retain snapshots/views; delayed save close/reopen and next save; linked whole/floor images differ; live edits preserved; reload; saved-view copy and moved copy keep fresh identity; no page errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
