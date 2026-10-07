'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p)));
const pack=read('assets/models/packs/rpg-mansion/manifest.json');
const prior=read('assets/models/packs/rpg-mansion-contract/v0.2.0/reviewed-manifest.json');
const prefix='rpg-mansion-kitchen-';
const expected={
 'base-cupboard-01':[600,650,850,'floor',0],
 'drawer-base-01':[450,650,850,'floor',0],
 'corner-base-01':[900,900,850,'floor',0],
 'wall-cupboard-01':[600,350,700,'wall',1400],
 'pan-rack-01':[800,180,550,'wall',1450]
};
const added=pack.items.slice(50);
function glb(item){
 const buffer=fs.readFileSync(path.join(ROOT,item.model));
 assert.equal(buffer.readUInt32LE(0),0x46546c67);assert.equal(buffer.readUInt32LE(4),2);assert.equal(buffer.readUInt32LE(8),buffer.length);
 const length=buffer.readUInt32LE(12),j=JSON.parse(buffer.subarray(20,20+length)),bin=buffer.subarray(28+length);
 const values=index=>{const a=j.accessors[index],v=j.bufferViews[a.bufferView],n={SCALAR:1,VEC2:2,VEC3:3}[a.type],bytes={5126:4,5125:4,5123:2}[a.componentType],method={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE'}[a.componentType];assert.ok(n&&bytes&&method);return Array.from({length:a.count},(_,row)=>Array.from({length:n},(_,col)=>bin[method]((v.byteOffset||0)+(a.byteOffset||0)+row*(v.byteStride||n*bytes)+col*bytes)));};
 const tris=[];for(const mesh of j.meshes)for(const p of mesh.primitives){const pos=values(p.attributes.POSITION),idx=values(p.indices).flat();for(let k=0;k<idx.length;k+=3)tris.push({points:idx.slice(k,k+3).map(i=>pos[i]),channel:j.materials[p.material].extras?.finishChannel});}
 return {buffer,j,values,tris};
}
test('five new shapes are additive; all original fifty definitions remain identical',()=>{
 assert.equal(prior.items.length,50);assert.equal(pack.items.length,55);assert.deepEqual(pack.items.slice(0,50),prior.items);
 assert.deepEqual(added.map(i=>i.id),Object.keys(expected).map(k=>prefix+k));
 for(const item of added){const e=expected[item.id.slice(prefix.length)];assert.deepEqual([item.w,item.d,item.h,item.placementHint,item.defaultElevation],e);assert.equal(item.front,'+Z');assert.equal(item.category,'キッチン');assert.match(item.placementNotes,/static|fixed decoration/i);}
 assert.deepEqual(pack.provenance.externalAssets,[]);
});
test('delivered new bytes have exact upright bottom-centred dimensions, sources and finish channels',()=>{
 for(const item of added){const {buffer,j,tris}=glb(item),points=tris.flatMap(t=>t.points),lo=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));
  assert.ok(j.nodes.every(n=>!n.matrix&&!n.translation&&!n.scale&&!n.rotation));assert.deepEqual([j.asset.extras.units,j.asset.extras.up,j.asset.extras.front,j.asset.extras.origin],['metres','+Y','+Z','bottom-centre']);
  for(const [axis,size] of [[0,item.w],[1,item.h],[2,item.d]])assert.ok(Math.abs((hi[axis]-lo[axis])*1000-size)<.001,item.id+' bounds');
  assert.ok(Math.abs(lo[1])<1e-7);assert.ok(Math.abs(lo[0]+hi[0])<1e-7);assert.ok(Math.abs(lo[2]+hi[2])<1e-7);
  assert.ok(buffer.length<250000);assert.ok(tris.length<=6000);assert.ok(!j.images?.length&&!j.textures?.length);
  assert.deepEqual([...new Set(j.materials.map(m=>m.extras?.finishChannel).filter(Boolean))].sort(),item.finishChannels.map(c=>c.key).sort());
  assert.ok(fs.readFileSync(path.join(ROOT,item.sourceBlend)).subarray(0,7).equals(Buffer.from('BLENDER')));
  const report=read(item.validation);assert.equal(report.glb_bytes,buffer.length);assert.equal(report.glb_sha256,crypto.createHash('sha256').update(buffer).digest('hex'));assert.equal(report.uv.degenerate_world,0);assert.equal(report.uv.degenerate_uv,0);
 }
});
test('three base shapes have genuine 850mm stone support planes, including the corner return notch',()=>{
 for(const item of added.filter(i=>i.placementHint==='floor')){const {tris}=glb(item),faces=tris.filter(t=>t.channel==='stone'&&t.points.every(p=>Math.abs(p[1]-.85)<1e-7));assert.ok(faces.length>=2);
  const area=faces.reduce((sum,{points:[a,b,c]})=>sum+Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2,0);
  // Physical 3mm edge bevel leaves an inset flat support plane. The return
  // notch keeps its 250mm width after equal inside/outside edge insets.
  const expectedArea=item.id.includes('corner')?(.9-.006)**2-.25*.25:(item.w/1000-.006)*(item.d/1000-.006);
  assert.ok(Math.abs(area-expectedArea)<.00005,item.id+' useful top plane');
  if(item.id.includes('corner'))for(const {points} of faces){const centre=points.reduce((v,p)=>v.map((x,k)=>x+p[k]/3),[0,0,0]);assert.ok(!(centre[0]<-.203&&centre[2]>.203),'corner must retain the real front-left void');}
  assert.equal(read(item.validation).support_height_mm,850);
 }
});
test('wall models require elevated wall installation and never advertise a floor/support default',()=>{
 for(const item of added.filter(i=>i.placementHint==='wall')){assert.ok(item.defaultElevation>=1400);assert.match(item.placementNotes,/Wall installation required/);assert.match(item.placementNotes,/manually/);assert.equal(read(item.validation).support_height_mm,null);}
});
test('existing mkItem creation actually applies each new elevation without changing floor or pose',()=>{
 const source=fs.readFileSync(path.join(ROOT,'assets/js/plan-data.js'),'utf8'),start=source.indexOf('function mkItem('),end=source.indexOf('// ───── PRESET DATA',start);assert.ok(start>=0&&end>start);
 const definitions=new Map(added.map(i=>[i.id,i]));
 const context=vm.createContext({nextId:1,ICOLORS:{},bestFmpType:type=>type,getItemDefaultSize:type=>definitions.get(type),getFmpItem:type=>definitions.get(type),isFmpItemType:type=>definitions.has(type),canSetItemElevation:()=>true,isContextExteriorItemType:()=>false,isWindowLikeType:()=>false,isDoorLikeOpeningType:()=>false,isLightItemType:()=>false});
 vm.runInContext(source.slice(start,end),context);
 for(const item of added){const made=context.mkItem(item.id,123,456,37,2);assert.equal(made.elev,item.defaultElevation);assert.equal(made.floor,2);assert.equal(made.rot,37);assert.equal(made.x,123);assert.equal(made.y,456);assert.equal(made.w,item.w);assert.equal(made.d,item.d);assert.equal(made.fmpId,item.id);assert.equal(made.wallId,undefined);}
});
test('manual kitchen additions create no replacement mappings or loss of functional native units',()=>{
 const map=read('assets/models/packs/rpg-mansion/conversion-map.json'),ids=new Set(added.map(i=>i.id));assert.equal(map.mappings.length,328);assert.ok(map.mappings.every(row=>!ids.has(row.targetId)));
 const {createConverter}=require('../../assets/js/asset-pack-conversion.js');const assets=new Map();for(const dir of ['furniture_mega','interior_model_0_26_1','custom'])for(const item of read('assets/models/'+dir+'/manifest.json').items)assets.set(item.id,item);
 const converter=createConverter(map,[...assets.values(),...pack.items]);
 const source={items:['original-kitchen-box-drawer450','original-kitchen-i2400','fmp-CabinetD01','fmp-CabinetD02','fmp-CabinetD03','fmp-CabinetD_Sink','fmp-GasStove07','fmp-Sink03'].map((type,i)=>({id:'functional-'+i,type,x:100*i,y:200,w:600,d:650,h:null,elev:i===6?797:0,floor:2,rot:37,dishwasher:true,kitchenSizeFamily:'retained',opaque:{keep:true}})),walls:[],rooms:[]};
 const before=JSON.stringify(source),result=converter.preview(source,{approvedIndexes:source.items.map((_,i)=>i)});assert.equal(result.changed,0);assert.equal(JSON.stringify(source),before);assert.deepEqual(result.plan,source);
});
