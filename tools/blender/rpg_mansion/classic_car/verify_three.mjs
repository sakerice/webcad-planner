// Actual app GLTFLoader + ModelQuality material test; no rendering or browser.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from '../../../../assets/vendor/three/examples/jsm/loaders/GLTFLoader.js';
const require=createRequire(import.meta.url);
const quality=require('../../../../assets/js/model-quality.js');
const ident='rpg-mansion-classic-sedan-01';
const root=new URL('../../../../',import.meta.url);
const model=new URL(`assets/models/packs/rpg-mansion/models/${ident}.glb`,root);
const bytes=fs.readFileSync(model);
const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const gltf=await new GLTFLoader().parseAsync(buffer,'');
gltf.scene.updateMatrixWorld(true);
const bounds=new Box3().setFromObject(gltf.scene);
const dimensions=bounds.getSize(new Vector3()).multiplyScalar(1000).toArray();
assert.ok(dimensions.every((n,i)=>Math.abs(n-[1750,1650,4600][i])<1));
assert.ok(Math.abs(bounds.min.y)<1e-6);
const before=[];
gltf.scene.traverse(mesh=>{
  if(!mesh.isMesh)return;
  assert.ok(mesh.geometry.attributes.uv);
  for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material])) {
    before.push({mesh,material,color:material.color.getHexString(),roughness:material.roughness,metalness:material.metalness,opacity:material.opacity});
  }
});
quality.applyFinishes(gltf.scene,{body:'#7a2430'},{body:.55},{});
let changed=0,untouched=0;
for(const row of before){
  const material=Array.isArray(row.mesh.material)?row.mesh.material.find(m=>m.name===row.material.name):row.mesh.material;
  if(row.material.userData.finishChannel==='body'){
    assert.equal(material.color.getHexString(),'7a2430');
    assert.equal(material.roughness,.55);
    assert.notEqual(material,row.material);
    assert.equal(row.material.color.getHexString(),row.color);
    changed++;
  }else{
    assert.equal(material,row.material);
    assert.equal(material.color.getHexString(),row.color);
    assert.equal(material.roughness,row.roughness);
    assert.equal(material.metalness,row.metalness);
    assert.equal(material.opacity,row.opacity);
    untouched++;
  }
}
assert.ok(changed>0&&untouched>0);
const report={status:'passed',method:'Node CLI using app vendored GLTFLoader and ModelQuality.applyFinishes',
  gltf_dimensions_mm_xyz:dimensions,loaded_mesh_primitives:before.length,
  body_materials_changed:changed,detail_materials_unchanged:untouched,
  clone_preserves_original_material:true,renderer:'none',browser_started:false,
  limitation:'No WebGL rendering or editor placement verification'};
fs.writeFileSync(new URL('three-checks.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
