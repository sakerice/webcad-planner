import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({args:['--use-angle=metal']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForSelector('#fmp-exterior-search',{state:'attached'});await page.locator('#bnav-tools').click();await page.evaluate(()=>document.getElementById('fmp-exterior').closest('.cat-body').classList.add('open'));
 for(const name of ['薄型機能門柱','一体型機能門柱','二本脚型']) {
  await page.locator('#fmp-exterior-search').fill(name);const tile=page.locator('#fmp-exterior .asset-tile:not([hidden])');assert.equal(await tile.count(),1);await tile.click();
  await page.evaluate(()=>{ST.floor=1;placeItem(ST.tool,2000,2000);document.getElementById('props').classList.add('show','prop-expanded');});
  await page.locator('#finish-body').fill('#223344');await page.locator('#finish-panel').fill('#998877');await page.locator('#finish-roughness-panel').selectOption('0.48');
  const state=await page.evaluate(()=>({ground:item3DBaseY(ST.selected),saved:JSON.parse(serializeDataSnapshot()).items.find(i=>i.id===ST.selected.id)}));assert.equal(state.ground,0);assert.equal(state.saved.finishColors.body,'#223344');assert.equal(state.saved.finishColors.panel,'#998877');assert.equal(state.saved.finishRoughness.panel,.48);await page.locator('#mob-prop-close-btn').click();
 }
 assert.ok(await page.evaluate(()=>getFmpItem('original-parcel-box')));assert.deepEqual(errors,[]);console.log('PASS 3 parcel variants: mobile search/place, ground height, independent colors/gloss, serialization, original retained.');
} finally {await browser.close();}
