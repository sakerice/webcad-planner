// Real startup flows, including delayed default fetches and intentional blank saves.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.APP_URL||'http://localhost:8937/';
(async()=>{const browser=await chromium.launch({channel:'chrome',args:['--use-angle=metal']});const errors=[];
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>errors.push(e.message));
  let release;const gate=new Promise(r=>release=r);
  await page.route('**/assets/default_plan.json',async route=>{await gate;await route.continue();});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#preset-choice-modal.show').waitFor();
  assert.equal(await page.locator('.preset-choice-name').first().textContent(),'2階建て 3LDK・吹き抜けとテラス');
  assert.ok(!await page.locator('#preset-choice-modal').innerText().then(s=>s.includes('アイランド')));
  await page.locator('.preset-blank-btn').scrollIntoViewIfNeeded();
  fs.mkdirSync('docs/quality-review/default-plans-release',{recursive:true});
  await page.screenshot({path:'docs/quality-review/default-plans-release/dialog-'+width+'.png'});
  await page.locator('.preset-blank-btn').click();release();await page.waitForTimeout(800);
  assert.deepEqual(await page.evaluate(()=>[DATA.walls.length,DATA.items.length,DATA.rooms.length]),[0,0,0]);
  assert.equal(await page.evaluate(()=>PRESET_CURRENT),'blank');
  await page.evaluate(()=>StorageAdapter.save(DATA));page.on('dialog',d=>d.accept());
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>DATA.startMode==='blank'&&!_defaultPlanPending);
  assert.deepEqual(await page.evaluate(()=>[DATA.walls.length,DATA.items.length,DATA.rooms.length]),[0,0,0]);
  assert.equal(await page.locator('#preset-choice-modal').evaluate(el=>el.classList.contains('show')),false);
  // Existing user content also takes precedence over any startup preset.
  await page.evaluate(()=>StorageAdapter.save({walls:[],items:[],rooms:[{id:'saved-room',type:'room',floor:1,x:0,y:0,w:3000,d:3000,n:'保存した部屋'}]}));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>DATA.rooms.some(r=>r.id==='saved-room'));
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>DATA.rooms.length),1);
  await page.close();console.log(width+': blank start, delayed fetch, blank restore and saved plan restore passed');
 }
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));let release;const gate=new Promise(r=>release=r);
 await page.route('**/assets/default_plan.json',async route=>{await gate;await route.continue();});
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.preset-choice-btn').nth(1).click();
 await page.waitForFunction(()=>PRESET_CURRENT==='3f'&&DATA.items.length>0);release();await page.waitForTimeout(800);
 assert.equal(await page.evaluate(()=>PRESET_CURRENT),'3f');await page.close();
 const two=await browser.newPage();await two.goto(base+'?preset=2f');await two.waitForFunction(()=>PRESET_CURRENT==='2f'&&DATA.items.length===176);
 assert.equal(await two.evaluate(()=>DATA.items.some(i=>i.id===1131)),false);await two.close();
 assert.deepEqual(errors,[]);console.log('Both presets selected correctly; no page errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
