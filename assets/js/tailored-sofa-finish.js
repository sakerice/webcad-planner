/* Private audited native wiring; source/API access uses the narrow appearance profile. */
(function(root){
 'use strict';
 const TYPE='custom-sofa-tailored',URL='assets/models/refined/sofa_tailored_v1.glb';
 const SHA='d05b95294ee7f2d763b2ede6f2391548a96f3021ad897ab81ec712d79c9d5667';
 const NAMES=['Upholstered base','Padded arm','Oak leg','Oak leg.001','Padded arm.001','Oak leg.002','Oak leg.003','Back frame','Separate seat cushion','Soft back cushion','Seat seam','Separate seat cushion.001','Soft back cushion.001','Seat seam.001'];
 const MATERIALS=[0,0,1,1,0,1,1,0,0,0,2,0,0,2],MATERIAL_NAMES=['Woven upholstery','Oak legs','Upholstery seam'];
 const CHANNELS={seat:[8,11],body:[0,1,4,7,9,12]},proofs=new WeakMap(),records=new WeakMap(),rendered=new WeakMap(),renderProofs=new WeakMap();
 let published=null,auditRevision=0;
 const unavailable='未監査のモデル構成です。部位の色指定は適用せず、従来の表示を保ちます。';
 function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);if(proto===null)return true;
  const ctor=Object.getOwnPropertyDescriptor(proto,'constructor')?.value;
  return Object.getPrototypeOf(proto)===null&&typeof ctor==='function'&&ctor.prototype===proto&&Function.prototype.toString.call(ctor)===Function.prototype.toString.call(Object);
 }
 function colors(item){
  const v=item&&item.type===TYPE&&item.tailoredSofaColors;
  if(!record(v))return null;
  const config=Object.getOwnPropertyDescriptors(v);
  if(config.version?.value!==1||Reflect.ownKeys(config).some(k=>k!=='version'&&k!=='colors')||!record(config.colors?.value))return null;
  const fields=Object.getOwnPropertyDescriptors(config.colors.value),out={};
  for(const key of Reflect.ownKeys(fields)){
   const value=fields[key].value;
   if(!Object.hasOwn(CHANNELS,key)||typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))return null;
   out[key]=value;
  }
  return out;
 }
 function active(item){const c=colors(item);return !!c&&Object.keys(c).length>0;}
 async function inspect(buffer){
  try{
   const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   if(!root.crypto?.subtle)return {ok:false,reason:'digest-unavailable'};
   const digest=Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==SHA)return {ok:false,reason:'asset-hash',sha256:digest};
   if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length||view.getUint32(16,true)!==0x4e4f534a)return {ok:false,reason:'glb-header'};
   const json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))));
   if(json.nodes?.length!==14||json.meshes?.length!==14||json.materials?.length!==3||json.scenes?.[json.scene||0]?.nodes?.join(',')!=='0,1,2,3,4,5,6,7,8,9,10,11,12,13')return {ok:false,reason:'node-config'};
   for(let i=0;i<14;i++){
    const n=json.nodes[i],p=json.meshes[i]?.primitives;
    if(n.name!==NAMES[i]||n.mesh!==i||n.children?.length||p?.length!==1||p[0].material!==MATERIALS[i]||Object.keys(p[0].attributes||{}).sort().join(',')!=='NORMAL,POSITION,TEXCOORD_0')return {ok:false,reason:'primitive-config'};
   }
   if(json.materials.some((m,i)=>m.name!==MATERIAL_NAMES[i]||m.extras?.finishChannel))return {ok:false,reason:'material-config'};
   const binaryStart=20+view.getUint32(12,true)+8;
   function accessor(id){const a=json.accessors[id],v=json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],width={5126:4,5123:2,5125:4}[a.componentType],start=binaryStart+(v.byteOffset||0)+(a.byteOffset||0);return [size,!!a.normalized,a.count,bytesHash(bytes.subarray(start,start+a.count*size*width))];}
   const shapes=json.nodes.map(n=>{const p=json.meshes[n.mesh].primitives[0],idx=accessor(p.indices);return JSON.stringify({name:n.name.replace(/ /g,'_').replace(/\./g,''),position:n.translation||[0,0,0],quaternion:n.rotation||[0,0,0,1],scale:n.scale||[1,1,1],children:0,groups:[],drawRange:{start:0,count:'Infinity'},attributes:Object.entries(p.attributes).map(([key,id])=>[{POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv'}[key],...accessor(id)]).sort((a,b)=>a[0].localeCompare(b[0])),index:[idx[2],idx[3]]});});
   const proof={};proofs.set(proof,{shapes,materials:json.materials});return {ok:true,sha256:digest,proof};
  }catch(_){return {ok:false,reason:'asset-inspection'};}
 }
 function pathTo(scene,node){let found=null;function walk(o,path){if(o===node)found=path;else(o.children||[]).forEach((c,i)=>walk(c,path.concat(i)));}walk(scene,[]);return found;}
 function at(scene,path){return path.reduce((o,i)=>o?.children?.[i],scene);}
 function bytesHash(array){let h=2166136261;const b=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);for(const v of b)h=Math.imul(h^v,16777619);return (h>>>0).toString(16);}
 function shape(node){
  const g=node.geometry;
  return JSON.stringify({name:node.name,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray(),children:node.children.length,groups:g.groups,drawRange:{start:g.drawRange.start,count:String(g.drawRange.count)},attributes:Object.entries(g.attributes).sort().map(([k,a])=>[k,a.itemSize,a.normalized,a.count,bytesHash(a.array)]),index:g.index&&[g.index.count,bytesHash(g.index.array)]});
 }
 function surface(m){
  return JSON.stringify({color:m.color?.toArray(),roughness:m.roughness,metalness:m.metalness,side:m.side,opacity:m.opacity,transparent:m.transparent,normalScale:m.normalScale?.toArray(),sheen:m.sheen,sheenColor:m.sheenColor?.toArray(),sheenRoughness:m.sheenRoughness,maps:['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>m[k]?.uuid||null)});
 }
 function valid(scene,record){
  if(!record?.ok)return false;
  let count=0;scene.traverse(o=>{if(o.isMesh)count++;});if(count!==14)return false;
  return record.nodes.every((n,i)=>{const o=at(scene,n.path);return o?.isMesh&&!Array.isArray(o.material)&&o.material?.name===MATERIAL_NAMES[MATERIALS[i]]&&!o.material.userData?.finishChannel&&shape(o)===n.shape&&surface(o.material)===n.surface;});
 }
 async function register(gltf,inspection){
  if(!inspection?.ok||!proofs.has(inspection.proof)){records.set(gltf.scene,{ok:false,reason:inspection?.reason||'unverified'});return;}
  try{
   const nodes=await Promise.all(NAMES.map((_,i)=>gltf.parser.getDependency('node',i)));
   const inspected=proofs.get(inspection.proof);
   if(gltf.scene.children.length!==14||nodes.some((n,i)=>gltf.scene.children[i]!==n)||!nativeRoot(gltf.scene))throw Error('native root hierarchy');
   for(let i=0;i<14;i++){
    const m=nodes[i].material,p=inspected.materials[MATERIALS[i]],base=p.pbrMetallicRoughness;
    if(shape(nodes[i])!==inspected.shapes[i]||Array.isArray(m)||m.name!==p.name||JSON.stringify(m.color.toArray())!==JSON.stringify(base.baseColorFactor.slice(0,3))||m.roughness!==base.roughnessFactor||m.metalness!==base.metallicFactor||m.side!==2||m.opacity!==1||m.transparent||!!m.normalMap!==!!p.normalTexture||m.map||m.roughnessMap||m.metalnessMap||m.aoMap)throw Error('parsed asset differs from inspected bytes');
    if(MATERIALS[i]===0&&(m.normalScale.x!==p.normalTexture.scale||m.normalScale.y!==-p.normalTexture.scale||m.sheen!==1||m.sheenRoughness!==.5||m.sheenColor.getHexString()!=='ffffff'))throw Error('native upholstery surface');
   }
   const record={ok:true,nodes:nodes.map(node=>({path:pathTo(gltf.scene,node),shape:shape(node),surface:surface(node.material)}))};
   if(record.nodes.some(n=>!n.path)||!valid(gltf.scene,record))throw Error('runtime node configuration');
   records.set(gltf.scene,record);
  }catch(_){records.set(gltf.scene,{ok:false,reason:'runtime-config'});}
 }
 function transfer(source,copy){const r=records.get(source);records.set(copy,valid(source,r)&&valid(copy,r)?r:{ok:false,reason:'clone-config'});}
 function status(scene){const r=records.get(scene),ok=valid(scene,r);return {ok,reason:ok?null:r?.reason||(r?'runtime-config':'not-loaded'),message:ok?null:unavailable};}
 function nativeRoot(scene){return scene?.position?.toArray().join(',')==='0,0,0'&&scene?.quaternion?.toArray().join(',')==='0,0,0,1'&&scene?.scale?.toArray().join(',')==='1,1,1';}
 function publish(scene){
  const ok=status(scene).ok&&nativeRoot(scene);
  if(ok){if(!published||!status(published).ok)auditRevision++;published=scene;}
  else {published=null;auditRevision++;}
  return capability();
 }
 function capability(){
  const ok=!!published&&status(published).ok&&nativeRoot(published);
  if(!ok)return {available:false,assetSha256:SHA,auditRevision,reason:'native-loader-not-verified',frontAudit:null};
  const r=records.get(published),back=at(published,r.nodes[7].path),seats=[8,11].map(i=>at(published,r.nodes[i].path));
  const front=published.userData?.facingNormalized===true&&published.rotation.x===0&&published.rotation.y===0&&published.rotation.z===0&&back.position.z<0&&seats.every(o=>o.position.z>0);
  return {available:true,assetSha256:SHA,auditRevision,frontAudit:front?{axis:'+Z',assetSha256:SHA,version:1,sourceYaw:0,modelFacingVersion:1,basis:'exact-GLB-back-frame-negative-Z-seat-positive-Z-and-native-zero-yaw'}:null};
 }
 function verifyRendered(item,roots){
  const c=colors(item),cap=capability();if(!c||!cap.available)return {ok:false,reason:'native-profile-unavailable'};
  let found=null;(roots||[]).forEach(root=>root.traverse(o=>{const proof=rendered.get(o);if(proof&&JSON.stringify(proof.colors)===JSON.stringify(c)&&status(proof.template).ok)found={instance:o,record:proof.record};}));
  if(!found)return {ok:false,reason:'native-profile-not-rendered'};
  const r=found.record,instance=found.instance;
  for(let i=0;i<14;i++){
   const node=at(instance,r.nodes[i].path),key=Object.keys(c).find(k=>CHANNELS[k].includes(i));
   if(!node||shape(node)!==r.nodes[i].shape)return {ok:false,reason:'render-geometry'};
   if(!key){if(surface(node.material)!==r.nodes[i].surface)return {ok:false,reason:'fixed-surface'};}
   else{const current=JSON.parse(surface(node.material)),native=JSON.parse(r.nodes[i].surface);delete current.color;delete native.color;if(JSON.stringify(current)!==JSON.stringify(native)||node.material.color.getHexString()!==c[key].slice(1).toLowerCase())return {ok:false,reason:'render-color-or-surface'};}
  }
  const proof={};renderProofs.set(proof,{colors:JSON.stringify(c),auditRevision:cap.auditRevision,instance:found.instance,parent:found.instance.parent});
  return {ok:true,proof,assetSha256:SHA,auditRevision:cap.auditRevision,channels:Object.keys(c),geometryUnchanged:true,fixedLegsAndSeams:true};
 }
 function acceptsRenderProof(proof,c){const p=renderProofs.get(proof),cap=capability();return !!p&&cap.available&&p.auditRevision===cap.auditRevision&&p.colors===JSON.stringify(c)&&p.instance.parent===p.parent&&verifyRendered({type:TYPE,tailoredSofaColors:{version:1,colors:c}},[p.instance]).ok;}
 function apply(instance,template,item,quality){
  rendered.delete(instance);
  const c=colors(item);if(!c||!Object.keys(c).length)return {applied:false,reason:c?'native':'not-opted-in'};
  const r=records.get(template);if(!valid(template,r)||!valid(instance,r))return {applied:false,reason:'unreviewed',message:unavailable};
  const assignments=[],mapped={};
  try{
   for(const [key,value] of Object.entries(c)){
    const channel='tailored-sofa-v1-'+key;mapped[channel]=value;
    for(const i of CHANNELS[key]){const node=at(instance,r.nodes[i].path),before=node.material,tagged=before.clone();tagged.userData={...tagged.userData,finishChannel:channel};assignments.push({node,before,tagged});node.material=tagged;}
   }
   // Existing finishing code owns each final clone. No texture/roughness input.
   quality.applyFinishes(instance,mapped);
   rendered.set(instance,{colors:c,template,record:r});
   return {applied:true,channels:Object.keys(c)};
  }catch(_){
   for(const a of assignments){if(a.node.material!==a.tagged&&a.node.material!==a.before)a.node.material.dispose();a.node.material=a.before;}
   return {applied:false,reason:'unreviewed',message:unavailable};
  }finally{for(const a of assignments)a.tagged.dispose();}
 }
 const api=Object.freeze({type:TYPE,url:URL,sha256:SHA,version:1,colors,active,inspect,register,transfer,status,publish,capability,verifyRendered,acceptsRenderProof,apply});
 if(typeof module!=='undefined')module.exports=api;
 root.TailoredSofaFinish=api;
})(typeof globalThis!=='undefined'?globalThis:this);
