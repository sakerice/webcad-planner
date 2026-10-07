// Deterministic extraction -> Worker assembly -> real mkItem -> wall/room semantics.
// No image recognition, renderer or hosted API is exercised here.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=require('./app-source.cjs').appSource();
function install(name,context) {
  const start=src.indexOf('function '+name+'('), end=src.indexOf('\nfunction ',start+1);
  assert.ok(start>=0,name);
  vm.runInContext(src.slice(start,end<0?undefined:end),context);
}
async function runtime(plan) {
  const {ITEM_SPEC}=await import('../../worker/plan-item-spec.mjs');
  const sizes=Object.fromEntries(ITEM_SPEC.map(s=>[s.type,s]));
  const c={SceneOpeningGeometry:require('../../assets/js/scene-opening-geometry.js'),document:undefined,DATA:plan,nextId:1,ICOLORS:{},bestFmpType:t=>t,
    getItemDefaultSize:t=>sizes[t],defaultWallHeightMmForFloor:()=>2600,newRoomFloorRaiseMm:()=>0,
    isLightItemType:()=>false,isContextExteriorItemType:()=>false,canSetItemElevation:()=>false,isFmpItemType:()=>false};
  c.self=c; vm.createContext(c);
  for(const name of ['isWindowLikeType','isDoorLikeOpeningType','isSwingDoorType','isDoorPanelType','mkWall','mkItem',
    'isOpeningItemType','getOpeningCenterCandidates','getOpeningWallInfo','openingSidePoints','roomsAtPointOnFloor',
    'openingAdjacentRooms','getWallDoorGapsMm']) install(name,c);
  vm.runInContext(fs.readFileSync('assets/js/plan-import.js','utf8'),c);
  c.DATA=c.PlanImport.toAppObjects(plan);
  return c;
}
function reading(floor=2) {
  return {floors:[{floor,width:6000,depth:4000,rooms:[
    {name:'A',parts:[{x0:0,y0:0,x1:2450,y1:4000}]},
    {name:'B',parts:[{x0:2450,y0:0,x1:6000,y1:4000}]}],items:[
    {type:'door-swing',x:2450,y:1500,w:780,d:780,rot:90},
    {type:'window',x:6000,y:1800,w:1200,d:150,rot:90},
    {type:'window-door',x:4500,y:4000,w:1690,d:180,rot:0},
    {type:'door-front',x:1200,y:4000,w:940,d:200,rot:0},
    {type:'door-opening',x:2450,y:3100,w:850,d:160,rot:90},
  ]}]};
}
test('actual opening objects retain center, width, rotation, floor, wall and adjacent rooms',async()=>{
  const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
  const raw=reading(), res=finishImportedPlan(raw); assert.equal(res.status,200);
  const {plan}=await res.json(), c=await runtime(plan);
  for(let i=0;i<raw.floors[0].items.length;i++) {
    const expected=raw.floors[0].items[i], actual=c.DATA.items[i], info=c.getOpeningWallInfo(actual);
    assert.equal(actual.type,expected.type); assert.equal(actual.w,expected.w); assert.equal(actual.d,expected.d);
    assert.equal(actual.rot,expected.rot); assert.equal(actual.floor,2);
    assert.equal(actual.x+actual.w/2,expected.x); assert.equal(actual.y+actual.d/2,expected.y);
    assert.ok(info,actual.type); assert.equal(info.dist,0); assert.equal(info.wall.floor,2);
    assert.equal(info.x,expected.x); assert.equal(info.y,expected.y);
    assert.equal(info.rot,expected.rot);
    const names=Array.from(c.openingAdjacentRooms(actual),r=>r.n).sort();
    assert.deepEqual(names,expected.x===2450?['A','B']:expected.x<2450?['A']:['B']);
  }
  const [door,window,patio,front]=c.DATA.items;
  assert.equal(door.doorHeight,2000); assert.equal(door.doorOpenState,'open');
  assert.equal(window.windowSill,900); assert.equal(window.windowHeight,1200);
  assert.equal(patio.windowSill,0); assert.equal(patio.windowHeight,2100);
  assert.equal(front.doorHeight,2330);
  const doorWall=c.getOpeningWallInfo(door).wall;
  const gaps=c.getWallDoorGapsMm(doorWall);
  assert.equal(gaps.length,2); assert.equal(gaps[0].b-gaps[0].a,door.w+80,'existing walk-clearance padding');
  assert.equal(c.getWallDoorGapsMm(c.getOpeningWallInfo(window).wall).length,0,'window must not become a walkable door');
});
test('same-coordinate walls on another floor cannot capture an imported opening',async()=>{
  const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
  const body=await finishImportedPlan(reading()).json(), c=await runtime(body.plan);
  c.DATA.walls.forEach(w=>w.floor=1); c.DATA.rooms.forEach(r=>r.floor=1);
  for(const it of c.DATA.items) {
    assert.equal(c.getOpeningWallInfo(it),null);
    assert.equal(c.openingAdjacentRooms(it).length,0);
  }
  assert.ok(c.DATA.walls.every(w=>c.getWallDoorGapsMm(w).length===0));
});
test('missing depth uses the real catalog default without shifting the extraction center',async()=>{
  const plan={walls:[],rooms:[],items:[{type:'window',x:500,y:1000,w:1300,rot:90,floor:3}]};
  const c=await runtime(plan), it=c.DATA.items[0];
  assert.equal(it.w,1300); assert.equal(it.d,150); assert.equal(it.floor,3);
  assert.equal(it.x+it.w/2,500); assert.equal(it.y+it.d/2,1000);
});
for(const source of ['a','b']) test(`blinded source ${source} has valid, consistent known geometry`,async()=>{
  const fixture=JSON.parse(fs.readFileSync(`tools/tests/fixtures/native-reading/source-${source}.expected.json`,'utf8'));
  const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
  const response=finishImportedPlan(fixture); assert.equal(response.status,200);
  const {plan}=await response.json(), c=await runtime(plan);
  for(const e of Object.values(fixture.floors[0].dims)) assert.equal(e.parts.reduce((n,x)=>n+x,0),e.total);
  for(const it of c.DATA.items.filter(it=>c.isOpeningItemType(it.type))) {
    const info=c.getOpeningWallInfo(it); assert.ok(info,it.type); assert.ok(info.dist<1e-8);
    assert.ok(Math.abs(info.x-it.x-it.w/2)<1e-8); assert.ok(Math.abs(info.y-it.y-it.d/2)<1e-8);
    assert.ok(c.openingAdjacentRooms(it).length>=1);
  }
});
