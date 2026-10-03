const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../../assets/js/plan-registration.js'),Grid=require('../../assets/js/plan-grid.js');
const {fixture,approved}=require('./fixtures/registration/three-floor-setback.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const errors=r=>r.diagnostics.filter(d=>d.severity==='error');
test('sample-derived stepped 3F builds locally before +455mm registration; source immutable, exact areas retained',()=>{
 const {source,proposals}=fixture(),before=JSON.stringify(source),r=R.compile(source,approved(source,proposals));
 assert.deepEqual(errors(r),[]);assert.equal(r.canApply,true);assert.equal(r.status,'partial-building-assembly');
 assert.deepEqual(r.poses[3],{quarterTurns:0,dx:0,dy:455});
 const rooms=r.plan.rooms.filter(r=>r.floor===3);assert.equal(Math.max(...rooms.map(r=>r.y+r.d)),4095);assert.equal(Math.max(...rooms.map(r=>r.x+r.w)),5915);
 assert.equal(Math.min(...rooms.filter(r=>r.x===0).map(r=>r.y)),910,'left stepped northern edge retains extra 455mm recess');
 const local=Grid.build(source.floors[2]);assert.equal(rooms.reduce((s,r)=>s+r.w*r.d,0),local.rooms.reduce((s,r)=>s+r.w*r.d,0));
 assert.equal(JSON.stringify(source),before);assert.equal(r.plan.items.length,0);assert.equal(r.deferredItems.length,2);assert.ok(r.diagnostics.some(d=>d.code==='vertical_geometry_unknown'));
});
test('source transforms before local assembly still fail, proving regression really exercises ordering',()=>{
 const {source}=fixture(),f=source.floors[2];f.rooms.forEach(r=>r.parts.forEach(p=>{p.y0+=455;p.y1+=455;}));assert.ok(Grid.build(f).problems.length);
});
test('model proposed poses are only previews; model reviewed booleans cannot authorize Apply',()=>{
 const {source,proposals}=fixture();proposals.floors.forEach(f=>f.reviewed=true);const r=R.compile(source,{proposals});assert.equal(r.canApply,false);assert.equal(r.floors[2].status,'proposed');assert.ok(errors(r).some(d=>d.code==='registration_unreviewed'));
});
test('missing anchors produce no misleading aligned preview and block Apply',()=>{
 const {source}=fixture();const r=R.compile(source,{});assert.equal(r.canApply,false);assert.equal(r.plan.walls.length,0);assert.ok(errors(r).some(d=>d.code==='missing_anchors'));
});
for(const [name,mutate,code] of [
 ['duplicate pages',s=>s.floors[2].sourcePageId='page-1','source_page_mapping'],
 ['duplicate floors',s=>s.floors[2].floor=2,'duplicate_floor'],
 ['header conflict',s=>s.floors[2].sourceIdentity.status='conflict','floor_identity_conflict'],
 ['unconfirmed identity',s=>s.floors[2].sourceIdentity.status='unknown','floor_identity_unknown'],
 ['mis-scaled source',s=>s.floors[2].dims.top.total=7280,'source_scale_conflict'],
 ['bad local geometry',s=>s.floors[2].rooms[0].parts[0].y1=4095,'local_geometry'],
])test(name+' blocks entire building',()=>{const {source,proposals}=fixture();mutate(source);const r=R.compile(source,approved(source,proposals));assert.equal(r.canApply,false);assert.ok(errors(r).some(d=>d.code===code),JSON.stringify(errors(r)));});
test('array order does not determine floor identity or transform',()=>{
 const {source,proposals}=fixture();source.floors.reverse();proposals.floors.reverse();const r=R.compile(source,approved(source,proposals));assert.equal(r.canApply,true);assert.equal(r.poses[3].dy,455);
});
test('fully detached and disjoint adjacent floors run production whole-building checker',()=>{
 const {source,proposals}=fixture();proposals.floors[1].anchors.forEach(a=>a.building.x+=10000);const r=R.compile(source,approved(source,proposals));assert.equal(r.canApply,false);assert.ok(errors(r).some(d=>d.code==='detached_floors'));assert.ok(errors(r).some(d=>d.code==='adjacent_floor_disjoint'));
});
test('rigid quarter turns rotate rooms, walls and item centres without scale or width/depth rewriting',()=>{
 const {source,proposals}=fixture();source.items=[{type:'window',floor:3,x:100,y:200,w:900,d:120,rot:0}];
 const p=proposals.floors[2];p.anchors=[{local:{x:0,y:0},building:{x:3640,y:0},evidence:'axes',precisionMm:0},{local:{x:1000,y:0},building:{x:3640,y:1000},evidence:'axis end',precisionMm:0}];
 const r=R.compile(source,approved(source,proposals));assert.equal(r.poses[3].quarterTurns,1);const it=r.plan.items[0];assert.equal(it.rot,90);assert.equal(it.w,900);assert.equal(it.d,120);assert.equal(it.x,3440);assert.equal(it.y,100);
});
test('single point+direction constrains rotation; weak/duplicate point pairs do not',()=>{
 const anchor={local:{x:10,y:20},building:{x:90,y:210},evidence:'corner',precisionMm:2};
 assert.equal(R.solve({anchors:[anchor]}).ok,false);assert.equal(R.solve({anchors:[anchor,copy(anchor)]}).ok,false);
 const solved=R.solve({anchors:[anchor],directions:[{local:{x:1,y:0},building:{x:0,y:1},evidence:'labeled X axis',precisionDeg:1}]});assert.equal(solved.ok,true);assert.equal(solved.pose.quarterTurns,1);
});
test('anchor uncertainty is explicit; numerical tolerance never disguises scale discrepancy',()=>{
 const anchors=[{local:{x:0,y:0},building:{x:0,y:0},evidence:'raster corner',precisionMm:15},{local:{x:6000,y:0},building:{x:6008,y:0},evidence:'raster corner',precisionMm:15}];
 let r=R.solve({anchors});assert.equal(r.ok,true);assert.deepEqual(r.residuals.map(x=>x.residualMm),[4,4]);
 anchors[1].building.x=7280;r=R.solve({anchors});assert.equal(r.ok,false);assert.equal(r.code,'anchor_residual');assert.ok(r.residuals[0].residualMm>600);
 anchors[1].precisionMm=10000;assert.equal(R.solve({anchors}).code,'invalid_anchor_evidence');
});
test('stair endpoint constraints compare arrival anchors, not overlapping full stair bboxes',()=>{
 const {source,proposals}=fixture();proposals.stairLinks=[{lower:{floor:2,point:{x:1200,y:3800}},upper:{floor:3,point:{x:1200,y:3345}},evidence:'explicit arrival comparison (synthetic)',precisionMm:10}];
 assert.equal(R.compile(source,approved(source,proposals)).canApply,true);
 proposals.stairLinks[0].upper.point.x+=300;const r=R.compile(source,approved(source,proposals));assert.equal(r.canApply,false);assert.ok(errors(r).some(d=>d.code==='stair_endpoint_mismatch'));
});
test('partial acknowledgment and all approvals expire after source or proposal changes',()=>{
 const {source,proposals}=fixture(),opts=approved(source,proposals);source.floors[0].rooms[0].name+=' changed';assert.equal(R.compile(source,opts).canApply,false);
 const next=approved(source,proposals);proposals.floors[0].anchors[0].building.x+=1;assert.equal(R.compile(source,next).canApply,false);
 const missing=approved(source,proposals);missing.partialAcknowledged=false;assert.equal(R.compile(source,missing).canApply,false);
});
test('actual import finalization emits immutable frames and blocking review diagnostics before preview',async()=>{
 const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');const {source}=fixture();
 const parsed={floors:source.floors.map(f=>({...f,items:source.items.filter(i=>i.floor===f.floor)})),notes:[]};
 const response=finishImportedPlan(parsed,null,{}),body=await response.json();assert.equal(response.status,200);assert.equal(body.buildingReview.canApply,false);assert.equal(body.sourceLocal.floors[2].depth,3640);assert.equal(body.sourceLocal.floors[2].sourcePageId,'page-3');assert.ok(body.warnings.some(s=>s.includes('位置合わせ')));
});

for(const q of [0,1,2,3])test('cardinal '+q*90+'° and translation preserve v1 opening centre/host through real app conversion',()=>{
 const {runtime}=require('./scene-fixtures.cjs'),c=runtime(),{source,proposals}=fixture();
 const raw={x:1000,y:0},origin={x:400,y:600};
 function independent(p){return [{x:p.x+400,y:p.y+600},{x:400-p.y,y:600+p.x},{x:400-p.x,y:600-p.y},{x:400+p.y,y:600-p.x}][q];}
 source.items=[{type:'window',floor:2,x:raw.x,y:raw.y,w:900,d:120,rot:0}];source.marks=[{floor:2,x:1234,y:789,w:456,d:123,label:'mark'}];
 proposals.floors[1].anchors=[{local:{x:0,y:0},building:origin,evidence:'test origin',precisionMm:0},{local:{x:1000,y:0},building:independent({x:1000,y:0}),evidence:'test x axis',precisionMm:0}];
 const compiled=R.compile(source,approved(source,proposals)),read=c.PlanImport.toAppObjects(compiled.plan),it=read.items[0],expected=independent(raw);
 assert.equal(it.x+it.w/2,expected.x);assert.equal(it.y+it.d/2,expected.y);assert.equal(it.rot,q*90);
 const host=compiled.plan.walls.filter(w=>w.floor===2).find(w=>Math.abs((expected.x-w.x1)*(w.y2-w.y1)-(expected.y-w.y1)*(w.x2-w.x1))<1e-6&&expected.x>=Math.min(w.x1,w.x2)&&expected.x<=Math.max(w.x1,w.x2)&&expected.y>=Math.min(w.y1,w.y2)&&expected.y<=Math.max(w.y1,w.y2));assert.ok(host,'opening centre remains exactly on transformed host wall');
 const m=compiled.plan.marks[0];assert.deepEqual({x:m.x,y:m.y},independent(source.marks[0]));assert.equal(m.w,q%2?123:456);assert.equal(m.d,q%2?456:123);
 const dx=expected.x-400,dy=expected.y-600,restored=[{x:dx,y:dy},{x:dy,y:-dx},{x:-dx,y:-dy},{x:-dy,y:dx}][q];assert.equal(restored.x,raw.x);assert.equal(restored.y+0,raw.y);
});

test('optional v1 item depth stays explicitly assumed rather than misreported as measured or permanently blocked',()=>{
 const {source,proposals}=fixture();source.items=[{type:'window',floor:2,x:1000,y:0,w:900,rot:0}];const r=R.compile(source,approved(source,proposals));assert.equal(r.canApply,true);assert.ok(r.diagnostics.some(d=>d.code==='display_depth_assumed'));assert.equal(r.plan.items[0].d,undefined);assert.equal(source.items[0].d,undefined);
 const c=require('./scene-fixtures.cjs').runtime(),made=c.PlanImport.toAppObjects(r.plan).items[0];assert.equal(made.x+made.w/2,1000);assert.equal(made.y+made.d/2,0);assert.ok(made.d>0);
});
