import fs from 'node:fs';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const browser=await (pw.chromium||pw.default.chromium).launch({args:['--use-angle=metal']});
const dir='docs/quality-review/detail-loop/neighbor-detail-after';fs.mkdirSync(dir,{recursive:true});
try{
 const page=await browser.newPage();await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForFunction(()=>window.THREE&&getFmpItem('original-sofa'));await page.evaluate(()=>init3D());
 const result=await page.evaluate(async()=>{
  const g=await new Promise((resolve,reject)=>getGltfLoader().load(CONTEXT_HOUSE_KIT_GLB,resolve,undefined,reject));ModelQuality.prepare(g.scene,CONTEXT_HOUSE_KIT_GLB);_modelCache[CONTEXT_HOUSE_KIT_GLB]=g.scene;
  const results=[],shots={};
  for(const [w,d] of [[6.37,8.19],[8.19,6.37],[6.37,6.37],[3.64,8.19]]){
   const it=mkItem('neighbor-house',0,0,0,1);it.contextGhost=false;it.w=w*1000;it.d=d*1000;it.contextFloors=w>4?3:2;
   const L=neighborHouseLayout(it,w,d,getContextFloors(it),contextStoryHeightM());
   const grp=new THREE.Group();buildNeighborHouseKit(grp,it,w,d);grp.updateMatrixWorld(true);
   const base=getContextFloors(it)*contextStoryHeightM(),rw=w+NH_EAVE*2,rd=d+NH_EAVE*2;
   const roof=createHipRoofMesh(rw,rd,base,nhRoofHeightM(w,d),new THREE.MeshBasicMaterial());const pos=roof.geometry.attributes.position,norm=roof.geometry.attributes.normal;
   let roofOutward=true;for(let i=0;i<pos.count;i+=3){const top=Math.max(pos.getY(i),pos.getY(i+1),pos.getY(i+2))>base+.01;if(top&&norm.getY(i)<=0)roofOutward=false;}
   const r=getHipRoofRidgeSpec(rw,rd),rh=nhRoofHeightM(w,d);let maxGap=0;
   grp.traverse(o=>{if(o.name==='Neighbor roof folded ridge flashing'){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){const h=base+rh*Math.max(0,Math.min((rw/2-Math.abs(p.getX(i)))/(rw/2-(r.axis==='x'?r.half:0)),(rd/2-Math.abs(p.getZ(i)))/(rd/2-(r.axis==='z'?r.half:0))));maxGap=Math.max(maxGap,Math.abs(p.getY(i)-h));}}});
   let garageDepth=null;if(L.garage){const ray=new THREE.Raycaster(new THREE.Vector3(L.garage.x,1,-d/2-.5),new THREE.Vector3(0,0,1));const hits=ray.intersectObject(grp,true);garageDepth=hits[0]?.point.z+d/2;}
   const scene=new THREE.Scene();scene.background=new THREE.Color('#e5e7e8');scene.add(grp,new THREE.HemisphereLight(0xeaf4ff,0xa59883,2));const sun=new THREE.DirectionalLight(0xfff3df,3);sun.position.set(-6,10,-8);scene.add(sun);
   const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1100,850);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
   function shot(name,look,offset,extent){const c=new THREE.OrthographicCamera(-extent*1100/850,extent*1100/850,extent,-extent,.01,100);c.position.set(look[0]+offset[0],look[1]+offset[1],look[2]+offset[2]);c.lookAt(...look);renderer.render(scene,c);shots[name]=renderer.domElement.toDataURL();}
   shot(`${w}-${d}-front`,[0,base/2,0],[10,7,-13],Math.max(w,d,base)*.65);
   shot(`${w}-${d}-back`,[0,base/2,0],[-10,7,13],Math.max(w,d,base)*.65);
   if(w===6.37&&d===8.19){
    shot('ridge',[0,base+rh*.7,0],[7,5,-9],3.7);
    if(L.entry)shot('entry',[L.entry.x,2,-d/2],[2,1.6,-5],1.55);
    if(L.garage){shot('garage',[L.garage.x,1.2,-d/2],[.5,.2,-5],1.6);shot('garage-left',[L.garage.x,1.2,-d/2],[-2,.6,-5],1.6);shot('garage-right',[L.garage.x,1.2,-d/2],[2,.6,-5],1.6);}
    if(L.balcony)shot('balcony',[L.balcony.x,L.balcony.floor*contextStoryHeightM()+1,-d/2-.45],[2,1.7,-4],1.55);
   }
   finalizeContextGroup(grp,it,true);let calls=0;grp.traverse(o=>{if(o.isMesh)calls++;});results.push({w,d,roofOutward,maxGap,garageDepth,calls});renderer.dispose();
  }return {results,shots};
 });
 assert.ok(result.results.some(r=>r.garageDepth!==null));
 for(const r of result.results){assert.ok(r.roofOutward);assert.ok(r.maxGap<.015);if(r.garageDepth!==null)assert.ok(r.garageDepth>1.8,JSON.stringify(r));assert.ok(r.calls<=45);}
 for(const [name,data] of Object.entries(result.shots))fs.writeFileSync(`${dir}/${name}.png`,Buffer.from(data.split(',')[1],'base64'));
 fs.writeFileSync(`${dir}/checks.json`,JSON.stringify(result.results,null,2));console.log(result.results);
}finally{await browser.close();}
