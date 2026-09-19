// Run with PLAYWRIGHT_MODULE pointing to an installed playwright module.
import assert from 'node:assert/strict';
// Playwright は CommonJS なので、名前付きで取れる環境と default 越しの環境がある。
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const browser=await chromium.launch({args:['--use-angle=metal']});
try {
  const page=await browser.newPage({viewport:{width:1000,height:650}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.APP_URL||process.env.TEST_URL||'http://localhost:8932/');
  await page.waitForFunction(()=>window.THREE);
  await page.evaluate(()=>init3D());
  await page.waitForFunction(()=>_skyPhotoCache.common);
  const result=await page.evaluate(()=>{
    const material=_skyMesh.material,texture=material.uniforms.cloudMap.value;
    const stable=[0,6,12,14,16,18,22,24].every(hour=>{
      LIGHT_SETTINGS.sunSim=true;LIGHT_SETTINGS.hour=hour;updatePhotographicSky();
      return material===_skyMesh.material&&texture===material.uniforms.cloudMap.value;
    });
    return {stable,width:texture.image.width,height:texture.image.height,
      repeated:texture.wrapS===THREE.RepeatWrapping&&texture.wrapT===THREE.RepeatWrapping};
  });
  assert.equal(result.stable,true);
  assert.equal(result.repeated,true);
  assert.equal(result.width,result.height);
  assert.ok(result.width<=1024);
  assert.deepEqual(errors,[]);
  console.log('Cloud layer: bounded square texture reused throughout 24 hours',result);
} finally {await browser.close();}
