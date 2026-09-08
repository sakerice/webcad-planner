import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8932/');await page.waitForFunction(()=>window.THREE);await page.evaluate(()=>init3D());
 const images=await page.evaluate(()=>{
  const specs=[['door-default','door-swing'],['door-small','door-swing-s'],['window-slide','window'],['window-fix','window'],['window-door','window-door']];
  return specs.map(([id,type])=>{
   DATA.walls=[mkWall(0,0,4000,0,1,120,'#eee')];const it=mkItem(type,1500,-50,0,1);it.doorOpenState='closed';if(id==='window-fix')it.windowKind='fix';DATA.items=[it];sc3=new THREE.Scene();_doorAnims=[];buildWinFrames(1);
   const group=new THREE.Group();while(sc3.children.length)group.add(sc3.children[0]);const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3());group.position.sub(box.getCenter(new THREE.Vector3()));
   const scene=new THREE.Scene();scene.add(group,new THREE.HemisphereLight(0xf2f7ff,0x8b857c,2));const light=new THREE.DirectionalLight(0xfff8ed,3);light.position.set(-3,5,4);scene.add(light);
   const extent=Math.max(size.x,size.y);const camera=new THREE.OrthographicCamera(-extent*.67,extent*.67,extent*.67,-extent*.67,.01,50);camera.position.set(.6,.4,5);camera.lookAt(0,0,0);
   const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0,0);renderer.render(scene,camera);const image=renderer.domElement.toDataURL();renderer.dispose();return{id,image};
  });
 });
 for(const {id,image} of images)fs.writeFileSync('assets/models/previews-v2/standard-'+id+'-thumb.png',Buffer.from(image.split(',')[1],'base64'));
 console.log('Rendered',images.length,'standard opening previews');
}finally{await browser.close();}
