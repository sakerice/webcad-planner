const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const G=require('../../assets/js/room-geometry.js');
const {topLevelFunction:fn,makeCtx}=require('./height-runtime.cjs');
const three=import('../../assets/vendor/three/build/three.module.js');
function room(){return {id:'logical-living',type:'room',floor:1,n:'Living / hall',x:0,y:0,w:4000,d:4000,floorRaiseMm:150,shape:G.normalize({kind:'rectUnion',rectangles:[{x:0,y:0,w:4000,d:2000},{x:0,y:2000,w:2000,d:2000}]})};}
function run(c,names){vm.createContext(c);vm.runInContext(names.map(fn).join('\n'),c);return c;}
test('connected overlapping/touching rectangles normalize to one six-edge logical L',()=>{
 const r=room();assert.equal(r.shape.outer.length,6);assert.equal(G.area(r),12000000);assert.equal(G.contains(r,3000,3000),false);assert.equal(G.contains(r,1000,3000),true);assert.equal(G.contains(r,3000,1000),true);
 assert.equal(G.cells(r).reduce((a,c)=>a+c.w*c.d,0),G.area(r));assert.ok(G.contains(r,G.labelAnchor(r)));assert.notDeepEqual(G.labelAnchor(r),{x:2000,y:2000});
 assert.deepEqual(G.normalize({kind:'orthogonalPolygon',outer:[...r.shape.outer].reverse()}),r.shape);
});
test('bounded geometry rejects diagonal, self intersection, backtrack, holes and disconnected/point contacts',()=>{
 for(const rectangles of [
  [{x:0,y:0,w:1,d:1},{x:2,y:0,w:1,d:1}],
  [{x:0,y:0,w:1,d:1},{x:1,y:1,w:1,d:1}],
  [{x:0,y:0,w:4,d:1},{x:0,y:3,w:4,d:1},{x:0,y:1,w:1,d:2},{x:3,y:1,w:1,d:2}],
  [{x:Infinity,y:0,w:1,d:1}], [{x:0,y:0,w:1000001,d:1}], [{x:0,y:0,w:0,d:1}]
 ])assert.throws(()=>G.normalize({kind:'rectUnion',rectangles}));
 for(const outer of [
  [{x:0,y:0},{x:2,y:0},{x:1,y:1},{x:0,y:1}],
  [{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:1,y:3},{x:1,y:-1},{x:2,y:-1},{x:2,y:2},{x:0,y:2}],
  [{x:0,y:0},{x:3,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]
 ])assert.throws(()=>G.normalize({kind:'orthogonalPolygon',outer}));
 assert.throws(()=>G.normalize({...room().shape,holes:[]}));
});
test('rectangle fallback and cached AABB cannot substitute for occupied geometry',()=>{
 const r=room();r.w=99999;r.d=99999;assert.deepEqual(G.bounds(r),{x:0,y:0,w:4000,d:4000});assert.equal(G.contains(r,5000,5000),false);
 assert.equal(G.area({x:10,y:20,w:30,d:40}),1200);assert.deepEqual(G.labelAnchor({x:10,y:20,w:30,d:40}),{x:25,y:40});
});
test('translation and bounded resizing preserve identity, concavity and shape metadata',()=>{
 const r=room(),original=JSON.parse(JSON.stringify(r));r.shape.boundaryBasis='clear-face';G.translate(r,100,200);assert.equal(r.id,original.id);assert.equal(r.shape.boundaryBasis,'clear-face');assert.equal(G.contains(r,3100,3200),false);assert.equal(G.contains(r,1100,3200),true);
 G.setBounds(r,{w:8000,d:8000});assert.equal(G.area(r),48000000);assert.equal(G.contains(r,6100,6200),false);
 G.translate(r,50,60,original);assert.equal(r.x,50);assert.equal(r.y,60);assert.equal(G.area(r),12000000);
 assert.throws(()=>G.setBounds(r,{w:-1}));
});
test('height lookup and above-room overlap exclude missing quadrant',()=>{
 const r=room(),c=makeCtx({rooms:[r],walls:[],items:[]});c.RoomGeometry=G;vm.runInContext(fn('roomFloorAt'),c);
 assert.equal(c.roomAtPointOnFloor(1,3000,3000),null);assert.equal(c.roomAtPointOnFloor(1,1000,3000),r);
 assert.equal(c.roomFloorAt(1,1000,3000),c.roomFloorAt(1,3000,1000));
 assert.equal(c.roomFloorAt(1,1000,3000)-c.roomFloorAt(1,3000,3000),.15);
 assert.equal(c.roomsOverlapInPlan(r,{x:2500,y:2500,w:1000,d:1000,floor:2}),false);
 assert.equal(c.roomsOverlapInPlan(r,{x:500,y:2500,w:1000,d:1000,floor:2}),true);
});
async function surfaceCtx(){const THREE=await three;return run({THREE,RoomGeometry:G,U:.001,PV_INTERIOR_DAYLIGHT:false,isInt:false,usesFinishedHeightModel:()=>true,makeFloorSlabMaterial:m=>m,roomCeilingWorldYAtMm:(r,p,x,y)=>2+y/r.d,CEILING_SAMPLE_STEP_M:.3},['buildRoomFloorMeshes','buildRoomCeilingMesh','buildRoomCeilingShapeGeometry','buildSlopedCeilingGeometry','clipPolyToRect','polyAreaAbs']);}
function rayHits(THREE,mesh,x,z){mesh.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh,true);}
test('actual THREE floor and ceiling meshes cover both arms but never missing quadrant',async()=>{
 const c=await surfaceCtx(),THREE=c.THREE,r=room(),mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const f=c.buildRoomFloorMeshes(r,mat,.15,0,.15,[]),ceiling=c.buildRoomCeilingMesh(r,2.7,mat,[],null);
 for(const mesh of [f.slab,f.slabBody,ceiling]){
  assert.ok(rayHits(THREE,mesh,1,3).length);assert.ok(rayHits(THREE,mesh,3,1).length);assert.equal(rayHits(THREE,mesh,3,3).length,0);
 }
 assert.ok(Math.abs(rayHits(THREE,f.slab,1,3)[0].point.y-.154)<1e-6);assert.equal(rayHits(THREE,ceiling,1,3)[0].point.y,2.7);
 assert.equal(r.id,'logical-living');assert.equal(r.shape.outer.length,6);
});
test('sloped ceiling height uses original logical room rather than each tessellation cell',async()=>{
 const c=await surfaceCtx(),T=c.THREE,mat=new T.MeshBasicMaterial({side:T.DoubleSide});const ceiling=c.buildRoomCeilingMesh(room(),3,mat,[],{source:'declared'});
 for(const [x,z] of [[1,1],[1,3],[3,1]])assert.ok(Math.abs(rayHits(T,ceiling,x,z)[0].point.y-(2+z/4))<1e-5);
 assert.equal(rayHits(T,ceiling,3,3).length,0);
});
test('direct THREE ceiling outline triangulates exact occupied area',async()=>{
 const c=await surfaceCtx(),g=c.buildRoomCeilingShapeGeometry(room(),[]),p=g.attributes.position,idx=g.index;let area=0;
 for(let i=0;i<idx.count;i+=3){let a=idx.getX(i),b=idx.getX(i+1),d=idx.getX(i+2);area+=Math.abs((p.getX(b)-p.getX(a))*(p.getZ(d)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getX(d)-p.getX(a)))/2;}
 assert.equal(area,12);
});
test('runtime hit testing consults polygon before rectangular item pose',()=>{
 const c=run({RoomGeometry:G},['isInsideItem']);assert.equal(c.isInsideItem(room(),3000,3000),false);assert.equal(c.isInsideItem(room(),1000,3000),true);
});
test('2D move gesture translates outline from immutable drag start',()=>{
 const r=room(),base=JSON.parse(JSON.stringify(r));const c=run({RoomGeometry:G,ST:{selected:r,zoom:1},DRAG:{handle:'move',origItem:base,startCX:0,startCY:0,saved:true,active:true},isObjectLocked:()=>false,isMobileLayout:()=>false,snapRectOriginToGrid:(x,y)=>({x,y}),isShiftLike:()=>false,isStairPartType:()=>false},['applyHandleDrag']);
 c.applyHandleDrag(10,20,{});assert.equal(r.x,200);assert.equal(r.y,400);assert.equal(G.contains(r,3200,3400),false);
 c.applyHandleDrag(20,30,{});assert.equal(r.x,400);assert.equal(r.y,600);assert.equal(r.shape.outer[0].x,400);assert.equal(r.shape.outer[0].y,600);
});
test('snapshot save/load and actual undo restore the entire single-room shape',()=>{
 const r=room(),noop=()=>{},c=run({DATA:{rooms:[r],walls:[],items:[]},ST:{},DRAG:{},document:{getElementById:()=>null},ren:null,syncNorthFromPlan:noop,ensureFloorMetadata:noop,clearMultiSelection:noop,sharedForceFullSync:noop,markDirty:noop,draw2d:noop},['serializeDataSnapshot','restoreHistorySnapshot']);
 const saved=c.serializeDataSnapshot();G.translate(r,500,500);c.restoreHistorySnapshot(saved);assert.deepEqual(JSON.parse(c.serializeDataSnapshot()),JSON.parse(saved));assert.equal(c.DATA.rooms.length,1);assert.equal(G.contains(c.DATA.rooms[0],3000,3000),false);
});
test('shared delta includes whole polygon after movement and receiver preserves one identity',()=>{
 const noop=()=>{},r=room();const c=run({DATA:{rooms:[r],walls:[],items:[]},ST:{selected:null},SHARED:{dirtyIds:{walls:{},items:{},rooms:{}},forceScan:true},SHARED_FIELDS:[],sharedFastSignature:JSON.stringify,sharedClone:x=>JSON.parse(JSON.stringify(x)),sharedCollectionNameFor:()=>null,document:{getElementById:()=>({classList:{remove:noop}})},syncNorthFromPlan:noop,ensureObjectIds:noop,ensureExteriorWallSettings:noop,ensureInteriorWallSettings:noop,ensureRoofAppearance:noop,ensureFloorMetadata:noop,ensureHeightDefaults:noop,syncHeightDefaultsUI:noop,syncExteriorWallSettings:noop,normalizeLegacyFurnitureItems:noop,clearMultiSelection:noop,clearEditHistory:noop,draw2d:noop,sharedSchedule3DRefresh:noop,markDirtyUiOnly:noop},['sharedBaselineFrom','buildSharedPatch','applySharedPatch']);
 const baseline=c.sharedBaselineFrom(c.DATA);G.translate(r,250,750);const patch=c.buildSharedPatch(c.DATA,baseline);assert.equal(patch.collections.rooms.upserts.length,1);assert.equal(patch.collections.rooms.upserts[0].shape.outer.length,6);
 c.DATA={rooms:[room()],walls:[],items:[]};c.applySharedPatch(patch,false);assert.equal(c.DATA.rooms.length,1);assert.equal(c.DATA.rooms[0].id,r.id);assert.equal(G.contains(c.DATA.rooms[0],3250,3750),false);assert.equal(c.DATA.rooms[0].x,250);
});
test('plan file/server schema validates bounded room shapes and preserves normalized save/load',()=>{
 const schema=require('../../assets/js/plan-schema.js'),p={rooms:[room()],walls:[],items:[]};assert.deepEqual(schema.validatePlan(p).errors,[]);
 const loaded=schema.normalizePlan(JSON.parse(JSON.stringify(p)));assert.equal(loaded.rooms.length,1);assert.deepEqual(loaded.rooms[0].shape,p.rooms[0].shape);
 p.rooms[0].shape.outer[0].x=Infinity;assert.ok(schema.validatePlan(p).errors.some(e=>/shape/.test(e)));
 p.rooms=[room()];p.rooms[0].w=5000;assert.ok(schema.validatePlan(p).errors.some(e=>/bounds/.test(e)));
});
test('floor UVs preserve one source-origin tile grid across cell seams',async()=>{
 const c=await surfaceCtx(),T=c.THREE,r=room(),group=c.buildRoomFloorMeshes(r,new T.MeshBasicMaterial(),0,0,0,[]).slab;
 group.updateMatrixWorld(true);group.traverse(mesh=>{if(!mesh.geometry)return;const p=mesh.geometry.attributes.position,u=mesh.geometry.attributes.uv,v=new T.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);assert.ok(Math.abs(u.getX(i)-v.x/4)<1e-6);assert.ok(Math.abs(u.getY(i)-(1-v.z/4))<1e-6);}});
});
test('known 300 mm floor module controls material repeat with rectangular fallback unchanged',async()=>{
 const T=await three,c=run({THREE:T,U:.001,FLOOR_PBR_STEM:{tile_floor:'tile'},roomFloorMaterialKey:()=> 'tile_floor',texTileM:()=>.9,pbrTex:()=>({}),pbrTexLinear:()=>({}),cloneTextureWithRepeat:(t,x,y)=>({repeat:{x,y}})},['makeRoomFloorMaterial']);
 const m=c.makeRoomFloorMaterial({w:1800,d:1200,floorModuleMm:300});assert.equal(m.map.repeat.x,6);assert.equal(m.map.repeat.y,4);
 const old=c.makeRoomFloorMaterial({w:1800,d:1200});assert.equal(old.map.repeat.x,2);assert.equal(old.map.repeat.y,1200/900);
});
test('logical L has one label at an occupied anchor and reports true area',()=>{
 const r=room(),labels=[],c=run({RoomGeometry:G,DATA:{rooms:[r],items:[]},ST:{floor:1,selected:r},drawSkipLevelEdges2d:()=>{},drawCeilingLabel2d:()=>{},planCaptureShows:()=>true,drawAreaTag:(...args)=>labels.push(args)},['drawRoomLbls']);c.drawRoomLbls();
 assert.equal(labels.length,1);assert.equal(labels[0][4],r.n);assert.equal(labels[0][6],12000000);assert.ok(G.contains(r,labels[0][0],labels[0][1]));
});
test('2D room fill path follows only the six perimeter edges, without tessellation seams',()=>{
 const points=[],ctx={beginPath:()=>{},moveTo:(x,y)=>points.push([x,y]),lineTo:(x,y)=>points.push([x,y]),closePath:()=>{}};G.trace(ctx,room());assert.equal(points.length,6);assert.deepEqual(points,room().shape.outer.map(p=>[p.x,p.y]));
});
function narrowRoom(){const r=room();r.shape=G.normalize({kind:'rectUnion',rectangles:[{x:0,y:0,w:4000,d:600},{x:0,y:600,w:600,d:3400}]});return r;}
test('actual ceiling cover gate sees a fully covered narrow L with no occupied AABB probes',()=>{
 const r=narrowRoom(),upper={...r,floor:2,id:'upper'},c=run({RoomGeometry:G,DATA:{rooms:[r,upper],items:[]},isInsideItem:()=>false},['roomHasCoverAbove']);
 assert.equal(c.roomHasCoverAbove(r),true);
 upper.shape=undefined;Object.assign(upper,{x:1000,y:1000,w:2000,d:2000});assert.equal(c.roomHasCoverAbove(r),false);
 c.DATA.rooms=[r];c.DATA.items=[{type:'roof',floor:2}];c.isInsideItem=(roof,x,y)=>x<600&&y>600;assert.equal(c.roomHasCoverAbove(r),true);
});
test('actual wall foot and skip ceiling cap ignore tall walls in missing quadrant',()=>{
 const r=room();r.floor=2;r.floorRaiseMm=0;
 const lower={id:'lower',floor:1,x1:3000,y1:2500,x2:3000,y2:3500,wallHeight:4000,thick:120};
 const c=makeCtx({heightDefaults:{modelVersion:2,wallHeight:2400,floorThickness:180},rooms:[r],items:[],walls:[lower]});
 Object.assign(c,{RoomGeometry:G,floorHasSkipLevel:()=>false,wallSkipFootMm:()=>0});vm.runInContext(fn('wallBaseSupportY'),c);
 const w={floor:2,x1:500,y1:3000,x2:1500,y2:3000,thick:120};
 assert.equal(c.wallBaseSupportY(w),c.floorBaseY(2));assert.ok(c.roomFloorTopY(r)>c.wallBaseSupportY(w));
 const lowRoom={...room(),skipLevelMm:600};c.DATA.rooms=[lowRoom];assert.equal(c.roomCeilingCapM(lowRoom),c.storyHeightM(1));
 // Positive control: an actual occupied-arm support still raises the wall and cap.
 lower.x1=1000;lower.x2=1000;assert.ok(c.roomCeilingCapM(lowRoom)>c.storyHeightM(1));
 c.DATA.rooms=[r];assert.ok(c.wallBaseSupportY(w)>c.floorBaseY(2));
});
test('actual skip-deck meshes all select original logical room and retain source UV grid',async()=>{
 const T=await three,r=room(),sc3=new T.Scene(),c=run({RoomGeometry:G,THREE:T,U:.001,sc3,makeFloorSlabMaterial:m=>m},['buildSkipDeckMeshes','subtractRectsFromRect','mark3DSelectable']);
 c.buildSkipDeckMeshes(r,new T.MeshBasicMaterial(),.18,.8,.98,[]);assert.equal(sc3.children.length,6);
 sc3.children.forEach(mesh=>assert.equal(mesh.userData.selectRef,r));
 sc3.updateMatrixWorld(true);sc3.children.filter(m=>m.geometry.type==='PlaneGeometry').forEach(mesh=>{const p=mesh.geometry.attributes.position,u=mesh.geometry.attributes.uv,v=new T.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);assert.ok(Math.abs(u.getX(i)-v.x/4)<1e-6);assert.ok(Math.abs(u.getY(i)-(1-v.z/4))<1e-6);}});
 // Selection edits and serialization therefore operate on DATA's one room.
 const selected=sc3.children[0].userData.selectRef;G.translate(selected,100,200);assert.equal(r.x,100);assert.equal(r.y,200);
});
test('actual roof collection sees narrow occupied arms rather than AABB sample misses',()=>{
 const r=narrowRoom(),roof={type:'roof',id:'arm',floor:2},c=run({RoomGeometry:G,DATA:{rooms:[r],items:[roof]},roomHasRoomAbove:()=>false,floorTopY:()=>0,roofCoversPlanPoint:(it,x,y)=>x<600&&y>1500,roofCeilingWorldYAt:()=>2.7},['roofItemOverRoom','roofsOverRoom']);
 assert.equal(c.roofItemOverRoom(r),roof);assert.equal(c.roofsOverRoom(r)[0],roof);
});
test('buildRooms3D emits ceiling and occupied-arm lights for the narrow L regression',async()=>{
 const T=await three,r=narrowRoom(),upper={...r,id:'upper',floor:2},sc3=new T.Scene(),mat=new T.MeshBasicMaterial({side:T.DoubleSide});
 const c=run({RoomGeometry:G,THREE:T,U:.001,DATA:{rooms:[r,upper],items:[],walls:[]},sc3,isInt:true,isWalkView:()=>false,PV_INTERIOR_DAYLIGHT:false,LIGHT_SETTINGS:{room:1},CeilingDesigner:{active:()=>true,areas:()=>[]},makeCeilingMaterial:()=>mat,makeRoomCeilingMaterial:()=>mat,stairwellQuadsForFloor:()=>[],stairwellHolesForRoom:()=>[],roomFloorTopY:()=>0,floorBaseY:()=>0,roomCeilingHeightM:()=>2.7,roomCeilingProfile:()=>null,autoRoomLightsEnabled:()=>true,usesFinishedHeightModel:()=>true,mergeGroupMeshes:()=>{},isLightItemType:()=>false},['buildRooms3D','roomHasCoverAbove','buildRoomCeilingMesh','mark3DSelectable']);
 c.buildRooms3D(1);
 const ceilings=sc3.children.filter(o=>o.userData.ceiling),lights=sc3.children.filter(o=>o.isPointLight);
 assert.equal(ceilings.length,1);assert.ok(rayHits(T,ceilings[0],.3,3).length);assert.equal(rayHits(T,ceilings[0],3,3).length,0);
 assert.ok(lights.length>0);lights.forEach(l=>assert.ok(G.contains(r,l.position.x/.001,l.position.z/.001)));
 assert.ok(lights.some(l=>l.position.z>1));assert.ok(lights.some(l=>l.position.x>1));
});
test('narrow-room ceiling extrema sample occupied arms including their outer vertices',()=>{
 const r=narrowRoom(),roof={id:'roof',floor:2},c=run({RoomGeometry:G,HeightModel:{ceilingShape:()=>({type:'sloped',lowMm:2200})},DATA:{},U:.001,_roofCeilingExtentCache:{},roomDeclaresSlopedCeiling:()=>true,roofItemOverRoom:()=>roof,setbackRoofsForRoom:()=>[],roofsOverRoom:()=>[roof],roofBaseWorldY:()=>0,floorBaseY:()=>0,floorSlabHeightMForFloor:()=>0,roomCeilingWorldYAtMm:(r,p,x,y)=>{assert.ok(G.contains(r,x,y));return 2+x/4000;}},['roomRoofCeilingExtent']);
 const extent=c.roomRoofCeilingExtent(r);assert.equal(extent.lowY,2);assert.equal(extent.highY,3);
});
