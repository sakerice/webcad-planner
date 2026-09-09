const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {existsSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'../..');
const cache=join(process.env.HOME||'','.npm/_npx');
const candidates=[join(process.env.PLAYWRIGHT_MODULE||join(root,'node_modules/playwright'),'index.mjs')];
if(existsSync(cache))for(const dir of readdirSync(cache))candidates.push(join(cache,dir,'node_modules/playwright/index.mjs'));
const playwright=candidates.find(existsSync);
test('catalogue search stays visible and selects the correct tool on mobile and desktop',{skip:!playwright,timeout:90000},async()=>{
 const server=spawn('python3',['-m','http.server','8794','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 let browser;
 try{
  await new Promise(r=>setTimeout(r,700));
  const {chromium}=await import(playwright);browser=await chromium.launch({channel:'chrome',args:['--use-angle=metal']});
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   // ?preset=2f: 起動時の「はじめる間取りを選ぶ」ダイアログを出さずに2階建てで開く。
   // ダイアログが画面を覆っていると、下のカタログはクリックできない
   await page.goto((process.env.APP_URL||'http://127.0.0.1:8794/')+'?preset=2f',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#object-search-input',{state:'attached'});
   if(width<500)await page.locator('#bnav-tools').click();
   assert.equal(await page.locator('#sidebar input[type="search"]').count(),1);
   assert.ok(await page.evaluate(()=>document.querySelector('.common-tools').nextElementSibling.id==='object-search'));
   const input=page.locator('#object-search-input'),results=page.locator('#object-search-results');
   await input.fill('ベッド');assert.ok(await results.locator('[data-tool]').count()>1);
   await input.fill('ｂｅｄ０１');assert.equal(await results.locator('[data-tool]').count(),1);
   await input.fill('敷地');assert.equal(await results.locator('[data-tool="foundation"]').count(),1);
   await input.fill('窓');assert.equal(await results.locator('[data-tool="opening-window-model:fix"]').count(),1);
   await input.fill('照明');assert.equal(await results.locator('[data-tool="light-down"]').count(),1);
   await input.fill('該当しない検索');assert.equal(await results.locator('[data-tool]').count(),0);
   await page.locator('.catalogue-search-clear').click();assert.equal(await input.inputValue(),'');
   assert.equal(await page.locator('#fmp-furniture .asset-subcat.open').count(),0);
   await input.fill('Bed01');await results.locator('[data-tool="fmp-Bed01"]').click();
   assert.equal(await page.evaluate(()=>ST.tool),'fmp-Bed01');
   if(width<500 && !await page.locator('#sidebar').evaluate(el=>el.classList.contains('mob-open')))await page.locator('#bnav-tools').click();
   await input.fill('基礎');await results.locator('[data-tool="foundation"]').click();
   assert.equal(await page.evaluate(()=>ST.tool),'foundation');
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{if(browser)await browser.close();server.kill();}
});
