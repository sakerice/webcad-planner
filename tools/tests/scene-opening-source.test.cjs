const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../assets/js/scene-opening-geometry.js');
const fs=require('node:fs');
const walls=[{id:'south',floor:1,x1:1100,y1:4600,x2:8100,y2:4600,thick:200},
{id:'partition',floor:1,x1:5600,y1:4600,x2:5600,y2:9600,thick:120}];
const swing=()=>({id:'entry',floor:1,kind:'door-front',hostWallId:'south',center:{x:4550,y:4600},widthMm:900,swingSide:{x:0,y:1},sourceLeaf:{mechanism:'swing',pivot:{x:4100,y:4700},closedAxis:{x:1,y:0},leafWidthMm:900,thicknessMm:40,angleDeg:90}});
const pocket=()=>({id:'pocket',floor:1,kind:'door-pocket',hostWallId:'partition',center:{x:5600,y:7350},widthMm:900,travelDirection:{x:0,y:1},sourceLeaf:{mechanism:'pocket',closedCenter:{x:5600,y:7350},leafWidthMm:940,thicknessMm:32,travelDistanceMm:940,pocketPolygon:[{x:5570,y:7800},{x:5630,y:7800},{x:5630,y:8780},{x:5570,y:8780}]}});
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r;};
const codes=r=>r.diagnostics.map(d=>d.code);
const reverse=w=>({...w,x1:w.x2,y1:w.y2,x2:w.x1,y2:w.y1});
const sorted=poly=>poly.map(p=>[+p.x.toFixed(6),+p.y.toFixed(6)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
test('fixture inset entry pivot is independent from exact gap and keeps real panel dimensions',()=>{
const r=ok(G.compileOpening(swing(),walls,[swing(),pocket()]));
assert.deepEqual(r.geometry.hinge,{x:4100,y:4700});assert.deepEqual(r.geometry.fullOpenLatch,{x:4100,y:5600});
assert.equal(r.item.w,900);assert.equal(r.geometry.parameters.leafThicknessMm,40);assert.equal(G.wallCutWidthMm(r.item,7000),900);
assert.deepEqual(G.rendererParameters(r.item,200),r.geometry.parameters);
assert.equal(r.item.openingSourceGeometry.hingeZmm,100);
});
test('fixture source pocket preserves 940 panel, 940 travel and exact 980 x 60 cavity',()=>{
const r=ok(G.compileOpening(pocket(),walls,[swing(),pocket()]));
assert.equal(r.geometry.parameters.leafWidthMm,940);assert.equal(r.geometry.parameters.leafThicknessMm,32);
assert.deepEqual(r.geometry.travel,{x:0,y:940});assert.equal(r.geometry.fullOpenIntervalMm[1],4160);
assert.deepEqual(sorted(r.geometry.pocketPolygon),sorted(pocket().sourceLeaf.pocketPolygon));
assert.deepEqual(G.pocketCutsForWall(r.item,walls,walls[1]),[{a:3200,b:4180,z0:-30,z1:30}]);
});
test('source exact pivot, leaves, travel and cavity are world invariant under host reversal',()=>{
for(const spec of [swing(),pocket()]){const a=ok(G.compileOpening(spec,walls,[spec])),b=ok(G.compileOpening(spec,walls.map(reverse),[spec]));
for(const field of ['closedLeaf','fullOpenLeaf','pocketPolygon'])if(a.geometry[field])assert.deepEqual(sorted(a.geometry[field]),sorted(b.geometry[field]));
if(a.geometry.hinge)assert.deepEqual(a.geometry.hinge,b.geometry.hinge);
}
});
test('source swing host collision and narrow intermediate external collision are blocked',()=>{
const s=swing();s.swingSide={x:0,y:-1};assert.ok(codes(G.compileOpening(s,walls,[])).includes('source-swing-host-collision'));
const angle=Math.PI/4,x=4100+700*Math.cos(angle),y=4700+700*Math.sin(angle);
const blocker={id:'tiny',floor:1,x1:x-1,y1:y,x2:x+1,y2:y,thick:2};
assert.ok(codes(G.compileOpening(swing(),[...walls,blocker],[])).includes('opening-sweep-collision'));
});
test('source pocket blocks short/narrow cavity, cavity outside wall, unsupported polygon and missing support',()=>{
for(const [change,code] of [
[p=>p.sourceLeaf.pocketPolygon[2].y=p.sourceLeaf.pocketPolygon[3].y=8750,'source-panel-outside-pocket'],
[p=>p.sourceLeaf.pocketPolygon.forEach(q=>q.x=5600+(q.x-5600)/3),'source-panel-outside-pocket'],
[p=>p.sourceLeaf.pocketPolygon.forEach(q=>q.x=5600+(q.x-5600)*3),'source-pocket-outside-wall'],
[p=>p.sourceLeaf.pocketPolygon.push({x:5600,y:8800}),'unsupported-pocket-cavity']]){const p=pocket();change(p);assert.ok(codes(G.compileOpening(p,walls,[])).includes(code));}
const short=[walls[0],{...walls[1],y2:8770}];assert.ok(codes(G.compileOpening(pocket(),short,[])).includes('source-pocket-without-support'));
const gap=[walls[0],{...walls[1],y2:8000},{...walls[1],id:'next',y1:8004}];assert.ok(codes(G.compileOpening(pocket(),gap,[])).includes('insufficient-slider-envelope'));
});
test('source cavity rejects another actual opening and checks whole cavity even beyond panel',()=>{
const other={id:'other',kind:'door-opening',floor:1,hostWallId:'partition',center:{x:5600,y:8770},widthMm:10,sourceLeaf:{}};
assert.ok(codes(G.compileOpening(pocket(),walls,[other])).includes('source-pocket-without-support'));
});
test('shared 2D local leaf exactly transforms to validator world polygon for both states',()=>{
for(const spec of [swing(),pocket()]){const r=ok(G.compileOpening(spec,walls,[])),{axis:u,normal:n}=r.geometry.basis,c=r.geometry.center;
for(const open of [false,true]){const plan=G.sourcePlanGeometry(r.item,open);const world=plan.leaf.map(p=>({x:c.x+u.x*p.x+n.x*p.y,y:c.y+u.y*p.x+n.y*p.y}));assert.deepEqual(sorted(world),sorted(r.geometry[open?'fullOpenLeaf':'closedLeaf']));}}
});
test('cavity wall box subtraction preserves exact shell volume and never overlaps void',()=>{
const box=[0,5000,0,2400,-60,60],hole=[3200,4180,0,2000,-30,30];const pieces=G.subtractBoxes(box,[hole]);
const volume=b=>(b[1]-b[0])*(b[3]-b[2])*(b[5]-b[4]);assert.equal(pieces.reduce((s,p)=>s+volume(p),0),volume(box)-volume(hole));
for(const p of pieces)assert.ok([0,2,4].some(k=>p[k]>=hole[k+1]||p[k+1]<=hole[k]));
});
test('source renderer consumers use shared actual dimensions and disable uncertified GLB',()=>{
const index=fs.readFileSync(require('node:path').join(__dirname,'../../index.html'),'utf8'),draw=fs.readFileSync(require('node:path').join(__dirname,'../../assets/js/draw-2d.js'),'utf8');
assert.match(index,/pivot.position.set\(hingeX,0,\(hingeGeometry.hingeZmm\|\|0\)\*U\)/);
assert.match(index,/sourceLeafW=hingeGeometry.leafWidthMm\*U/);assert.match(index,/openingModelReady=!it.openingSourceGeometry/);
assert.match(index,/SceneOpeningGeometry.subtractBoxes/);assert.match(index,/SceneOpeningGeometry.pocketCutsForWall/);assert.match(draw,/SceneOpeningGeometry.sourcePlanGeometry/);
});
test('source parameters are allowlisted and cannot silently mix mechanisms',()=>{
const s=swing();s.sourceLeaf.travelDistanceMm=42;assert.ok(codes(G.compileOpening(s,walls,[])).includes('inapplicable-source-leaf-field'));
const p=pocket();p.sourceLeaf.model='unverified.glb';assert.ok(codes(G.compileOpening(p,walls,[])).includes('unsupported-source-leaf-field'));
});
test('nominal contact is reported, while material host or even sub-mm unrelated-wall penetration blocks',()=>{
const r=ok(G.compileOpening(swing(),walls,[]));assert.equal(r.geometry.nominalJambContact,true);assert.equal(r.warnings[0].code,'source-nominal-jamb-contact');assert.equal(r.warnings[0].toleranceMm,1);
const thick=swing();thick.sourceLeaf.thicknessMm=100;assert.ok(codes(G.compileOpening(thick,walls,[])).includes('source-swing-host-collision'));
const p=pocket(),edge=8760;
const blocker={id:'tiny-edge',floor:1,x1:5590,y1:edge+0.1,x2:5610,y2:edge+0.1,thick:.4};
assert.ok(codes(G.compileOpening(p,[...walls,blocker],[])).includes('opening-sweep-collision'));
const short=[walls[0],{...walls[1],y2:8779.9}];assert.ok(codes(G.compileOpening(p,short,[])).includes('source-pocket-without-support'));
});
test('actual buildWall3D meshes retain pocket shell and remove exact source cavity',()=>{
const vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const helperPath=path.join(__dirname,'wall-face-nan.test.cjs');let helper=fs.readFileSync(helperPath,'utf8');helper=helper.slice(0,helper.indexOf('// ══ 20-1 本体'))+'\nmodule.exports={makeCtx,builtMeshes};';
const sandbox={require:createRequire(helperPath),module:{exports:{}},__dirname,console};vm.runInNewContext(helper,sandbox);
const r=ok(G.compileOpening(pocket(),walls,[]));const data={floors:{},rooms:[],walls,items:[r.item]};
const ctx=sandbox.module.exports.makeCtx(data);ctx.SceneOpeningGeometry=G;ctx.item3DBaseY=()=>ctx.wallBaseSupportY(walls[1]);ctx.isOpeningItemType=t=>G.supportedKinds.includes(t);ctx.getOpeningWallInfo=it=>G.explicitHostWallInfo(it,walls);
vm.runInContext('buildWall3D(DATA.walls[1]);',ctx);const meshes=sandbox.module.exports.builtMeshes(ctx);assert.ok(meshes.length>3);
const bottom=ctx.item3DBaseY(),cavity=[5.570,5.630,bottom,bottom+2,7.8,8.780];let volume=0;
for(const m of meshes){const a=m.geometry.attributes.position.array,pts=[];for(let i=0;i<a.length;i+=3){const c=Math.cos(m.rotation.y),s=Math.sin(m.rotation.y);pts.push([m.position.x+c*a[i]+s*a[i+2],m.position.y+a[i+1],m.position.z-s*a[i]+c*a[i+2]]);}const bounds=[];for(let k=0;k<3;k++)bounds.push(Math.min(...pts.map(p=>p[k])),Math.max(...pts.map(p=>p[k])));
assert.ok([0,2,4].some(k=>bounds[k]>=cavity[k+1]-1e-8||bounds[k+1]<=cavity[k]+1e-8),'rendered solid intersects exact cavity '+JSON.stringify(bounds));volume+=(bounds[1]-bounds[0])*(bounds[3]-bounds[2])*(bounds[5]-bounds[4]);}
assert.ok(volume>0,'shell remains');
});
test('v3 static apertures keep exact measured gap with no legacy fitting margin',()=>{
const spec={id:'gap',floor:1,kind:'door-opening',hostWallId:'south',center:{x:4550,y:4600},widthMm:200,sourceExactGap:true};
const r=ok(G.compileOpening(spec,walls,[]));assert.equal(G.wallCutWidthMm(r.item,7000),200);assert.equal(G.rendererParameters(r.item,200).mode,'opening');assert.equal(G.sourcePlanGeometry(r.item,true),null);
assert.equal(G.wallCutWidthMm({type:'door-opening',w:200},7000),450,'legacy unchanged');
});
