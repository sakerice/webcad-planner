const test = require('node:test');
const assert = require('node:assert/strict');
const Grid = require('../../assets/js/plan-grid.js');
const { fixtures, metrics } = require('../benchmark_plan_geometry.cjs');
for(const fixture of fixtures) test(`exact extraction reconstruction: ${fixture.name}`, () => {
  const built = Grid.build(fixture), m = metrics(fixture,built);
  assert.deepEqual(built.problems, []);
  assert.equal(m.labelledAreaErrorMm2,0);
  assert.equal(m.roomsLost,0);
  assert.deepEqual(m.actualAdjacency,m.expectedAdjacency);
  assert.equal(m.openingsOnWall,m.openings);
});
test('adjacent rooms keep their shared wall, L-shaped parts have no internal wall', () => {
  const two = Grid.build(fixtures[0]);
  assert.ok(two.walls.some(w=>w.x1===1000 && w.x2===1000 && w.y1===0 && w.y2===2000));
  const l = Grid.build(fixtures[2]);
  assert.ok(!l.walls.some(w=>w.x1===1000 && w.x2===1000 && w.y1<1000));
});
for(const [name, mutate] of [
  ['overlap',f=>f.rooms[1].parts[0].x0=999],
  ['outside',f=>f.rooms[1].parts[0].x1=2001],
  ['reversed',f=>f.rooms[0].parts[0].x1=-1],
  ['nonfinite',f=>f.rooms[0].parts[0].x1=Infinity],
  ['null',f=>f.rooms[0].parts[0].x0=null],
  ['missing parts',f=>f.rooms[0].parts=[]],
]) test(`reject ambiguous geometry without partial walls: ${name}`,()=>{
  const f=structuredClone(fixtures[0]); mutate(f);
  const built=Grid.build(f);
  assert.ok(built.problems.length);
  assert.equal(built.walls.length,0);
  assert.equal(built.rooms.length,0);
});
test('bounded axes reject excessive unique boundaries before cell allocation',()=>{
  const rooms=Array.from({length:130},(_,i)=>({name:String(i),parts:[{x0:i*2,y0:0,x1:i*2+1,y1:100}]}));
  const b=Grid.build({width:300,depth:100,rooms});
  assert.equal(b.walls.length,0); assert.match(b.problems.join(),/多すぎる/);
});
test('legacy cells and explicit grids keep their coordinate convention',()=>{
  const b=Grid.build({gridX:[0,1000,2000],gridY:[0,2000],cells:['AB'],legend:{A:'A',B:'B'}});
  assert.deepEqual(b.problems,[]); assert.equal(b.rooms[0].w,1000);
  const m=Grid.build({width:1820,depth:910,cells:['AAAAAAAA','AAAAAAAA','AAAAAAAA','AAAAAAAA'],legend:{A:'A'}});
  assert.deepEqual(m.problems,[]); assert.equal(m.rooms[0].w,1820);
});
test('shared floor assembly preserves skip level/use and never mutates extraction',()=>{
  const f=structuredClone(fixtures[0]); f.floor=2; f.rooms[0].level=300; f.rooms[0].use='bedroom';
  const original=JSON.stringify(f); const b=Grid.buildFloors([f]);
  assert.equal(JSON.stringify(f),original);
  assert.equal(b.rooms[0].skipLevelMm,300); assert.equal(b.rooms[0].use,'bedroom'); assert.equal(b.rooms[0].floor,2);
});
test('area verification allows exterior recesses without inventing rooms',async()=>{
  const {planProcedure}=await import('../../worker/plan-prompt.mjs');
  assert.match(planProcedure(),/外接長方形/);
  assert.match(planProcedure(),/部屋ではない場所を面積合わせのために埋めない/);
});
const Draw = require('../../assets/js/plan-review-draw.js');
test('review outlines union perimeter without seams or a bounding-box wall',()=>{
  const l=fixtures[2].rooms[0], edges=Draw.roomEdges(l);
  assert.equal(edges.reduce((n,[x0,y0,x1,y1])=>n+Math.hypot(x1-x0,y1-y0),0),8000);
  assert.ok(!edges.some(([x0,y0,x1,y1])=>x0===1000&&x1===1000&&y0<1000));
  const strokes=[];
  const ctx=new Proxy({}, {get:(o,k)=> k==='strokeRect' ? (...args)=>strokes.push(args) : ()=>{}});
  const document={createElement:()=>({getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,test'})};
  Draw.drawPage({floors:[fixtures[2]]},{document});
  assert.deepEqual(strokes,[], 'no rectangular frame or rectangle-part stroke masquerading as a wall');
});
test('review courtyard keeps inner perimeter; overlapping parts do not introduce seams',()=>{
  const perimeter=r=>Draw.roomEdges(r).reduce((n,[x0,y0,x1,y1])=>n+Math.hypot(x1-x0,y1-y0),0);
  assert.equal(perimeter(fixtures[3].rooms[0]),16000);
  assert.equal(perimeter({parts:[{x0:0,y0:0,x1:1000,y1:1000},{x0:500,y0:0,x1:1500,y1:1000}]}),5000);
});
test('review gate catches equal-area overlap and gap without consulting a model',async()=>{
  const {pageFacts,reviseAdvice}=await import('../../worker/plan-gate.mjs');
  const valid={floors:[structuredClone(fixtures[0])]};
  const broken=structuredClone(valid); broken.floors[0].rooms[1].parts[0]={x0:0,y0:0,x1:1000,y1:2000};
  const a=pageFacts(valid).floors[0], b=pageFacts(broken).floors[0];
  assert.equal(a.room_area_sum_ratio_to_footprint,b.room_area_sum_ratio_to_footprint);
  assert.deepEqual(a.geometry_problems,[]); assert.ok(b.geometry_problems.length);
  let calls=0;
  const advice=await reviseAdvice([broken],{AI:{run:async()=>{calls++; throw Error('must not call');}}});
  assert.equal(calls,0); assert.equal(advice.skipAll,false); assert.equal(advice.pages[0].reason,'invalid_geometry');
});
test('one invalid floor prevents a misleading partial multi-floor reconstruction',()=>{
  const valid=structuredClone(fixtures[0]), invalid=structuredClone(fixtures[0]);
  invalid.floor=2; invalid.rooms[0].parts[0].x1=2001;
  const b=Grid.buildFloors([valid,invalid]);
  assert.ok(b.problems.length); assert.deepEqual(b.walls,[]); assert.deepEqual(b.rooms,[]);
});
test('worker rejects conflicting extraction before returning any candidate plan',async()=>{
  const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
  const f=structuredClone(fixtures[0]); f.rooms[1].parts[0].x0=999;
  const response=finishImportedPlan({floors:[f]});
  assert.equal(response.status,422);
  const body=await response.json(); assert.equal(body.error,'ai_invalid_plan'); assert.ok(body.problems.length); assert.equal(body.plan,undefined);
});
for (const gap of [0.001, 0.5, 1]) test(`near-coincident boundaries require review (${gap} mm gap)`,()=>{
  const f=structuredClone(fixtures[0]); f.rooms[1].parts[0].x0+=gap;
  const b=Grid.build(f);
  assert.ok(b.problems.some(p=>p.includes('近接')));
  assert.equal(b.walls.length,0); assert.equal(b.rooms.length,0);
  assert.equal(f.rooms[1].parts[0].x0,1000+gap,'must not silently snap model coordinates');
});
