// Run against tools/dev_server.py, with PLAYWRIGHT_MODULE pointing to an installed Playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8931');
await page.waitForTimeout(1200);
await page.evaluate(()=>{document.getElementById('preset-choice-overlay')?.remove();document.querySelectorAll('[id*=preset-choice]').forEach(e=>e.style.display='none');});
// Use the repository's frozen sample only; no personal house assets.
const fixture=JSON.parse(fs.readFileSync(__dirname+'/fixtures/house-2f.json','utf8'));
await page.evaluate(p=>{_defaultPlanPending=false;DATA=p;ST.selected={type:'wall',idx:0};ST.floor=2;ST.panX=142;saveState();draw2d();},fixture);
const signature=()=>page.evaluate(()=>JSON.stringify({DATA,ST,history:HISTORY,redo:REDO_HISTORY,shared:typeof SHARED!=='undefined'?SHARED:null}));
const before=await signature();
await page.locator('#compare-launch').click();
await page.locator('#compare-name').fill('サンプル案 A');
await page.evaluate(()=>{document.getElementById('compare-save').click();document.getElementById('compare-save').click();});await page.waitForFunction(()=>document.getElementById('compare-count').textContent.startsWith('1案'));
await page.locator('#compare-name').fill('サンプル案 B（同じ間取り）');
await page.locator('#compare-import').setInputFiles({name:'sample.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
await page.waitForFunction(()=>document.getElementById('compare-count').textContent.startsWith('2案'));
await page.locator('#compare-view-name').fill('1F 全体・共通');await page.locator('#compare-save-view').click();
await page.waitForFunction(()=>document.getElementById('compare-views').options.length===1);
const originalImage=await page.locator('#compare-a-image').getAttribute('src');
assert.equal(originalImage,await page.locator('#compare-b-image').getAttribute('src'));
for(let i=0;i<8;i++)await page.locator('#compare-fit').click();
await page.keyboard.press('f');await page.keyboard.press('Delete');await page.keyboard.press('Control+z');await page.keyboard.press('ArrowLeft');
assert.equal(await signature(),before);
await page.locator('[data-compare-camera="in"]').click();
await page.locator('[data-compare-camera="right"]').click();
assert.notEqual(await page.locator('#compare-a-image').getAttribute('src'),originalImage);
await page.locator('#compare-views').selectOption({label:'1F 全体・共通'});
assert.equal(await page.locator('#compare-a-image').getAttribute('src'),await page.locator('#compare-b-image').getAttribute('src'));
assert.equal(await page.locator('#compare-a-image').getAttribute('src'),originalImage);
assert.equal(await signature(),before);
await page.locator('#compare-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});
await page.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('失敗'));
assert.equal(await page.locator('#compare-a option').count(),2);
await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Test quota failure','QuotaExceededError');};});
await page.locator('#compare-save').click();await page.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('quota'));
assert.equal(await page.locator('#compare-a option').count(),2);assert.equal(await signature(),before);
await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});
await page.evaluate(()=>{IDBObjectStore.prototype.put=function(...args){const request=window.originalPut.apply(this,args);this.transaction.abort();return request;};});
await page.locator('#compare-save').click();await page.waitForTimeout(100);
assert.equal(await page.locator('#compare-a option').count(),2);assert.equal(await signature(),before);
await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});

// Hold PNG decoding, close the panel, then release: cancellation must not download.
let cancelledDownloads=0;const onDownload=()=>cancelledDownloads++;page.on('download',onDownload);
await page.evaluate(()=>{window.originalDecode=Image.prototype.decode;window.decodeResolvers=[];Image.prototype.decode=function(){return new Promise(resolve=>window.decodeResolvers.push(resolve));};});
await page.locator('#compare-images').click();await page.keyboard.press('Escape');
await page.evaluate(()=>{window.decodeResolvers.forEach(resolve=>resolve());Image.prototype.decode=window.originalDecode;});
await page.waitForTimeout(100);assert.equal(cancelledDownloads,0);page.off('download',onDownload);
assert.equal(await signature(),before);
await page.locator('#compare-launch').click();await page.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('切り替えて'));
const downloadPromise=page.waitForEvent('download');await page.locator('#compare-images').click();const download=await downloadPromise;
fs.mkdirSync('/tmp/webcad-comparison',{recursive:true});await download.saveAs('/tmp/webcad-comparison/comparison.png');
await page.screenshot({path:'/tmp/webcad-comparison/desktop.png'});
// Illustrative finish changes on the frozen sample, explicitly labeled as a sample.
const variant=JSON.parse(JSON.stringify(fixture));variant.rooms.forEach(r=>r.floorColor='#D5DFDC');variant.walls.forEach(w=>w.interiorColor='#92A8A1');
await page.locator('#compare-name').fill('サンプル色替え / セージ');
await page.locator('#compare-import').setInputFiles({name:'sample-variant.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(variant))});
await page.waitForFunction(()=>document.getElementById('compare-a').options.length===3);
await page.waitForFunction(()=>document.getElementById('compare-b-image').complete);
await page.screenshot({path:'/tmp/webcad-comparison/material-sample.png'});
const materialDownload=page.waitForEvent('download');await page.locator('#compare-images').click();await (await materialDownload).saveAs('/tmp/webcad-comparison/comparison-materials.png');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/webcad-comparison/mobile.png'});
assert.ok(await page.evaluate(()=>{const d=document.getElementById('compare-dialog');return d.scrollWidth<=d.clientWidth+1;}));
await page.reload();await page.waitForTimeout(500);await page.evaluate(()=>PlanComparison.open());
await page.waitForFunction(()=>document.getElementById('compare-a').options.length===3);
assert.equal(await page.locator('#compare-views option').count(),1);
console.log(JSON.stringify({passed:'save/import, view equality, repeated clicks, invalid JSON, quota failure, transaction abort, edit/history preservation, cancelled PNG, Escape/reopen, PNG download, mobile overflow, reload',errors}));
assert.deepEqual(errors,[]);
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
