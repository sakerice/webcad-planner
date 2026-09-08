process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-angle=metal']});
try{const p=await b.newPage({viewport:{width:1000,height:700}});const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.goto(process.env.APP_URL||'http://localhost:8932/');await p.waitForFunction(()=>window.THREE);await p.evaluate(()=>init3D());await p.waitForFunction(()=>_skyPhotoCache.common);
const altitudes=await p.evaluate(()=>['summer','equinox','winter'].map(s=>computeSunPosition(12,s,0).altitude*180/Math.PI));assert.ok(altitudes[0]>altitudes[1]&&altitudes[1]>altitudes[2]);assert.ok(await p.evaluate(()=>computeSunPosition(0,'equinox',0).y<0));
for(const season of ['summer','equinox','winter']){await p.evaluate(s=>{LIGHT_SETTINGS.season=s;queueSunHour(13);flushSunHour();const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.SphereGeometry(20,48,24),_skyMesh.material));const c=new THREE.PerspectiveCamera(75,1000/700,.1,100);c.lookAt(-10,5,0);ren.setSize(1000,700);ren.render(scene,c);ren.domElement.style.cssText='position:fixed;inset:0;z-index:99999';document.body.appendChild(ren.domElement);},season);await p.screenshot({path:`/tmp/hp-light-${season}.png`});}
await p.reload();await p.waitForFunction(()=>window.THREE);await p.evaluate(()=>{init3D();document.getElementById('light-panel').style.display='block';syncLightPanelUi();});await p.setViewportSize({width:390,height:844});await p.screenshot({path:'/tmp/hp-light-mobile.png'});
const checks=await p.evaluate(()=>{
 let rebuilds=0;const original=rebuild3D;rebuild3D=()=>{rebuilds++;};
 const lamp=new THREE.PointLight();lamp.userData.autoRoomScale=2;sc3.add(lamp);
 updateLightSetting('room',0.5);const intensity=lamp.intensity;sc3.remove(lamp);rebuild3D=original;
 applyLightPreset('night');const night={hour:LIGHT_SETTINGS.hour,blend:_skyMesh.material.uniforms.night.value};
 applyLightPreset('day');updateAtmosphere('haze',0.8);flushSunHour();
 return {rebuilds,intensity,night,haze:_skyMesh.material.uniforms.haze.value,environmentMode:_skyMesh.material.uniforms.environmentMode.value};
 });assert.equal(checks.rebuilds,0);assert.equal(checks.intensity,1);assert.equal(checks.night.hour,22);assert.equal(checks.night.blend,1);assert.equal(checks.haze,0.8);assert.equal(checks.environmentMode,0);
 await p.evaluate(()=>{document.getElementById('light-panel').scrollTop=1000;});await p.screenshot({path:'/tmp/hp-light-mobile-bottom.png'});
 console.log({altitudes,checks,errors});assert.deepEqual(errors,[]);
}finally{await b.close();}
