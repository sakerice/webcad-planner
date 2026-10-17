// Verify shipped material extras against the existing finish application function.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../../..');
const {applyFinishes}=require(path.join(root,'assets/js/model-quality.js'));
const ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'reports/asset-ledger.json')));
const results=[];
for(const item of ledger){
 const raw=fs.readFileSync(path.join(root,'assets/models/packs/rpg-mansion/models',item.id+'.glb'));
 const g=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)).toString());
 function mock(m){return {name:m.name,userData:{...m.extras},roughness:m.pbrMetallicRoughness.roughnessFactor,opacity:m.pbrMetallicRoughness.baseColorFactor?.[3]??1,color:{value:'initial',set(v){this.value=v;}},clone(){const n=mock(m);n.userData={...this.userData};return n;}};}
 const mats=g.materials.map(mock),mesh={isMesh:true,material:mats};
 applyFinishes({traverse(fn){fn(mesh);}},{paint:'#334455',metal:'#8899aa'},{paint:.6,metal:.35},{});
 for(let i=0;i<mats.length;i++){
  const m=mats[i],out=mesh.material[i],ch=m.userData.finishChannel;
  if(ch){assert.notEqual(out,m);assert.equal(out.color.value,ch==='paint'?'#334455':'#8899aa');assert.equal(out.roughness,ch==='paint'?.6:.35);}
  else{assert.equal(out,m);assert.equal(out.color.value,'initial');if(m.name==='Glass')assert.equal(out.opacity,.25);}
 }
 results.push({id:item.id,paintAndMetalChangeIndependently:true,glassAndStonePreserved:true,browserRuntimeTested:false,method:'Shipped GLB extras + existing applyFinishes function; CLI material stubs'});
}
fs.writeFileSync(path.join(__dirname,'reports/finish-validation.json'),JSON.stringify(results,null,2)+'\n');
console.log('PASS: all four shipped GLBs route paint/metal independently and preserve Glass/stone.');
