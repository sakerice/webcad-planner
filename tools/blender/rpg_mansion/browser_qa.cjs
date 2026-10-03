const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=path.join(__dirname,'evidence');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1160}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))errors.push(r.status()+' '+r.url());});
  const start=Date.now();await page.goto((process.env.APP_URL||'http://127.0.0.1:8946/')+'assets/models/packs/rpg-mansion/review.html');
  await page.waitForFunction(()=>window.RPG_REVIEW?.ready,{timeout:60000});
  const result=await page.evaluate(()=>JSON.parse(JSON.stringify(window.RPG_REVIEW)));
  assert.equal(result.results.length,14);assert.ok(result.results.every(x=>x.boundsCorrect&&x.uv));assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,'browser-front.png'),fullPage:true});
  await page.click('#rear');await page.screenshot({path:path.join(out,'browser-rear.png'),fullPage:true});
  const report={runtime:'Chromium software WebGL; standalone review, not editor integration',loadAndRenderMs:Date.now()-start,...result,errors};
  fs.writeFileSync(path.join(out,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({models:14,triangles:result.results.reduce((s,x)=>s+x.triangles,0),errors,loadAndRenderMs:report.loadAndRenderMs}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
