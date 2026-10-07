const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
test('the one explicitly registered seat asset still matches the measured source',()=>{
 const file=fs.readFileSync(require('node:path').join(__dirname,'../../assets/models/unity_exported/Sofa01.glb'));
 assert.equal(crypto.createHash('sha256').update(file).digest('hex'),'080358fb2baaab3a25aab9283f3e95bd1528c790da0b1896a4d55f24b13953e1');
});
test('legacy-normalized catalogue sofa has the same measured Draco mesh as the Unity variant',()=>{
 const path=require('node:path'),read=rel=>fs.readFileSync(path.join(__dirname,'../../'+rel));
 const unity=read('assets/models/unity_exported/Sofa01.glb'),catalogue=read('assets/models/furniture_mega/glb/Sofa01.glb');
 assert.equal(crypto.createHash('sha256').update(catalogue).digest('hex'),'4f5f86002e750a9d513dc704eeba5c3a544afff25732290fa4d2b5e8dd2f36ef');
 function geometry(b){const n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n));const p=j.meshes[0].primitives[0],v=j.bufferViews[p.extensions.KHR_draco_mesh_compression.bufferView];return {bytes:b.subarray(28+n+(v.byteOffset||0),28+n+(v.byteOffset||0)+v.byteLength),accessors:j.accessors,nodes:j.nodes};}
 assert.deepEqual(geometry(unity),geometry(catalogue));
});
