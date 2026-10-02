const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Scene=require('../../assets/js/scene-ir-v3.js'),Openings=require('../../assets/js/scene-opening-geometry.js'),RoomGeometry=require('../../assets/js/room-geometry.js');
const {topLevelFunction}=require('./height-runtime.cjs');
const fact=value=>({value,status:'observed',source:'synthetic independent gap and pivot measurements'});
const clone=value=>JSON.parse(JSON.stringify(value));
const options={materialization:'bounded-v3',registry:{get:()=>null},targetPlan:{heightDefaults:{modelVersion:2,floorThickness:180}},defaultFloorOffset:()=>0};
const codes=result=>result.diagnostics.map(d=>d.code);
function reviewed(scene){
  const first=Scene.compile(scene,options);
  return Scene.compile(scene,{...options,acceptedReviewGroups:(first.reviewGroups||[]).map(g=>g.id),reviewedEntities:Object.fromEntries((first.reviewGroups||[]).map(g=>[g.entityId,g.reviewKey]))});
}
function fixture(jamb='start',inset=50,normalOffset=0){
  const start=jamb==='start',axis={x:start?1:-1,y:0},pivot={x:start?1000+inset:2000-inset,y:normalOffset};
  return {sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],
    walls:[{id:'host',floor:fact(1),start:fact({x:0,y:0}),end:fact({x:4000,y:0}),thicknessMm:fact(120)}],
    rooms:[{id:'room',floor:fact(1),shape:fact({kind:'rectUnion',rectangles:[{x:0,y:60,w:4000,d:3940}]}),boundaryBasis:fact('clear-face')}],
    openings:[{id:'door',floor:fact(1),hostWallId:fact('host'),adjacentRoomIds:fact(['room',null]),start:fact({x:1000,y:0}),end:fact({x:2000,y:0}),mechanism:fact('swing'),heightMm:fact(2100),leafRelation:fact('single'),
      leaves:[{id:'leaf',mechanism:fact('swing'),hingeJamb:fact(jamb),pivot:fact(pivot),closedAxis:fact(axis),leafWidthMm:fact(900),thicknessMm:fact(36),swingSide:fact({x:0,y:1}),angleDeg:fact(start?90:-90),openState:fact('open')}]}],
    objects:[],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]};
}
function runtimeWalls(scene){return scene.walls.map(w=>({id:w.id,floor:w.floor.value||1,x1:w.start.value.x,y1:w.start.value.y,x2:w.end.value.x,y2:w.end.value.y,thick:w.thicknessMm.value}));}
function directGeometry(scene,index=0){
  const e=scene.openings[index],l=e.leaves[0],a=e.start.value,b=e.end.value,walls=runtimeWalls(scene);
  return Openings.compileOpening({id:e.id,floor:e.floor.value||1,hostWallId:e.hostWallId.value,kind:'door-swing',sourceExactGap:true,
    center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},widthMm:Math.hypot(b.x-a.x,b.y-a.y),swingSide:l.swingSide.value,
    sourceLeaf:{mechanism:'swing',pivot:l.pivot.value,closedAxis:l.closedAxis.value,leafWidthMm:l.leafWidthMm.value,thicknessMm:l.thicknessMm.value,angleDeg:Math.abs(l.angleDeg.value)}},walls,[]);
}
function samePoints(actual,expected,tolerance=1e-6){
  assert.equal(actual.length,expected.length);
  for(const p of actual)assert.ok(expected.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<tolerance),JSON.stringify({actual,expected}));
}
function worldLeaf(item,walls,open){
  const info=Openings.explicitHostWallInfo(item,walls),angle=info.rot*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return Openings.sourcePlanGeometry(item,open).leaf.map(p=>({x:info.x+c*p.x-s*p.y,y:info.y+s*p.x+c*p.y}));
}
test('v3 contract keeps independent gap and tangential/face-offset pivot, with explicit review still required',()=>{
  const prompt=fs.readFileSync(path.join(__dirname,'../../docs/scene-ir/extraction-prompt-v3.txt'),'utf8');
  assert.match(prompt,/Gap start\/end and a leaf pivot are independent observations/);
  for(const jamb of ['start','end'])for(const inset of [25.4,42.4,50,50.8])for(const offset of [0,60]){
    const scene=fixture(jamb,inset,offset),before=JSON.stringify(scene),direct=directGeometry(scene);
    assert.equal(direct.ok,true,JSON.stringify(direct.diagnostics));
    const first=Scene.compile(scene,options);assert.equal(first.canApply,false,'Room datum needs explicit fresh review');
    const result=reviewed(scene);assert.equal(result.canApply,true,JSON.stringify(result.diagnostics));
    const item=result.plan.items[0];assert.equal(item.w,1000);assert.equal(item.x+item.w/2,1500);assert.equal(item.y+item.d/2,0);
    assert.equal(Openings.wallCutWidthMm(item,4000),1000);assert.deepEqual(item.openingSourceGeometry,direct.geometry.parameters);
    assert.deepEqual(result.sourceScene.openings,scene.openings);assert.equal(JSON.stringify(scene),before);
    assert.equal(result.defaults.some(d=>d.path.startsWith('openings[')),false,'Inset must not become a procedural default');
    for(const open of [false,true])samePoints(worldLeaf(item,result.plan.walls,open),direct.geometry[open?'fullOpenLeaf':'closedLeaf']);
  }
});
test('host reversal and reversed source gap ordering preserve source world pivot and leaves',()=>{
  for(const jamb of ['start','end']){
    const scene=fixture(jamb,50,60),original=reviewed(scene);assert.equal(original.canApply,true,JSON.stringify(original.diagnostics));
    const reversed=clone(scene);[reversed.walls[0].start,reversed.walls[0].end]=[reversed.walls[0].end,reversed.walls[0].start];
    const host=reviewed(reversed);assert.equal(host.canApply,true,JSON.stringify(host.diagnostics));
    [reversed.openings[0].start,reversed.openings[0].end]=[reversed.openings[0].end,reversed.openings[0].start];
    reversed.openings[0].leaves[0].hingeJamb.value=jamb==='start'?'end':'start';
    const gap=reviewed(reversed);assert.equal(gap.canApply,true,JSON.stringify(gap.diagnostics));
    for(const result of [host,gap])for(const open of [false,true])samePoints(worldLeaf(result.plan.items[0],result.plan.walls,open),worldLeaf(original.plan.items[0],original.plan.walls,open));
    assert.deepEqual(directGeometry(reversed).geometry.hinge,scene.openings[0].leaves[0].pivot.value);
  }
});
test('known hinge-jamb association still rejects a leaf directed from the opposite jamb',()=>{
  for(const jamb of ['start','end']){
    const scene=fixture(jamb);scene.openings[0].leaves[0].hingeJamb.value=jamb==='start'?'end':'start';
    assert.equal(directGeometry(scene).ok,true,'Geometry alone cannot validate semantic jamb association');
    const result=reviewed(scene);assert.equal(result.canApply,false);assert.ok(codes(result).includes('hinge_jamb_conflict'));
  }
});
test('out-of-gap pivots, protruding panels and face offsets beyond wall thickness remain blocked',()=>{
  for(const jamb of ['start','end'])for(const change of [
    l=>{l.pivot.value.x=jamb==='start'?999.9:2000.1;},
    l=>{l.leafWidthMm.value=950.1;},
    l=>{l.pivot.value.y=60.1;}
  ]){
    const scene=fixture(jamb);change(scene.openings[0].leaves[0]);const result=reviewed(scene);
    assert.equal(result.canApply,false);assert.ok(codes(result).includes('opening_source-swing-outside-gap'),JSON.stringify(result.diagnostics));
  }
});
test('inset geometry cannot bypass source mechanism, direction, pose, state or unsupported-detail conflicts',()=>{
  for(const [change,code] of [
    [l=>{l.mechanism.value='pocket';},'source_leaf_mechanism_conflict'],
    [l=>{l.angleDeg.value=-90;},'source_angle_direction_conflict'],
    [l=>{l.closedCenter=fact({x:1501,y:0});},'source_leaf_pose_conflict'],
    [l=>{l.openCenter=fact({x:1050,y:451});},'source_leaf_pose_conflict'],
    [l=>{l.openState.value='closed';},'source_leaf_state_conflict'],
    [l=>{l.openState.value='partial';},'unsupported_partial_open_state'],
    [l=>{l.travelDistanceMm=fact(900);},'inapplicable_source_leaf_fact'],
    [l=>{l.observedPolyline=fact([{x:1050,y:0},{x:1050,y:900}]);},'unsupported_leaf_polyline'],
    [l=>{l.pivot={value:null,status:'unknown'};},'unknown_required_geometry'],
    [l=>{l.closedAxis.value={x:0,y:1};l.swingSide.value={x:-1,y:0};delete l.hingeJamb;},'opening_invalid-source-swing']
  ]){
    const scene=fixture();change(scene.openings[0].leaves[0]);const result=reviewed(scene);
    assert.equal(result.canApply,false);assert.ok(codes(result).includes(code),JSON.stringify(result.diagnostics));
  }
  for(const change of [s=>{s.openings[0].leafRelation.value='paired';},s=>{s.openings[0].mechanism.value='fold';}]){
    const scene=fixture();change(scene);assert.equal(reviewed(scene).canApply,false);
  }
});
test('independent pivots retain exact adjacency, host collision and intermediate sweep checks',()=>{
  const adjacent=fixture();adjacent.rooms[0].shape.value.rectangles[0].y+=.01;
  assert.ok(codes(reviewed(adjacent)).includes('wrong_adjacent_room'),'No widened adjacency tolerance');
  const host=fixture('start',1,60),leaf=host.openings[0].leaves[0];leaf.swingSide.value={x:0,y:-1};leaf.angleDeg.value=-90;
  assert.ok(codes(reviewed(host)).includes('opening_source-swing-host-collision'));
  const swept=fixture(),q=1050+700*Math.cos(Math.PI/4),y=700*Math.sin(Math.PI/4);
  swept.walls.push({id:'blocker',floor:fact(1),start:fact({x:q-1,y}),end:fact({x:q+1,y}),thicknessMm:fact(2)});
  assert.ok(codes(reviewed(swept)).includes('opening_opening-sweep-collision'));
});
test('changing an inset pivot invalidates previously accepted source review without mutating source',()=>{
  const scene=fixture();Object.assign(scene.openings[0].leaves[0].pivot,{status:'inferred',reason:'Reconstructed independently from the source symbol'});
  const first=Scene.compile(scene,options),accepted={...options,acceptedReviewGroups:first.reviewGroups.map(g=>g.id),reviewedEntities:Object.fromEntries(first.reviewGroups.map(g=>[g.entityId,g.reviewKey]))};
  assert.equal(Scene.compile(scene,accepted).canApply,true);scene.openings[0].leaves[0].pivot.value.x+=1;
  const result=Scene.compile(scene,accepted);assert.equal(result.canApply,false);assert.equal(result.reviewGroups.find(g=>g.entityId==='door').accepted,false);
});
test('unchanged real-plan extraction loses only false jamb-equality errors and still blocks unsupported/conflicting source',()=>{
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scene-ir/v3-source-c-repaired.json'),'utf8')),before=JSON.stringify(raw),scope=['image:1:exact-image-content'];
  const result=Scene.compile(raw,{...options,pageScope:scope,placementContext:Scene.createPlacementContext(raw,scope,1,true)});
  assert.equal(result.canApply,false);assert.equal(codes(result).includes('hinge_jamb_conflict'),false);
  assert.ok(codes(result).includes('wrong_adjacent_room'));assert.ok(codes(result).includes('unsupported_leaf_group'));assert.ok(codes(result).includes('unsupported_opening_mechanism'));
  assert.equal(directGeometry(raw,3).ok,true,'Exact entry inset is supported without moving its gap or pivot');
  for(const i of [0,1])assert.ok(directGeometry(raw,i).diagnostics.some(d=>d.code==='source-swing-outside-gap'),'Bedroom/toilet independent geometry contradictions remain blocked');
  assert.equal(JSON.stringify(raw),before);assert.deepEqual(result.sourceScene,raw);
});

