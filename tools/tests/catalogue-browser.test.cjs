const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {existsSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'../..');
const cache=join(process.env.HOME||'','.npm/_npx');
const candidates=[join(root,'node_modules/playwright/index.mjs')];
if(existsSync(cache))for(const dir of readdirSync(cache))candidates.push(join(cache,dir,'node_modules/playwright/index.mjs'));
const playwright=candidates.find(existsSync);
test('catalogue search stays visible and selects the correct tool on mobile and desktop',{skip:!playwright,timeout:45000},async()=>{
 const server=spawn('python3',['-m','http.server','8794','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 let browser;
 try{
  await new Promise(r=>setTimeout(r,700));
  const {chromium}=await import(playwright);browser=await chromium.launch();
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   // ?preset=2f: 起動時の「はじめる間取りを選ぶ」ダイアログを出さずに2階建てで開く。
   // ダイアログが画面を覆っていると、下のカタログはクリックできない
   await page.goto('http://127.0.0.1:8794/?preset=2f',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#fmp-furniture-search',{state:'attached'});
   if(width<500)await page.locator('#bnav-tools').click();
   await page.evaluate(()=>document.getElementById('fmp-furniture').closest('.cat-body').classList.add('open'));
   for(const mount of ['fmp-furniture','fmp-fixtures','fmp-exterior']){assert.ok(await page.locator('#'+mount+' .asset-tile').count()>0);assert.equal(await page.locator('#'+mount+' .asset-subcat.open').count(),0);}
   assert.equal(await page.locator('#fmp-furniture .asset-tile').first().isVisible(),false);
   const input=page.locator('#fmp-furniture-search');
   await input.fill('ベッド');assert.ok(await page.locator('#fmp-furniture .asset-tile:not([hidden])').count()>1);
   await input.fill('ｂｅｄ０１');
   await page.waitForFunction(()=>document.querySelector('#fmp-furniture-search').getBoundingClientRect().top>=document.querySelector('.common-tools').getBoundingClientRect().bottom);
   assert.equal(await page.locator('#fmp-furniture .asset-tile:not([hidden])').count(),1);
   await input.fill('該当しない検索');assert.equal(await page.locator('#fmp-furniture .asset-tile:not([hidden])').count(),0);
   await input.fill('');assert.equal(await page.locator('#fmp-furniture .asset-subcat.open').count(),0);
   await input.fill('Bed01');await page.locator('#fmp-furniture .asset-tile:not([hidden])').click();
   assert.equal(await page.evaluate(()=>ST.tool),'fmp-Bed01');assert.deepEqual(errors,[]);await page.close();
  }
 }finally{if(browser)await browser.close();server.kill();}
});
