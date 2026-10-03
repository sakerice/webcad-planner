const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');globalThis.crypto=globalThis.crypto||require('crypto').webcrypto;
const finish=require('../../assets/js/tailored-sofa-finish.js'),quality=require('../../assets/js/model-quality.js');
const bytes=fs.readFileSync(path.join(__dirname,'../../',finish.url)),buffer=()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()),binStart=20+bytes.readUInt32LE(12)+8;
const three=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../../assets/vendor/three/build/three.module.js')).toString('base64'));
const opt=(colors={})=>({type:finish.type,tailoredSofaColors:{version:1,colors}});
async function fixture(){
 const T=await three,scene=new T.Group(),types={5126:Float32Array,5123:Uint16Array,5125:Uint32Array},counts={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
 const normal=new T.Texture(),materials=json.materials.map((m,i)=>{const p=m.pbrMetallicRoughness,c=i===0?new T.MeshPhysicalMaterial():new T.MeshStandardMaterial();c.name=m.name;c.color.fromArray(p.baseColorFactor);c.roughness=p.roughnessFactor;c.metalness=p.metallicFactor;c.side=T.DoubleSide;if(i===0){c.normalMap=normal;c.normalScale.set(m.normalTexture.scale,-m.normalTexture.scale);c.sheen=1;c.sheenColor.setRGB(1,1,1);c.sheenRoughness=.5;}return c;});
 function attr(id){const a=json.accessors[id],v=json.bufferViews[a.bufferView],C=types[a.componentType],size=counts[a.type],start=binStart+v.byteOffset+(a.byteOffset||0),copy=bytes.subarray(start,start+a.count*size*C.BYTES_PER_ELEMENT);return new T.BufferAttribute(new C(Uint8Array.from(copy).buffer),size,!!a.normalized);}
 const nodes=json.nodes.map(n=>{const p=json.meshes[n.mesh].primitives[0],g=new T.BufferGeometry();for(const [key,id]of Object.entries(p.attributes))g.setAttribute({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv'}[key],attr(id));g.setIndex(attr(p.indices));const o=new T.Mesh(g,materials[p.material]);o.name=n.name.replace(/ /g,'_').replace(/\./g,'');if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);scene.add(o);return o;});
 await finish.register({scene,parser:{getDependency:async(_,i)=>nodes[i]}},await finish.inspect(buffer()));quality.prepare(scene,finish.url);assert.equal(finish.status(scene).ok,true);return {T,scene,nodes,materials,normal};
}
module.exports={fixture,finish,quality,buffer};