// Execute the actual opening renderer with real THREE meshes, not a copied hinge formula.
// Material/selection helpers are irrelevant to geometry and are stubbed; the pivot,
// panel constructor, dimensions, state and world transforms all run from app source.
async function renderedPlan(plan){
  const THREE=await import('../../assets/vendor/three/build/three.module.js');
  const c=vm.createContext({THREE,RoomGeometry,SceneOpeningGeometry:Openings,DATA:plan,U:.001,_doorAnims:[],sc3:new THREE.Scene(),
    isOpeningItemType:t=>t==='door-swing',isWindowLikeType:()=>false,isArchOpeningType:()=>false,isNoDoorOpeningType:()=>false,
    item3DBaseY:()=>0,makeItemTextureMaterial:()=>null,getOpeningModelItem:()=>null,getWallExteriorSpans:()=>[],doorLeafFaceMaterials:m=>m,mark3DSelectable:()=>{}});
  for(const name of ['doorHeightMm','doorOpenState','doorOpenWant','getOpeningWallInfo'])vm.runInContext(topLevelFunction(name),c);
  c.ST={view:'3d-int'};c.isWalkView=()=>false;c._doorWantByItem=new WeakMap();
  vm.runInContext(topLevelFunction('buildWinFrames'),c);c.buildWinFrames();
  assert.equal(c._doorAnims.length,1);const anim=c._doorAnims[0],mesh=anim.pivot.children[0];
  c.sc3.updateMatrixWorld(true);const pos=mesh.geometry.attributes.position,points=[];
  for(let i=0;i<pos.count;i++){
    const v=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld),p={x:v.x*1000,y:v.z*1000};
    if(!points.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<.0001))points.push(p);
  }
  const hinge=new THREE.Vector3();anim.pivot.getWorldPosition(hinge);
  return {anim,mesh,points,hinge:{x:hinge.x*1000,y:hinge.z*1000}};
}
test('actual THREE opening renderer preserves exact inset pivot and panel for both states and reversed hosts',async()=>{
  for(const jamb of ['start','end'])for(const reverse of [false,true])for(const open of [false,true]){
    const scene=fixture(jamb,50.8,60);scene.openings[0].leaves[0].openState.value=open?'open':'closed';
    if(!open)scene.openings[0].leaves[0].angleDeg.value=0;
    if(reverse)[scene.walls[0].start,scene.walls[0].end]=[scene.walls[0].end,scene.walls[0].start];
    const result=reviewed(scene);assert.equal(result.canApply,true,JSON.stringify(result.diagnostics));
    const r=await renderedPlan(result.plan),item=result.plan.items[0];
    samePoints([r.hinge],[scene.openings[0].leaves[0].pivot.value]);
    assert.equal(r.mesh.geometry.parameters.width,900*.001);assert.equal(r.mesh.geometry.parameters.depth,36*.001);
    samePoints(r.points,worldLeaf(item,result.plan.walls,open),.0001);
    assert.equal(Openings.wallCutWidthMm(item,4000),1000);
  }
});
test('actual THREE meshes retain the unchanged real entry pivot, panel and vertical-host reversal',async()=>{
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scene-ir/v3-source-c-repaired.json'),'utf8')),before=JSON.stringify(raw);
  for(const reverse of [false,true])for(const open of [false,true]){
    const scene=clone(raw);if(reverse)for(const wall of scene.walls)[wall.start,wall.end]=[wall.end,wall.start];
    const direct=directGeometry(scene,3);assert.equal(direct.ok,true,JSON.stringify(direct.diagnostics));
    const item={...direct.item,doorHeight:2100,doorOpenState:open?'open':'closed'},walls=runtimeWalls(scene);
    const r=await renderedPlan({rooms:[],walls,items:[item]}),leaf=raw.openings[3].leaves[0];
    samePoints([r.hinge],[leaf.pivot.value]);
    assert.equal(r.mesh.geometry.parameters.width,leaf.leafWidthMm.value*.001);
    assert.equal(r.mesh.geometry.parameters.depth,leaf.thicknessMm.value*.001);
    samePoints(r.points,direct.geometry[open?'fullOpenLeaf':'closedLeaf'],.0001);
    assert.ok(Math.abs(Openings.wallCutWidthMm(item,4000)-911.9)<1e-6);
  }
  assert.equal(JSON.stringify(raw),before);
});
