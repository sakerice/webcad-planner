import assert from 'node:assert/strict';
// Playwright は CommonJS なので、名前付きで取れる環境と default 越しの環境がある。
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const browser=await chromium.launch({args:['--use-angle=metal']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForSelector('#object-search-input',{state:'attached'});await page.evaluate(()=>{const m=document.getElementById('preset-choice-modal');if(m)m.classList.remove('show');});await page.locator('#bnav-tools').click();
 for(const name of ['薄型機能門柱','一体型機能門柱','二本脚型']) {
  await page.locator('#object-search-input').fill(name);const tile=page.locator('#object-search-results .catalogue-result');assert.equal(await tile.count(),1);await tile.click();
  await page.evaluate(()=>{ST.floor=1;placeItem(ST.tool,2000,2000);document.getElementById('props').classList.add('show','prop-expanded');});
  await page.locator('#finish-body').fill('#223344');await page.locator('#finish-panel').fill('#998877');await page.locator('#finish-roughness-panel').selectOption('0.48');
  const state=await page.evaluate(()=>({ground:item3DBaseY(ST.selected),siteSurface:SITE_SURFACE_Y,saved:JSON.parse(serializeDataSnapshot()).items.find(i=>i.id===ST.selected.id)}));// 敷地の面は Z ファイティングを避けるため GL より 12mm 下に描く(SITE_SURFACE_Y)。
  // 門柱はその面に接地するのが正しい。0 を期待していた頃の検査は、
  // 2026-08-16 に面を下げた変更のあと古くなっていた。
  assert.equal(state.ground,state.siteSurface);assert.ok(state.siteSurface>-0.05&&state.siteSurface<=0);assert.equal(state.saved.finishColors.body,'#223344');assert.equal(state.saved.finishColors.panel,'#998877');assert.equal(state.saved.finishRoughness.panel,.48);await page.locator('#mob-prop-close-btn').click();
 }
 assert.ok(await page.evaluate(()=>getFmpItem('original-parcel-box')));assert.deepEqual(errors,[]);console.log('PASS 3 parcel variants: mobile search/place, ground height, independent colors/gloss, serialization, original retained.');
} finally {await browser.close();}
