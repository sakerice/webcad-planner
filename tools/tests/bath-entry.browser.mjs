import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForFunction(()=>window.THREE&&getFmpItem('original-shoe-tall'));await page.evaluate(()=>init3D());
 const result=await page.evaluate(async()=>{
  const out=[];
  for(const kind of ['tall','counter','bridge']){
   const f=getFmpItem('original-shoe-'+kind);const loaded=await new Promise((r,j)=>getGltfLoader().load(f.model,r,undefined,j));ModelQuality.prepare(loaded.scene,f.model);_modelCache[f.model]=loaded.scene;
   placeItem(f.id,2000,2000);
   // Use the catalogue's actual identifier (the helper accepts both prefixed and bare IDs).
   if(!getFmpItem(ST.selected.type))throw Error('Unrecognized catalogue tool '+ST.selected.type);
   updateSelectedProp('showMirror',true);updateSelectedModelFinish('body','#556677');
   const saved=JSON.parse(serializeDataSnapshot()).items.find(i=>i.id===ST.selected.id);
   const scene=sc3;sc3=new THREE.Scene();buildItem3D(ST.selected);let mirrors=0;sc3.traverse(o=>{if(o.name==='Optional full length mirror')mirrors++;});sc3=scene;
   out.push({kind,mirror:saved.showMirror,color:saved.finishColors.body,mirrors,ui:selectedModelFinishesHtml(ST.selected).includes('shoe-mirror')});
   updateSelectedProp('showMirror',false);
  }
  for(const kind of ['swing','fold']){
   placeItem(openingDoorModelToolId('bath-clear-'+kind),3000,3000);const it=ST.selected;
   out.push({kind,type:it.type,finish:it.doorFinish,saved:JSON.parse(serializeDataSnapshot()).items.find(i=>i.id===it.id).doorFinish});
  }
  return out;
 });
 for(const row of result){if(row.mirrors!==undefined){assert.equal(row.mirrors,1);assert.equal(row.mirror,true);assert.equal(row.color,'#556677');assert.equal(row.ui,true);}else{assert.equal(row.type,'door-'+row.kind);assert.equal(row.finish,'bath-clear');assert.equal(row.saved,'bath-clear');}}
 const shots=await page.evaluate(async()=>{
  DATA.walls=[mkWall(0,0,4000,0,1,120,'#dddddd')];DATA.items=[];
  const frames=[];
  for(const kind of ['swing','fold'])for(const state of ['closed','open']){
   const it=mkItem('door-'+kind,1000,-50,0,1);it.doorFinish='bath-clear';it.doorOpenState=state;DATA.items=[it];
   sc3=new THREE.Scene();_doorAnims=[];buildWinFrames(1);
   let glass=0;sc3.traverse(o=>{if(o.name==='Clear glazing')glass++;});
   if(glass!==(kind==='fold'?2:1))throw Error('Missing transparent door leaves '+kind);
   if(!_doorAnims.length)throw Error('Missing door animation');
   const group=new THREE.Group();while(sc3.children.length)group.add(sc3.children[0]);
   const scene=new THREE.Scene();scene.background=new THREE.Color('#e6e9e7');scene.add(group,new THREE.HemisphereLight(0xffffff,0x777777,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,5);scene.add(light);
   const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3());group.position.sub(center);
   const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(512,512);const c=new THREE.PerspectiveCamera(36,1,.01,30);c.position.set(2,1,4);c.lookAt(0,0,0);r.render(scene,c);frames.push({name:kind+'-'+state,image:r.domElement.toDataURL()});r.dispose();
  }
  return frames;
 });
 fs.mkdirSync('docs/quality-review/detail-loop/entry-storage',{recursive:true});for(const shot of shots)fs.writeFileSync('docs/quality-review/detail-loop/entry-storage/bath-'+shot.name+'.png',Buffer.from(shot.image.split(',')[1],'base64'));
 assert.deepEqual(errors,[]);console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
