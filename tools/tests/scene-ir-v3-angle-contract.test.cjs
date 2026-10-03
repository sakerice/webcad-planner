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
// These are independent synthetic observations, not a repair of any frozen extraction.
function transformed(scene,quarterTurns,mirror){
 const out=clone(scene),vector=p=>{let x=mirror?-p.x:p.x,y=p.y;for(let n=0;n<quarterTurns;n++){[x,y]=[-y,x];}return {x,y};},point=p=>{let v=vector(p);return {x:v.x+10000,y:v.y+10000};};
 for(const w of out.walls){w.start.value=point(w.start.value);w.end.value=point(w.end.value);}
 for(const r of out.rooms)for(const cell of r.shape.value.rectangles){let corners=[point({x:cell.x,y:cell.y}),point({x:cell.x+cell.w,y:cell.y+cell.d})];cell.x=Math.min(...corners.map(p=>p.x));cell.y=Math.min(...corners.map(p=>p.y));cell.w=Math.abs(corners[0].x-corners[1].x);cell.d=Math.abs(corners[0].y-corners[1].y);}
 for(const e of out.openings){e.start.value=point(e.start.value);e.end.value=point(e.end.value);for(const leaf of e.leaves){leaf.pivot.value=point(leaf.pivot.value);leaf.closedAxis.value=vector(leaf.closedAxis.value);leaf.swingSide.value=vector(leaf.swingSide.value);if(mirror)leaf.angleDeg.value=-leaf.angleDeg.value;}}
 return out;
}
test('signed swing angles compile and materialize consistently in all quadrants, mirrored drawings and reversed host walls',()=>{
 for(const jamb of ['start','end'])for(const quarter of [0,1,2,3])for(const mirror of [false,true])for(const reverse of [false,true]){
  const scene=transformed(fixture(jamb,50,60),quarter,mirror);if(reverse)[scene.walls[0].start,scene.walls[0].end]=[scene.walls[0].end,scene.walls[0].start];
  const before=JSON.stringify(scene),leaf=scene.openings[0].leaves[0],axis=leaf.closedAxis.value,side=leaf.swingSide.value;
  assert.equal(Math.sign(leaf.angleDeg.value),Math.sign(axis.x*side.y-axis.y*side.x));
  const compiled=Scene.compile(scene);assert.equal(compiled.valid,true,JSON.stringify(compiled.diagnostics));
  const result=reviewed(scene);assert.equal(result.canApply,true,JSON.stringify(result.diagnostics));assert.equal(result.plan.items.length,1);assert.equal(JSON.stringify(scene),before);
  const direct=directGeometry(scene);assert.equal(direct.ok,true,JSON.stringify(direct.diagnostics));
  for(const open of [false,true])samePoints(worldLeaf(result.plan.items[0],result.plan.walls,open),direct.geometry[open?'fullOpenLeaf':'closedLeaf']);
 }
});
test('an unsigned positive drawing amount cannot override contradictory signed direction in any quadrant',()=>{
 for(const quarter of [0,1,2,3])for(const mirror of [false,true]){
  const scene=transformed(fixture('start'),quarter,mirror),leaf=scene.openings[0].leaves[0];leaf.angleDeg.value=-leaf.angleDeg.value;
  const before=JSON.stringify(scene),source=Scene.compile(scene),runtime=Scene.compile(scene,options);
  assert.ok(codes(source).includes('source_angle_direction_conflict'));assert.equal(source.valid,false);assert.equal(runtime.canApply,false);assert.equal(JSON.stringify(scene),before);assert.equal(source.sourceScene.openings[0].leaves[0].angleDeg.value,leaf.angleDeg.value);
 }
});
test('extraction prompt separates signed rotation from unsigned literal amount without authorizing silent source correction',()=>{
 const prompt=fs.readFileSync(path.join(__dirname,'../../docs/scene-ir/extraction-prompt-v3.txt'),'utf8');
 assert.match(prompt,/positive is clockwise/);assert.match(prompt,/unsigned magnitude/);assert.match(prompt,/as inferred with source and reason/);assert.match(prompt,/do not silently flip a retained source angle/);
});
